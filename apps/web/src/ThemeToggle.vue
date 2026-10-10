<script setup lang="ts">
import { ref, watchEffect } from "vue";
import sun from "./assets/branding/controls/sun.png";
import moon from "./assets/branding/controls/moon.png";
import "./theme.css";

const storageKey = "streamface-theme";
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
const dark = ref(savedTheme === "dark");
watchEffect(() => {
  const theme = dark.value ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(storageKey, theme); } catch { /* The toggle still works without storage. */ }
});
</script>

<template>
  <div class="theme-control">
    <img :src="sun" alt="Light mode" />
    <label class="switch theme-switch">
      <input v-model="dark" type="checkbox" role="switch" aria-label="Dark mode" :aria-checked="dark" />
      <span aria-hidden="true" />
    </label>
    <img :src="moon" alt="Dark mode" />
  </div>
</template>

<style scoped>
.theme-control { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-bottom: 20px; }
.theme-control img { width: 32px; height: 32px; object-fit: contain; }
#app .theme-switch input:checked + span::after { background-color: #fff; }
</style>
