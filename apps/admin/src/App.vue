<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface ModuleStatus {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  enabled: boolean;
  status: "running" | "stopped" | "failed";
  overlayUrl: string;
  error: string | null;
}

interface PokemonBlueConfiguration {
  components: { team: boolean; badges: boolean };
}

interface StreamConfiguration {
  streamerDid: string;
}

const modules = ref<ModuleStatus[]>([]);
const configuration = ref<PokemonBlueConfiguration>({
  components: { team: true, badges: true },
});
const streamConfiguration = ref<StreamConfiguration>({ streamerDid: "" });
const streamMessage = ref("");
const pokemonMessage = ref("");
const origin = computed(() => location.origin);
let loaded = false;
let streamSaveTimer: ReturnType<typeof setTimeout> | undefined;
let pokemonSaveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();

function overlayUrl(module: ModuleStatus) {
  const url = new URL(module.overlayUrl, origin.value);
  if (streamConfiguration.value.streamerDid) url.searchParams.set("streamer", streamConfiguration.value.streamerDid);
  return url.toString();
}

async function load() {
  const [modulesResponse, configResponse, streamConfigResponse] = await Promise.all([
    fetch("/api/modules", { cache: "no-store" }),
    fetch("/api/pokemon-blue/config", { cache: "no-store" }),
    fetch("/api/config", { cache: "no-store" }),
  ]);
  modules.value = await modulesResponse.json() as ModuleStatus[];
  configuration.value = await configResponse.json() as PokemonBlueConfiguration;
  streamConfiguration.value = await streamConfigResponse.json() as StreamConfiguration;
}

async function toggle(module: ModuleStatus) {
  const response = await fetch(`/api/modules/${module.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: !module.enabled }),
  });
  const updated = await response.json() as ModuleStatus;
  modules.value = modules.value.map((candidate) => candidate.id === updated.id ? updated : candidate);
}

async function savePokemonConfiguration() {
  pokemonMessage.value = "Saving…";
  try {
    const response = await fetch("/api/pokemon-blue/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configuration.value),
    });
    pokemonMessage.value = response.ok ? "Saved" : "Could not save configuration";
  } catch {
    pokemonMessage.value = "Could not save configuration";
  }
}

async function saveStreamConfiguration() {
  streamMessage.value = "Saving…";
  try {
    const response = await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(streamConfiguration.value),
    });
    streamMessage.value = response.ok ? "Saved" : "Could not save configuration";
  } catch {
    streamMessage.value = "Could not save configuration";
  }
}

function enqueueSave(save: () => Promise<void>) {
  saveQueue = saveQueue.then(save, save);
}

watch(streamConfiguration, () => {
  if (!loaded) return;
  streamMessage.value = "Saving…";
  if (streamSaveTimer) clearTimeout(streamSaveTimer);
  streamSaveTimer = setTimeout(() => enqueueSave(saveStreamConfiguration), 350);
}, { deep: true });

watch(configuration, () => {
  if (!loaded) return;
  pokemonMessage.value = "Saving…";
  if (pokemonSaveTimer) clearTimeout(pokemonSaveTimer);
  pokemonSaveTimer = setTimeout(() => enqueueSave(savePokemonConfiguration), 350);
}, { deep: true });

onMounted(async () => {
  await load();
  loaded = true;
});

onBeforeUnmount(() => {
  if (streamSaveTimer) clearTimeout(streamSaveTimer);
  if (pokemonSaveTimer) clearTimeout(pokemonSaveTimer);
});
</script>

<template>
  <main>
    <header>
      <p class="eyebrow">STREAM OVERLAY</p>
      <h1>Control room</h1>
      <p class="intro">Manage local overlay modules and copy their stable OBS URLs.</p>
    </header>

    <section class="settings stream-settings">
      <h2>Stream</h2>
      <label>
        Streamer DID
        <input v-model.trim="streamConfiguration.streamerDid" placeholder="did:plc:…">
      </label>
      <span class="save-status" aria-live="polite">{{ streamMessage }}</span>
    </section>

    <section>
      <h2>Modules</h2>
      <div class="module-grid">
        <article v-for="module in modules" :key="module.id" class="module-card">
          <div class="module-heading">
            <div>
              <h3>{{ module.name }}</h3>
              <span class="status" :data-status="module.status">{{ module.status }}</span>
            </div>
            <span class="toggle-help">
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="module.enabled"
                  :aria-label="`Enable ${module.name}`"
                  :aria-describedby="`module-help-${module.id}`"
                  @change="toggle(module)"
                >
                <span />
              </label>
              <span :id="`module-help-${module.id}`" class="toggle-tooltip" role="tooltip">
                <strong>{{ module.description || `Controls the ${module.name} overlay.` }}</strong>
                <span>Switching it off stops the module while its OBS source stays available but transparent.</span>
                <span v-if="module.requirements?.length" class="tooltip-requirements">
                  <b>Requires</b>
                  <span v-for="requirement in module.requirements" :key="requirement">• {{ requirement }}</span>
                </span>
              </span>
            </span>
          </div>
          <code>{{ overlayUrl(module) }}</code>
          <div class="module-preview">
            <iframe
              :src="overlayUrl(module)"
              :title="`${module.name} live preview`"
              loading="lazy"
            />
          </div>
          <p v-if="module.error" class="error">{{ module.error }}</p>
          <div v-if="module.id === 'pokemon-blue'" class="module-settings">
            <h4>Visible components</h4>
            <label><input v-model="configuration.components.team" type="checkbox"> Team</label>
            <label><input v-model="configuration.components.badges" type="checkbox"> Badges</label>
            <span class="module-message" aria-live="polite">{{ pokemonMessage }}</span>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style>
:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #eaf0ff; background: #080b12; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at 20% 0%, #1e2843 0, transparent 38%), #080b12; }
main { width: min(1040px, calc(100% - 40px)); margin: 0 auto; padding: 64px 0 96px; }
header { margin-bottom: 48px; }
.eyebrow { margin: 0 0 8px; color: #88a6ff; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.18em; }
h1 { margin: 0; font-size: clamp(2.6rem, 7vw, 5.6rem); line-height: 0.95; letter-spacing: -0.055em; }
.intro { max-width: 560px; color: #9aa6c1; font-size: 1.05rem; }
section { margin-top: 44px; }
h2 { margin-bottom: 18px; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.12em; color: #aebbd7; }
.module-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.module-card, .settings { padding: 24px; border: 1px solid #28334b; border-radius: 18px; background: rgba(18, 24, 38, 0.88); box-shadow: 0 16px 48px rgba(0,0,0,.24); }
.stream-settings { margin-bottom: 44px; }
.module-heading { display: flex; justify-content: space-between; gap: 24px; }
h3 { margin: 0 0 8px; font-size: 1.25rem; }
.status { color: #9aa6c1; font-size: .8rem; text-transform: uppercase; letter-spacing: .1em; }
.status[data-status="running"] { color: #70e7a1; }
.status[data-status="failed"] { color: #ff7f91; }
code { display: block; margin-top: 22px; padding: 12px; overflow: auto; border-radius: 9px; color: #a9bdf9; background: #090d16; }
.module-preview { position: relative; margin-top: 16px; overflow: hidden; aspect-ratio: 16 / 9; border: 1px solid #28334b; border-radius: 10px; background-color: #0b101c; background-image: linear-gradient(45deg, #141c2b 25%, transparent 25%), linear-gradient(-45deg, #141c2b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #141c2b 75%), linear-gradient(-45deg, transparent 75%, #141c2b 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.module-preview iframe { width: 100%; height: 100%; border: 0; background: transparent; }
.error { color: #ff7f91; }
.switch input { position: absolute; opacity: 0; }
.switch span { display: block; width: 48px; height: 28px; padding: 3px; border-radius: 99px; background: #3a4356; cursor: pointer; transition: background .2s; }
.switch span::after { content: ""; display: block; width: 22px; height: 22px; border-radius: 50%; background: white; transition: transform .2s; }
.switch input:checked + span { background: #5d7cff; }
.switch input:checked + span::after { transform: translateX(20px); }
.toggle-help { position: relative; display: block; }
.toggle-tooltip { position: absolute; z-index: 10; top: calc(100% + 12px); right: 0; display: grid; gap: 8px; width: 340px; padding: 13px 15px; border: 1px solid #3a4661; border-radius: 10px; color: #dbe4f8; background: #111827; box-shadow: 0 12px 32px rgba(0,0,0,.38); font-size: .84rem; line-height: 1.4; opacity: 0; pointer-events: none; transform: translateY(-4px); transition: opacity .16s, transform .16s; }
.toggle-tooltip > span { display: block; }
.tooltip-requirements { display: grid !important; gap: 4px; padding-top: 4px; color: #b9c6df; }
.tooltip-requirements b { color: #dbe4f8; }
.toggle-tooltip::before { content: ""; position: absolute; right: 15px; bottom: 100%; border: 7px solid transparent; border-bottom-color: #3a4661; }
.toggle-tooltip::after { content: ""; position: absolute; right: 16px; bottom: 100%; border: 6px solid transparent; border-bottom-color: #111827; }
.toggle-help:hover .toggle-tooltip, .toggle-help:focus-within .toggle-tooltip { opacity: 1; transform: translateY(0); }
.settings, .module-settings { display: grid; gap: 18px; }
.settings > h2 { margin: 0; }
.settings > label { display: grid; gap: 8px; color: #b9c3da; font-weight: 650; }
.settings input:not([type]) { width: 100%; padding: 12px 14px; border: 1px solid #36425d; border-radius: 9px; color: white; background: #0b101c; font: inherit; }
.module-settings { grid-template-columns: auto auto 1fr; align-items: center; margin-top: 22px; padding-top: 20px; border-top: 1px solid #28334b; }
.module-settings h4 { grid-column: 1 / -1; margin: 0; color: #b9c3da; }
.module-settings label { display: flex; align-items: center; gap: 8px; }
.module-message, .save-status { justify-self: end; min-width: 3.5em; color: #9aa6c1; font-size: .85rem; }
</style>
