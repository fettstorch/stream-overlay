<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, reactive, watch, inject } from "vue";
import { overlayRuntimeKey } from "./shared-overlay-runtime.ts";
import {
  PokemonTeam,
  BadgeStrip,
  type PetAppearance,
  type ThoughtAppearance,
} from "@streamface/pokemon-ui";
import type { PokemonSnapshot } from "@streamface/pokemon-model";
import { crystalBadges } from "../../../modules/pokemon-crystal/src/badges.ts";
import { PokemonPetQueues } from "../../../modules/pokemon-blue/src/pet-queue.ts";

import type { CloudConfig } from "./cloud-admin-types.ts";
import fallback from "../../../assets/unknown-pokemon.svg";
import hand from "../../../assets/pat-pat-pet-pet.gif";
import hearts from "../../../assets/hearts.gif";
import bubble from "../../../assets/thought-bubble.gif";
import { loadPublicActorProfile } from "./actor-search.ts";

const host = inject(overlayRuntimeKey)!;
const did = host.did;
const snapshot = ref<PokemonSnapshot>();
const enabled = ref(false);
const mappings = ref<NonNullable<CloudConfig["pokemonCrystalMgbaMedia"]>>([]);
const activePets = reactive<Record<string, PetAppearance>>({});
const thought = ref<ThoughtAppearance>();
function setThoughtInterval(seconds: number) {
  clearInterval(thoughtTimer);
  thoughtTimer = setInterval(() => void showThought(), seconds * 1000);
}
let thoughtSeconds = 120;
let witness: string | undefined;
let thoughtTimer: ReturnType<typeof setInterval> | undefined;
let thoughtExpiry: ReturnType<typeof setTimeout> | undefined;
let thinking = false;
let thoughtIndex = 0;
let thoughtRemaining = 10000;
let thoughtVisibleAt: number | undefined;
function syncThoughtExpiry() {
  clearTimeout(thoughtExpiry);
  if (thoughtVisibleAt !== undefined) thoughtRemaining -= Date.now() - thoughtVisibleAt;
  thoughtVisibleAt = undefined;
  if (!thought.value || activePets[thought.value.pokemonId]) return;
  thoughtVisibleAt = Date.now();
  thoughtExpiry = setTimeout(
    () => {
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
async function showThought() {
  if (disposed || thinking || thought.value || !snapshot.value?.party.length) return;
  thinking = true;
  try {
    const response = await fetch(
      `/api/accounts/${encodeURIComponent(did)}/pokemon-crystal-mgba/pet-counts`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error();
    const counts = (await response.json()) as {
      pokemonId: string;
      petterDid: string;
      count: number;
    }[];
    const party = snapshot.value?.party ?? [];
    for (let i = 0; i < party.length; i++) {
      const pokemon = party[thoughtIndex++ % party.length]!;
      const favourite = counts
        .filter((item) => item.pokemonId === pokemon.id)
        .sort((a, b) => b.count - a.count || a.petterDid.localeCompare(b.petterDid))[0];
      if (!favourite) continue;
      const profile = await loadPublicActorProfile(favourite.petterDid);
      if (disposed || !snapshot.value?.party.some((p) => p.id === pokemon.id)) return;
      if (!profile.avatar) continue;
      thoughtRemaining = 10000;
      thoughtVisibleAt = undefined;
      thought.value = {
        pokemonId: pokemon.id,
        avatar: profile.avatar,
        bubbleImage: bubble,
        heartsImage: hearts,
        startedAt: Date.now(),
      };
      break;
    }
  } catch {
    relay?.send({
      type: "diagnostic",
      event: "config-failed",
      reason: "crystal.pet-history-load-failed",
    });
  } finally {
    thinking = false;
  }
}
const images = computed(() => ({
  ...Object.fromEntries(
    mappings.value.filter((item) => item.url).map((item) => [item.number, item.url!]),
  ),
}));
const relay = { send: host.send };
let stopRelay: (() => void) | undefined;
let stopConfig: (() => void) | undefined;
let releaseChat: (() => void) | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
let disposed = false;
const chat = host.chat;
const queues = new PokemonPetQueues(
  10000,
  (pokemonId, author) => {
    activePets[pokemonId] = {
      avatar: author.avatar,
      handImage: hand,
      heartsImage: hearts,
      startedAt: Date.now(),
    };
  },
  (pokemonId) => {
    delete activePets[pokemonId];
  },
);
let unsubscribe: (() => void) | undefined;
function clearLive() {
  witness = undefined;
  thought.value = undefined;
  snapshot.value = undefined;
  queues.updateParty([]);
  for (const key of Object.keys(activePets)) delete activePets[key];
}
function configure(config: CloudConfig) {
  enabled.value = config.pokemonCrystalMgbaEnabled ?? true;
  if (!enabled.value) clearLive();
  mappings.value = config.pokemonCrystalMgbaMedia ?? [];
  const seconds = config.pokemonCrystalMgbaThoughtIntervalSeconds ?? 120;
  if (seconds !== thoughtSeconds) {
    thoughtSeconds = seconds;
    setThoughtInterval(seconds);
  }
}
onMounted(() => {
  host.report("config-loaded", "crystal.mounted");
  stopRelay = host.listen(
    (message) => {
      if (message.type !== "pokemon-crystal-mgba" || !enabled.value) return;
      snapshot.value = message.snapshot;
      witness = message.petWitness;
      if (thought.value && !message.snapshot.party.some((p) => p.id === thought.value!.pokemonId))
        thought.value = undefined;
      queues.updateParty(message.snapshot.party);
      clearTimeout(expiry);
      expiry = setTimeout(clearLive, 10000);
    },
    () => {
      clearLive();
    },
  );
  stopConfig = host.subscribe(configure);
  {
    releaseChat = host.acquireChat("pokemon-crystal-mgba");
    unsubscribe = chat.messages.subscribe((message) => {
      if (!enabled.value) return;
      const match = /^!pet\s+(.+)$/i.exec(message.text.trim());
      if (!match || !snapshot.value) return;
      const author = message.author.avatar
        ? Promise.resolve(message.author)
        : loadPublicActorProfile(message.author.did)
            .then((profile) => ({ ...message.author, avatar: profile.avatar }))
            .catch(() => {
              relay?.send({
                type: "diagnostic",
                event: "event-rejected",
                reason: "crystal.pet-author-load-failed",
              });
              return message.author;
            });
      if (!queues.enqueue(match[1]!, author)) return;
      if (!witness || host.preview) return;
      const uri = `at://${message.author.did}/place.stream.chat.message/${message.id.slice(message.author.did.length + 1)}`;
      void fetch(`/api/accounts/${encodeURIComponent(did)}/pokemon-crystal-mgba/pet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ witness, uri }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            relay?.send({
              type: "diagnostic",
              event: "event-rejected",
              reason:
                result.error === "pet-permission-required"
                  ? "crystal.pet-permission-required"
                  : "crystal.pet-save-failed",
              requestId: result.requestId,
            });
            if (host.preview)
              window.parent.postMessage(
                {
                  type: "crystal-pet-save-failed",
                  permissionRequired: result.error === "pet-permission-required",
                },
                location.origin,
              );
          }
        })
        .catch(() =>
          relay?.send({
            type: "diagnostic",
            event: "event-rejected",
            reason: "crystal.pet-save-failed",
          }),
        );
    });
  }
  thoughtTimer = setInterval(() => void showThought(), 120000);
});
onBeforeUnmount(() => {
  host.report("config-loaded", "crystal.unmounted");
  disposed = true;
  clearTimeout(expiry);
  clearInterval(poll);
  clearInterval(thoughtTimer);
  clearTimeout(thoughtExpiry);
  unsubscribe?.();

  stopRelay?.();
  stopConfig?.();
  releaseChat?.();
  clearLive();
});
</script>
<template>
  <main v-if="enabled && snapshot" class="crystal-cloud-overlay">
    <PokemonTeam
      :party="snapshot.party"
      :images="images"
      :fallback-image="fallback"
      :active-pets="activePets"
      :thought="thought"
      egg-image="https://media.giphy.com/media/bxquPUdFgeUdeO2I1V/giphy.gif"
    />
    <BadgeStrip :badges="crystalBadges" :owned-badge-ids="snapshot.badges?.ownedBadgeIds ?? []" />
    <p v-if="snapshot.party.length">
      Pet a Pokémon in chat: <code>!pet &lt;Pokémon name&gt;</code>
    </p>
  </main>
</template>
<style>
.crystal-cloud-overlay {
  padding-block: 6%;
}
.crystal-cloud-overlay p {
  margin: 24px 7%;
  color: white;
  text-align: center;
  font:
    700 20px ui-monospace,
    monospace;
  text-shadow: 1px 1px 2px black;
}
</style>
