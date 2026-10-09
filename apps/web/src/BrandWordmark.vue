<script setup lang="ts">
import wordmark from "./assets/branding/wordmark.png";
</script>

<template>
  <h1 class="brand-heading"><img :src="wordmark" alt="streamface" /></h1>
</template>

<style scoped>
.brand-heading img {
  display: block;
  width: min(420px, 100%);
  height: auto;
}
</style>
