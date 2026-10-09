<script setup lang="ts">
// Official mainLogo SVG from Streamplace's published site branding metadata.
import logo from "./assets/branding/streamplace.svg";
</script>

<template>
  <a class="streamplace-brand" href="https://stream.place/" target="_blank" rel="noopener noreferrer">
    <img :src="logo" alt="" />stream.place
  </a>
</template>

<style scoped>
.streamplace-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  vertical-align: baseline;
  color: inherit;
  font-weight: 700;
  text-decoration: none;
}
.streamplace-brand:hover {
  text-decoration: underline;
}
.streamplace-brand img {
  width: 0.9em;
  height: 0.9em;
}
</style>
