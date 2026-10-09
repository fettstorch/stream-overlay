<script setup lang="ts">
import wordmark from "./assets/branding/wordmark.png";
</script>

<template>
  <h1 class="brand-heading">
    <img :src="wordmark" alt="streamface" />
    <span class="live-badge">.live</span>
  </h1>
</template>

<style scoped>
.brand-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(580px, 100%);
}
.brand-heading img {
  display: block;
  flex: 1;
  min-width: 0;
  width: 0;
  max-width: 420px;
  height: auto;
}
.live-badge {
  flex: none;
  padding: 0.12em 0.28em;
  border-radius: 0.3em;
  background: #ff001b;
  color: white;
  font-size: clamp(1.6rem, 5vw, 3.3rem);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
}
</style>
