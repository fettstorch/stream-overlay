<script setup lang="ts">
import mascot from "./assets/branding/mascot.png";
</script>

<template>
  <img class="brand-mascot" :src="mascot" alt="" aria-hidden="true" />
</template>

<style scoped>
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
