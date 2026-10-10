<script setup lang="ts">
import { onBeforeUnmount, ref, watchEffect } from "vue";
import sun from "./assets/branding/controls/sun.png";
import moon from "./assets/branding/controls/moon.png";
import "./theme.css";

const storageKey = "streamface-theme";
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
const preference = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let explicitChoice = savedTheme === "dark" || savedTheme === "light";
const dark = ref(explicitChoice ? savedTheme === "dark" : preference?.matches ?? false);
function followPreference(event: MediaQueryListEvent) {
  if (!explicitChoice) dark.value = event.matches;
}
preference?.addEventListener("change", followPreference);
onBeforeUnmount(() => preference?.removeEventListener("change", followPreference));
watchEffect(() => {
  document.documentElement.dataset.theme = dark.value ? "dark" : "light";
});
function saveChoice() {
  explicitChoice = true;
  try { localStorage.setItem(storageKey, dark.value ? "dark" : "light"); } catch { /* The toggle still works without storage. */ }
}
</script>

<template>
  <div class="theme-control">
    <img :src="sun" alt="Light mode" />
    <label class="switch theme-switch">
      <input v-model="dark" type="checkbox" role="switch" aria-label="Dark mode" :aria-checked="dark" @change="saveChoice" />
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
