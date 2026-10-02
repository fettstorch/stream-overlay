<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { BadgeStrip, PokemonTeam, type BadgeDefinition, type PetAppearance } from "@stream-overlay/pokemon-ui";
import type { PokemonSnapshot } from "@stream-overlay/pokemon-model";
import { PokemonPetQueues, type PetAuthor } from "./pet-queue.ts";
import type { PokemonBlueConfiguration } from "./config.ts";
import fallbackImage from "../../../assets/unknown-pokemon.svg";
import petEffectImage from "../../../assets/pat-pat-pet-pet.gif";
import heartsEffectImage from "../../../assets/hearts.gif";
import boulderBadge from "../../../assets/badges/boulder.png";
import cascadeBadge from "../../../assets/badges/cascade.png";
import thunderBadge from "../../../assets/badges/thunder.png";
import rainbowBadge from "../../../assets/badges/rainbow.png";
import soulBadge from "../../../assets/badges/soul.png";
import marshBadge from "../../../assets/badges/marsh.png";
import volcanoBadge from "../../../assets/badges/volcano.png";
import earthBadge from "../../../assets/badges/earth.png";

const snapshot = ref<PokemonSnapshot>({ party: [], badges: null, capturedAt: "" });
const configuration = ref<PokemonBlueConfiguration>({
  streamerDid: "",
  components: { team: true, badges: true },
});
const activePets = reactive<Record<string, PetAppearance>>({});
const profileCache = new Map<string, Promise<PetAuthor>>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let chatSocket: WebSocket | undefined;

const images: Record<number, string> = {
  3: "https://media.giphy.com/media/EJOdcxm52IWNq/giphy.gif",
  25: "https://media.giphy.com/media/31vamYdZV5ISQ/giphy.gif",
  31: "https://media.giphy.com/media/nzhNS6v9jKwy97m3EN/giphy.gif",
  37: "https://media.giphy.com/media/eM3S83hIueaUEjbBYC/giphy.gif",
  38: "https://media.giphy.com/media/iheXjyc9btNm0WrFgz/giphy.gif",
  61: "https://media.giphy.com/media/m0kJGZioi44vtTcKrZ/giphy.gif",
  62: "https://media.giphy.com/media/v2Oo1HzfEr0nHHAM10/giphy.gif",
  83: "https://media.giphy.com/media/LVQ1HZOfl54YrODThX/giphy.gif",
  130: "https://media.giphy.com/media/CtTZ0k0UNLq084qRdj/giphy.gif",
  147: "https://media.giphy.com/media/uuaImYFJ82LRARUq2t/giphy.gif",
  148: "https://media.giphy.com/media/KaHrX0xJYqjdpKWwZa/giphy.gif",
  149: "https://media.giphy.com/media/Th9vH3DGtIC4etgI3K/giphy.gif",
};

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
    activePets[pokemonId] = {
      avatar: author.avatar,
      handImage: petEffectImage,
      heartsImage: heartsEffectImage,
      startedAt: Date.now(),
    };
  },
  (pokemonId) => { delete activePets[pokemonId]; },
);

async function refreshSnapshot() {
  const response = await fetch("/api/pokemon-blue/snapshot", { cache: "no-store" });
  if (!response.ok) return;
  snapshot.value = await response.json() as PokemonSnapshot;
  petQueues.updateParty(snapshot.value.party);
}

function getProfile(did: string) {
  let profile = profileCache.get(did);
  if (!profile) {
    profile = fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Profile request returned ${response.status}`);
        const data = await response.json() as { avatar?: string };
        return { did, avatar: data.avatar };
      })
      .catch(() => ({ did }));
    profileCache.set(did, profile);
  }
  return profile;
}

const jetstreamHosts = [
  "jetstream2.us-east.bsky.network",
  "jetstream1.us-east.bsky.network",
  "jetstream2.us-west.bsky.network",
  "jetstream1.us-west.bsky.network",
];

function connectChat() {
  const streamerDid = new URLSearchParams(location.search).get("streamer")
    || configuration.value.streamerDid;
  if (!streamerDid?.startsWith("did:")) return;
  let hostIndex = 0;
  let reconnectDelay = 1000;

  const connect = () => {
    const host = jetstreamHosts[hostIndex % jetstreamHosts.length];
    const socket = new WebSocket(`wss://${host}/subscribe?wantedCollections=place.stream.chat.message`);
    chatSocket = socket;
    socket.addEventListener("open", () => { reconnectDelay = 1000; });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        const commit = message?.commit;
        if (message?.kind !== "commit" || commit?.operation !== "create") return;
        if (commit.collection !== "place.stream.chat.message") return;
        if (commit.record?.streamer !== streamerDid || typeof commit.record?.text !== "string") return;
        const match = commit.record.text.match(/^\s*!pet\s+(.+?)\s*$/i);
        if (match && typeof message.did === "string") petQueues.enqueue(match[1], getProfile(message.did));
      } catch {
        // Ignore malformed or unrelated Jetstream events.
      }
    });
    socket.addEventListener("close", () => {
      if (chatSocket !== socket) return;
      hostIndex++;
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15_000);
    });
  };
  connect();
}

onMounted(async () => {
  const configResponse = await fetch("/api/pokemon-blue/config", { cache: "no-store" });
  if (configResponse.ok) configuration.value = await configResponse.json() as PokemonBlueConfiguration;
  await refreshSnapshot();
  refreshTimer = setInterval(refreshSnapshot, 1000);
  connectChat();
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  chatSocket = undefined;
});
</script>

<template>
  <PokemonTeam
    v-if="configuration.components.team"
    :party="snapshot.party"
    :images="images"
    :fallback-image="fallbackImage"
    :active-pets="activePets"
  />
  <BadgeStrip
    v-if="configuration.components.badges"
    :badges="badges"
    :owned-badge-ids="snapshot.badges?.ownedBadgeIds ?? []"
  />
</template>

<style>
html, body, #app { margin: 0; min-height: 100%; background: transparent; }
</style>
