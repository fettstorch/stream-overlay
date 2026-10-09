<script setup lang="ts">
import wordmark from "./assets/branding/wordmark.png";
import mask from "./assets/branding/mask.png";
</script>

<template>
  <h1 class="brand-heading">
    <span class="wordmark">
      <img class="wordmark-image" :src="wordmark" alt="streamface" />
      <img class="wordmark-mask" :src="mask" alt="" aria-hidden="true" />
    </span>
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
.wordmark {
  position: relative;
  flex: 1;
  min-width: 0;
  width: 0;
  max-width: 420px;
}
.wordmark-image {
  display: block;
  width: 100%;
  height: auto;
}
.wordmark-mask {
  position: absolute;
  left: 33%;
  top: 29%;
  width: 18%;
  height: auto;
  pointer-events: none;
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
