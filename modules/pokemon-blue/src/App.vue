<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  BadgeStrip,
  PokemonTeam,
  PokemonPetQueues,
  type PetAuthor,
  type BadgeDefinition,
  type PetAppearance,
  type ThoughtAppearance,
} from "@streamface/pokemon-ui";
import type { PokemonSnapshot } from "@streamface/pokemon-model";
import { observeStreamChat } from "@streamface/stream-chat";
import { parseThoughtInterval, type PokemonBlueConfiguration } from "./config.ts";
import fallbackImage from "../../../assets/unknown-pokemon.svg";
import { defaultPokemonImages } from "./images.ts";
import petEffectImage from "../../../assets/pat-pat-pet-pet.gif";
import heartsEffectImage from "../../../assets/hearts.gif";
import thoughtBubbleImage from "../../../assets/thought-bubble.gif";
import boulderBadge from "../../../assets/badges/boulder.png";
import cascadeBadge from "../../../assets/badges/cascade.png";
import thunderBadge from "../../../assets/badges/thunder.png";
import rainbowBadge from "../../../assets/badges/rainbow.png";
import soulBadge from "../../../assets/badges/soul.png";
import marshBadge from "../../../assets/badges/marsh.png";
import volcanoBadge from "../../../assets/badges/volcano.png";
import earthBadge from "../../../assets/badges/earth.png";

// The interaction lifecycle is shared; game-specific readers and badges stay separate.
const props = withDefaults(
  defineProps<{ moduleId?: string; badgeDefinitions?: BadgeDefinition[] }>(),
  { moduleId: "pokemon-blue" },
);
const api = `/api/${props.moduleId}`;

const snapshot = ref<PokemonSnapshot>({ party: [], badges: null, capturedAt: "" });
const configuration = ref<PokemonBlueConfiguration>({
  components: { team: true, badges: true },
});
const activePets = reactive<Record<string, PetAppearance>>({});
const thought = ref<ThoughtAppearance>();
let thoughtTimer: ReturnType<typeof setInterval> | undefined;
let thoughtEndTimer: ReturnType<typeof setTimeout> | undefined;
let thoughtRemaining = 10_000;
let thoughtVisibleAt: number | undefined;
let nextThoughtSlot = 0;
const moduleEnabled = ref(false);
let moduleStatus: EventSource | undefined;
let lifecycleVersion = 0;
let thoughtLookupVersion: number | undefined;
let streamerDid: string | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let closeChat: (() => void) | undefined;
let unsubscribeChat: (() => void) | undefined;

function diagnose(event: string, details: Record<string, unknown> = {}) {
  void fetch("/api/diagnostics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, details: { ...details, moduleId: props.moduleId } }),
    keepalive: true,
  }).catch(() => {});
}

const images = defaultPokemonImages;

const badges: BadgeDefinition[] = [
  { id: "boulder", name: "Boulder Badge", image: boulderBadge },
  { id: "cascade", name: "Cascade Badge", image: cascadeBadge },
  { id: "thunder", name: "Thunder Badge", image: thunderBadge },
  { id: "rainbow", name: "Rainbow Badge", image: rainbowBadge },
  { id: "soul", name: "Soul Badge", image: soulBadge },
  { id: "marsh", name: "Marsh Badge", image: marshBadge },
  { id: "volcano", name: "Volcano Badge", image: volcanoBadge },
  { id: "earth", name: "Earth Badge", image: earthBadge },
];

const petQueues = new PokemonPetQueues(
  10_000,
  (pokemonId, author) => {
    diagnose("pokemon.pet-animation-started", { pokemonId, authorDid: author.did });
    activePets[pokemonId] = {
      avatar: author.avatar,
      handImage: petEffectImage,
      heartsImage: heartsEffectImage,
      startedAt: Date.now(),
    };
  },
  (pokemonId, author) => {
    diagnose("pokemon.pet-animation-ended", { pokemonId, authorDid: author.did });
    delete activePets[pokemonId];
  },
);

async function refreshSnapshot() {
  const version = lifecycleVersion;
  try {
    const response = await fetch(`${api}/snapshot`, { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as PokemonSnapshot;
    if (version !== lifecycleVersion || !moduleEnabled.value) return;
    snapshot.value = result;
    petQueues.updateParty(snapshot.value.party);
    if (thought.value && !result.party.some((pokemon) => pokemon.id === thought.value!.pokemonId))
      thought.value = undefined;
  } catch {
    // Keep the last valid game snapshot while the host is temporarily unavailable.
  }
}

async function refreshConfiguration() {
  const version = lifecycleVersion;
  try {
    const response = await fetch(`${api}/config`, { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as PokemonBlueConfiguration;
    if (version !== lifecycleVersion || !moduleEnabled.value) return;
    const previousInterval = parseThoughtInterval(configuration.value.thoughtIntervalSeconds);
    const interval = parseThoughtInterval(result.thoughtIntervalSeconds);
    if (interval === null) return;
    configuration.value = result;
    if (thoughtTimer && interval !== previousInterval) {
      clearInterval(thoughtTimer);
      thoughtTimer = setInterval(showNextThought, interval * 1000);
    }
  } catch {
    // Keep the last valid module configuration while the host is unavailable.
  }
}

async function refreshOverlay() {
  await Promise.all([refreshSnapshot(), refreshConfiguration()]);
}

function connectChat() {
  const version = lifecycleVersion;
  diagnose("pokemon.chat-connecting");
  const chat = observeStreamChat();
  closeChat = chat.close;
  unsubscribeChat = chat.messages.subscribe((message) => {
    if (!moduleEnabled.value || version !== lifecycleVersion) return;
    diagnose("pokemon.chat-message-received", { id: message.id, text: message.text });
    const match = message.text.match(/^\s*!pet\s+(.+?)\s*$/i);
    if (!match) {
      diagnose("pokemon.chat-message-ignored", { id: message.id, reason: "not-a-pet-command" });
      return;
    }
    const author: PetAuthor = { did: message.author.did, avatar: message.author.avatar };
    const queued = petQueues.enqueue(match[1], Promise.resolve(author));
    diagnose(queued ? "pokemon.pet-queued" : "pokemon.pet-rejected", {
      id: message.id,
      requestedName: match[1],
      authorDid: author.did,
      party: snapshot.value.party.map(({ id, name }) => ({ id, name })),
      reason: queued ? undefined : "pokemon-not-in-party",
    });
  });
}

function stopInteractions() {
  clearInterval(thoughtTimer);
  thoughtTimer = undefined;
  clearTimeout(thoughtEndTimer);
  thought.value = undefined;
  nextThoughtSlot = 0;
  clearInterval(refreshTimer);
  refreshTimer = undefined;
  unsubscribeChat?.();
  closeChat?.();
  unsubscribeChat = undefined;
  closeChat = undefined;
  petQueues.updateParty([]);
  for (const id of Object.keys(activePets)) delete activePets[id];
}

async function showNextThought() {
  if (
    thought.value ||
    !moduleEnabled.value ||
    !configuration.value.components.team ||
    !snapshot.value.party.length
  )
    return;
  const version = lifecycleVersion;
  if (thoughtLookupVersion === version) return;
  thoughtLookupVersion = version;
  try {
    await findNextThought(version);
  } finally {
    if (thoughtLookupVersion === version) thoughtLookupVersion = undefined;
  }
}

async function findNextThought(version: number) {
  const partySize = snapshot.value.party.length;
  for (let attempted = 0; attempted < partySize; attempted++) {
    if (version !== lifecycleVersion || !moduleEnabled.value || !snapshot.value.party.length)
      return;
    const pokemon = snapshot.value.party[nextThoughtSlot % snapshot.value.party.length]!;
    nextThoughtSlot = (nextThoughtSlot + 1) % snapshot.value.party.length;
    try {
      const response = await fetch(`${api}/pet-favourite/${encodeURIComponent(pokemon.id)}`, {
        cache: "no-store",
      });
      if (!response.ok) continue;
      const favourite = (await response.json()) as {
        avatar?: string;
        authorDid: string;
        count: number;
      } | null;
      if (version !== lifecycleVersion || !moduleEnabled.value || thought.value) return;
      if (!favourite?.avatar || !snapshot.value.party.some((member) => member.id === pokemon.id))
        continue;
      thoughtRemaining = 10_000;
      thoughtVisibleAt = undefined;
      thought.value = {
        pokemonId: pokemon.id,
        avatar: favourite.avatar,
        bubbleImage: thoughtBubbleImage,
        heartsImage: heartsEffectImage,
        startedAt: Date.now(),
      };
      diagnose("pokemon.thought-started", {
        pokemonId: pokemon.id,
        authorDid: favourite.authorDid,
        count: favourite.count,
      });
      syncThoughtExpiry();
      return;
    } catch {
      /* Try another member without interrupting normal pets or game data. */
    }
  }
}

function syncThoughtExpiry() {
  clearTimeout(thoughtEndTimer);
  if (thoughtVisibleAt !== undefined) thoughtRemaining -= Date.now() - thoughtVisibleAt;
  thoughtVisibleAt = undefined;
  if (!thought.value || activePets[thought.value.pokemonId]) return;
  thoughtVisibleAt = Date.now();
  thoughtEndTimer = setTimeout(
    () => {
      thoughtVisibleAt = undefined;
      thought.value = undefined;
    },
    Math.max(0, thoughtRemaining),
  );
}
watch(
  () => (thought.value ? Boolean(activePets[thought.value.pokemonId]) : undefined),
  syncThoughtExpiry,
  { flush: "sync" },
);

async function setModuleEnabled(enabled: boolean, restart = false) {
  if (moduleEnabled.value === enabled && !restart) return;
  moduleEnabled.value = enabled;
  const version = ++lifecycleVersion;
  if (restart) stopInteractions();
  diagnose("pokemon.module-state", { enabled });
  if (!enabled) {
    stopInteractions();
    return;
  }
  await refreshOverlay();
  if (version !== lifecycleVersion || !moduleEnabled.value) return;
  diagnose("pokemon.snapshot-ready", {
    party: snapshot.value.party.map(({ id, name }) => ({ id, name })),
  });
  refreshTimer = setInterval(refreshOverlay, 1000);
  connectChat();
  thoughtTimer = setInterval(
    showNextThought,
    (parseThoughtInterval(configuration.value.thoughtIntervalSeconds) ?? 120) * 1000,
  );
}

onMounted(() => {
  diagnose("pokemon.overlay-mounted");
  moduleStatus = new EventSource(`/api/modules/${props.moduleId}/events`);
  moduleStatus.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data) as { enabled?: unknown; streamerDid?: unknown };
      if (typeof state.enabled !== "boolean") return;
      const changed = typeof state.streamerDid === "string" && state.streamerDid !== streamerDid;
      if (typeof state.streamerDid === "string") streamerDid = state.streamerDid;
      void setModuleEnabled(state.enabled, changed);
    } catch {
      diagnose("pokemon.module-state-invalid");
    }
  };
  // Fail closed while disconnected; reconnection sends the authoritative state.
  moduleStatus.onerror = () => {
    diagnose("pokemon.module-status-disconnected");
    void setModuleEnabled(false);
  };
});

onBeforeUnmount(() => {
  moduleEnabled.value = false;
  lifecycleVersion++;
  moduleStatus?.close();
  stopInteractions();
});
</script>

<template>
  <div
    v-if="moduleEnabled"
    class="pokemon-overlay"
    :class="{ 'pokemon-overlay--crystal': props.moduleId === 'pokemon-crystal' }"
  >
    <PokemonTeam
      v-if="configuration.components.team"
      :party="snapshot.party"
      :images="images"
      :fallback-image="fallbackImage"
      egg-image="https://media.giphy.com/media/bxquPUdFgeUdeO2I1V/giphy.gif"
      :active-pets="activePets"
      :thought="thought"
    />
    <BadgeStrip
      v-if="configuration.components.badges"
      :badges="props.badgeDefinitions ?? badges"
      :owned-badge-ids="snapshot.badges?.ownedBadgeIds ?? []"
    />
    <p v-if="configuration.components.team && snapshot.party.length" class="pet-hint">
      Pet a Pokémon in chat: <code>!pet &lt;Pokémon name&gt;</code>
      <span>Use the name shown above.</span>
    </p>
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
  background: transparent;
}
.pokemon-overlay--crystal {
  box-sizing: border-box;
  min-height: 100vh;
  padding-block: clamp(48px, 6vh, 96px);
}
.pet-hint {
  margin: 24px 7% 16px;
  color: #fff;
  text-align: center;
  font:
    700 20px/1.5 ui-monospace,
    monospace;
  text-shadow:
    1px 1px 2px #000,
    -1px -1px 2px #000;
}
.pet-hint code {
  color: #ffb6de;
  font: inherit;
}
.pet-hint span {
  display: block;
  font-size: 0.75em;
}
</style>
