<script setup lang="ts">
import wordmark from "./assets/branding/wordmark.png";
import mask from "./assets/branding/mask.png";
</script>

<template>
  <svg class="wordmark-filters" aria-hidden="true" focusable="false">
    <defs>
      <filter id="streamface-ink-wordmark" x="-5%" y="-20%" width="110%" height="140%" color-interpolation-filters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius="3" result="outline" />
        <feFlood flood-color="black" />
        <feComposite in2="outline" operator="in" result="ink" />
        <feFlood flood-color="white" />
        <feComposite in2="SourceAlpha" operator="in" result="letters" />
        <feMerge><feMergeNode in="ink" /><feMergeNode in="letters" /></feMerge>
      </filter>
    </defs>
  </svg>
  <h1 class="brand-heading">
    <span class="wordmark">
      <img class="wordmark-image" :src="wordmark" alt="streamface" />
      <img class="wordmark-mask" :src="mask" alt="" aria-hidden="true" />
    </span>
    <span class="live-badge">.live</span>
  </h1>
</template>

<style scoped>
.wordmark-filters {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}
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
  filter: url(#streamface-ink-wordmark);
}
.wordmark-mask {
  position: absolute;
  left: -4%;
  top: 20%;
  width: 14%;
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
