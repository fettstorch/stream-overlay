<script setup lang="ts">
import mascot from "./assets/branding/mascot.png";
</script>

<template>
  <div class="brand-background" aria-hidden="true" />
  <img class="brand-mascot" :src="mascot" alt="" aria-hidden="true" />
</template>

<style scoped>
.brand-background {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #fff;
  pointer-events: none;
  z-index: 0;
}
:global(header .intro) {
  color: #565550;
}
:global(header .streamplace-brand) {
  color: inherit;
}
:global(header .streamplace-brand img) {
  filter: brightness(0);
}
.brand-mascot {
  position: fixed;
  right: 0;
  bottom: 0;
  width: clamp(100px, 16vw, 230px);
  height: auto;
  pointer-events: none;
  user-select: none;
  z-index: 0;
}
:global(main) {
  position: relative;
  z-index: 1;
}
</style>
