<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { parseThoughtInterval, type PokemonBlueConfiguration } from "../../../modules/pokemon-blue/src/config.ts";

const props = defineProps<{ moduleId: string }>();
const configuration = ref<PokemonBlueConfiguration>({ components: { team: true, badges: true }, thoughtIntervalSeconds: 120 });
const message = ref("");
const armed = ref(false);
const resetting = ref(false);
let loaded = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let saves = Promise.resolve();
const endpoint = `/api/${props.moduleId}`;
onMounted(async () => {
  try {
    const response = await fetch(`${endpoint}/config`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load settings");
    configuration.value = { thoughtIntervalSeconds: 120, ...await response.json() };
    // Allow the watcher to process the initial load before accepting edits.
    await Promise.resolve(); loaded = true;
  } catch { message.value = "Could not load settings. Reload the Admin page to retry."; }
});
watch(configuration, value => {
  if (!loaded) return;
  clearTimeout(timer);
  if (parseThoughtInterval(value.thoughtIntervalSeconds) === null) { message.value = "Interval must be between 1 and 3600 seconds"; return; }
  const settings = JSON.stringify(value);
  message.value = "Saving…";
  timer = setTimeout(() => {
    saves = saves.then(async () => {
      try {
        const response = await fetch(`${endpoint}/config`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: settings });
        message.value = response.ok ? "Saved" : "Could not save settings";
      } catch { message.value = "Could not save settings"; }
    });
  }, 350);
}, { deep: true });
async function reset() {
  if (resetting.value) return;
  resetting.value = true;
  try {
    const response = await fetch(`${endpoint}/pet-counts`, { method: "DELETE" });
    if (!response.ok) throw new Error("Reset failed");
    message.value = "All pet counts reset"; armed.value = false;
  } catch { message.value = "Could not reset pet counts"; }
  finally { resetting.value = false; }
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="module-settings">
    <h4>Visible components</h4>
    <label><input v-model="configuration.components.team" type="checkbox"> Team</label>
    <label><input v-model="configuration.components.badges" type="checkbox"> Badges (Johto and Kanto)</label>
    <h4>Thought bubbles</h4>
    <label>Interval (seconds)<input v-model.number="configuration.thoughtIntervalSeconds" type="number" min="1" max="3600" step="1" aria-label="Crystal thought bubble interval in seconds"></label>
    <span>Time between team members thinking of their favourite petter. Changes apply live.</span>
    <div class="pet-reset">
      <button v-if="!armed" type="button" @click="armed = true">Reset pet counts</button>
      <template v-else>
        <span>Clear all Crystal pet counts for every Pokémon and streamer? This cannot be undone.</span>
        <button type="button" :disabled="resetting" @click="reset">Confirm reset</button>
        <button type="button" :disabled="resetting" @click="armed = false">Cancel</button>
      </template>
    </div>
    <span class="module-message" aria-live="polite">{{ message }}</span>
  </div>
</template>
