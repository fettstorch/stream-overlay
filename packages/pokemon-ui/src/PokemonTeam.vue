<script setup lang="ts">
import { computed } from "vue";
import type { Pokemon } from "@stream-overlay/pokemon-model";
import type { PetAppearance, ThoughtAppearance } from "./types.ts";

type GrowthRate = "fast" | "medium-fast" | "medium-slow" | "slow";

const props = defineProps<{
  party: Pokemon[];
  images: Record<number, string>;
  fallbackImage: string;
  activePets: Record<string, PetAppearance>;
  thought?: ThoughtAppearance;
}>();

const fastGrowth = new Set([35, 36, 39, 40, 113]);
const mediumSlowGrowth = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 29, 30, 31, 32, 33, 34,
  43, 44, 45, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 74, 75,
  76, 92, 93, 94, 151,
]);
const slowGrowth = new Set([
  58, 59, 72, 73, 90, 91, 102, 103, 111, 112, 120, 121, 127, 128, 129,
  130, 131, 142, 143, 144, 145, 146, 147, 148, 149, 150,
]);

function growthRateFor(number: number): GrowthRate {
  if (fastGrowth.has(number)) return "fast";
  if (mediumSlowGrowth.has(number)) return "medium-slow";
  if (slowGrowth.has(number)) return "slow";
  return "medium-fast";
}

function experienceAtLevel(level: number, rate: GrowthRate) {
  const cubed = level ** 3;
  if (rate === "fast") return Math.floor(4 * cubed / 5);
  if (rate === "medium-slow") return Math.max(0, Math.floor(6 * cubed / 5 - 15 * level ** 2 + 100 * level - 140));
  if (rate === "slow") return Math.floor(5 * cubed / 4);
  return cubed;
}

function percentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function hpPercentage(pokemon: Pokemon) {
  return pokemon.maxHp ? percentage(pokemon.hp / pokemon.maxHp * 100) : 0;
}

function xpPercentage(pokemon: Pokemon) {
  if (pokemon.level >= 100) return 100;
  const rate = growthRateFor(pokemon.nationalDexNumber);
  const current = experienceAtLevel(pokemon.level, rate);
  const next = experienceAtLevel(pokemon.level + 1, rate);
  return percentage((pokemon.experience - current) / (next - current) * 100);
}

const cards = computed(() => props.party.map((pokemon) => ({
  pokemon,
  hp: hpPercentage(pokemon),
  xp: xpPercentage(pokemon),
})));
</script>

<template>
  <div class="pokemon-grid">
    <figure v-for="card in cards" :key="card.pokemon.id">
      <img
        class="pokemon-image"
        :src="images[card.pokemon.nationalDexNumber] ?? fallbackImage"
        :alt="card.pokemon.name"
        @error="($event.target as HTMLImageElement).src = fallbackImage"
      >

      <template v-if="activePets[card.pokemon.id]">
        <img
          class="pet-effect"
          :key="`hand-${activePets[card.pokemon.id].startedAt}`"
          :src="`${activePets[card.pokemon.id].handImage}?restart=${activePets[card.pokemon.id].startedAt}`"
          alt=""
        >
        <img
          class="pet-hearts"
          :key="`hearts-${activePets[card.pokemon.id].startedAt}`"
          :src="`${activePets[card.pokemon.id].heartsImage}?restart=${activePets[card.pokemon.id].startedAt}`"
          alt=""
        >
        <div v-if="activePets[card.pokemon.id].avatar" class="pet-author">
          <img class="pet-author-avatar" :src="activePets[card.pokemon.id].avatar" alt="">
        </div>
      </template>

      <div v-if="thought?.pokemonId === card.pokemon.id && !activePets[card.pokemon.id]" :key="thought.startedAt" class="pokemon-thought">
        <img class="thought-bubble" :src="thought.bubbleImage" alt="">
        <img class="thought-avatar" :src="thought.avatar" alt="Favourite petter">
        <img class="thought-hearts" :src="`${thought.heartsImage}?restart=${thought.startedAt}`" alt="">
      </div>

      <div class="status-panel">
        <div class="status-heading">
          <span class="pokemon-name">{{ card.pokemon.name }}</span>
          <span class="pokemon-level">Lv.{{ card.pokemon.level }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">HP</span>
          <div class="meter hp-meter" :data-health="card.hp <= 20 ? 'low' : card.hp <= 50 ? 'medium' : 'high'">
            <div class="meter-fill" :style="{ width: `${card.hp}%` }" />
          </div>
        </div>
        <div class="status-row xp-row">
          <span class="status-label">EXP</span>
          <div class="meter xp-meter">
            <div class="meter-fill" :style="{ width: `${card.xp}%` }" />
          </div>
        </div>
      </div>
    </figure>
  </div>
</template>

<style scoped>
.pokemon-grid {
  display: grid;
  box-sizing: border-box;
  padding-inline: 25%;
  grid-template-columns: repeat(2, 1fr);
  column-gap: 16px;
  row-gap: 52px;
}
figure { position: relative; margin: 0; aspect-ratio: 1 / 1; }
.pokemon-thought { position: absolute; z-index: 3; top: 0; left: 42%; width: 58%; aspect-ratio: 1; transform: translate(-150%, -50%) scale(2); transform-origin: center top; pointer-events: none; animation: thought-appear 300ms ease; }
.pokemon-thought .thought-avatar { inset: auto; top: 20.2%; left: 30.2%; width: 39.6%; height: 39.6%; border-radius: 50%; object-fit: cover; }
.pokemon-thought .thought-hearts { inset: auto; top: -15%; left: 48%; width: 50%; height: auto; }
@keyframes thought-appear { from { opacity: 0; } to { opacity: 1; } }
img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.pet-effect { z-index: 2; top: 2%; left: 40%; width: 44%; height: auto; transform: translateX(-50%); pointer-events: none; }
.pet-hearts { z-index: 2; top: 3%; left: 49%; width: 38%; height: auto; pointer-events: none; animation: hearts-delay 750ms step-end; }
@keyframes hearts-delay { from { opacity: 0; } to { opacity: 1; } }
.pet-author { position: absolute; z-index: 3; top: 2%; left: 4%; pointer-events: none; }
.pet-author-avatar { position: static; width: clamp(56px, 16vw, 96px); height: clamp(56px, 16vw, 96px); border: 2px solid #fff; border-radius: 50%; background: #333; object-fit: cover; box-shadow: 0 2px 5px #000; }
.status-panel { position: absolute; z-index: 1; left: 4%; bottom: 0; transform: translate(7%, 30%); box-sizing: border-box; width: 92%; padding: 8px 10px; color: #fff; font-family: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace; font-weight: 900; text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000; }
.status-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 10px; font-size: clamp(1.5rem, 3.6vw, 2.4rem); line-height: 1; }
.pokemon-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pokemon-level { flex: none; font-size: 0.72em; }
.status-row { display: grid; grid-template-columns: 3.5rem 1fr; align-items: center; gap: 8px; }
.status-label { font-size: 1.2rem; letter-spacing: -0.08em; }
.meter { height: 12px; overflow: hidden; border: 3px solid #fff; border-radius: 999px; background: #303030; }
.meter-fill { height: 100%; border-radius: inherit; transition: width 300ms ease; }
.hp-meter .meter-fill { background: #35d94b; }
.hp-meter[data-health="medium"] .meter-fill { background: #f4cf35; }
.hp-meter[data-health="low"] .meter-fill { background: #ef4949; }
.xp-meter .meter-fill { background: #5faaf5; }
.xp-row { margin-top: 8px; }
</style>
