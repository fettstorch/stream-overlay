<script setup lang="ts">
import type { BadgeDefinition } from "./types.ts";

defineProps<{
  badges: BadgeDefinition[];
  ownedBadgeIds: string[];
}>();
</script>

<template>
  <div class="badge-strip" aria-label="Gym badges">
    <img
      v-for="badge in badges"
      :key="badge.id"
      class="badge"
      :class="ownedBadgeIds.includes(badge.id) ? 'owned' : 'unowned'"
      :src="badge.image"
      :alt="ownedBadgeIds.includes(badge.id) ? badge.name : `${badge.name} not yet obtained`"
      :title="badge.name"
    >
  </div>
</template>

<style scoped>
.badge-strip {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  align-items: center;
  gap: 12px;
  margin-top: 64px;
  padding: 0 7%;
}
.badge {
  width: 100%;
  max-width: 72px;
  justify-self: center;
  image-rendering: pixelated;
  transition: filter 250ms ease, opacity 250ms ease;
}
.badge.unowned {
  opacity: 0.28;
  filter: grayscale(1) brightness(0.3);
}
.badge.owned {
  opacity: 1;
  filter: drop-shadow(2px 2px 0 #000);
}
</style>
