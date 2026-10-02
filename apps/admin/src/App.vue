<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface ModuleStatus {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  chatCommands: Array<{ command: string; description: string }>;
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
  profile: ActorProfile | null;
}

interface ActorProfile {
  did: string;
  handle: string;
  displayName: string;
  avatar: string;
}

const modules = ref<ModuleStatus[]>([]);
const configuration = ref<PokemonBlueConfiguration>({
  components: { team: true, badges: true },
});
const streamConfiguration = ref<StreamConfiguration>({ streamerDid: "", profile: null });
const streamerQuery = ref("");
const actorSuggestions = ref<ActorProfile[]>([]);
const actorSearchOpen = ref(false);
const copiedModuleId = ref<string | null>(null);
const streamMessage = ref("");
const pokemonMessage = ref("");
const origin = computed(() => location.origin);
let loaded = false;
let actorSearchTimer: ReturnType<typeof setTimeout> | undefined;
let pokemonSaveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();
let actorSearchSequence = 0;
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

function overlayUrl(module: ModuleStatus) {
  const url = new URL(module.overlayUrl, origin.value);
  if (streamConfiguration.value.streamerDid) url.searchParams.set("streamer", streamConfiguration.value.streamerDid);
  return url.toString();
}

async function copyOverlayUrl(module: ModuleStatus) {
  try {
    await navigator.clipboard.writeText(overlayUrl(module));
    copiedModuleId.value = module.id;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => { copiedModuleId.value = null; }, 1800);
  } catch {
    copiedModuleId.value = null;
  }
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
  streamerQuery.value = streamConfiguration.value.profile?.handle || streamConfiguration.value.streamerDid;
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

async function selectStreamer(identity: string) {
  streamMessage.value = "Loading profile…";
  actorSearchOpen.value = false;
  try {
    const response = await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamerDid: identity }),
    });
    const result = await response.json() as StreamConfiguration | { error?: string };
    if (!response.ok) {
      streamMessage.value = "error" in result && result.error ? result.error : "Could not save configuration";
      return;
    }
    streamConfiguration.value = result as StreamConfiguration;
    streamerQuery.value = streamConfiguration.value.profile?.handle || streamConfiguration.value.streamerDid;
    actorSuggestions.value = [];
    streamMessage.value = "Selected and saved";
  } catch {
    streamMessage.value = "Could not save configuration";
  }
}

async function searchStreamer(query: string, sequence: number) {
  try {
    const response = await fetch(`/api/actors/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const result = await response.json() as { actors?: Array<{
      did: string; handle: string; displayName: string; avatar: string;
    }> };
    if (sequence !== actorSearchSequence) return;
    actorSuggestions.value = result.actors ?? [];
    actorSearchOpen.value = actorSuggestions.value.length > 0;
  } catch {
    if (sequence === actorSearchSequence) actorSearchOpen.value = false;
  }
}

function enqueueSave(save: () => Promise<void>) {
  saveQueue = saveQueue.then(save, save);
}

watch(streamerQuery, (query) => {
  if (!loaded) return;
  if (query === streamConfiguration.value.profile?.handle || query === streamConfiguration.value.streamerDid) {
    actorSearchOpen.value = false;
    return;
  }
  streamMessage.value = "";
  if (actorSearchTimer) clearTimeout(actorSearchTimer);
  const sequence = ++actorSearchSequence;
  if (query.trim().replace(/^@/, "").length < 2) {
    actorSuggestions.value = [];
    actorSearchOpen.value = false;
    return;
  }
  actorSearchTimer = setTimeout(() => void searchStreamer(query, sequence), 300);
});

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
  if (actorSearchTimer) clearTimeout(actorSearchTimer);
  if (pokemonSaveTimer) clearTimeout(pokemonSaveTimer);
  if (copyResetTimer) clearTimeout(copyResetTimer);
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
      <div v-if="streamConfiguration.streamerDid" class="selected-streamer">
        <img v-if="streamConfiguration.profile?.avatar" :src="streamConfiguration.profile.avatar" alt="">
        <span v-else class="avatar-placeholder" aria-hidden="true" />
        <span>
          <strong>{{ streamConfiguration.profile?.displayName || streamConfiguration.profile?.handle || "Profile unavailable" }}</strong>
          <small v-if="streamConfiguration.profile">@{{ streamConfiguration.profile.handle }}</small>
          <small v-else>{{ streamConfiguration.streamerDid }}</small>
        </span>
      </div>
      <label class="actor-search">
        Streamer account
        <input
          v-model="streamerQuery"
          placeholder="Search name, handle, or paste a DID"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="actorSearchOpen"
          @focus="actorSearchOpen = actorSuggestions.length > 0"
          @keydown.enter.prevent="selectStreamer(streamerQuery)"
          @keydown.esc="actorSearchOpen = false"
        >
        <span v-if="actorSearchOpen" class="actor-suggestions" role="listbox">
          <button
            v-for="actor in actorSuggestions"
            :key="actor.did"
            type="button"
            role="option"
            @click="selectStreamer(actor.did)"
          >
            <img v-if="actor.avatar" :src="actor.avatar" alt="">
            <span v-else class="avatar-placeholder" aria-hidden="true" />
            <span>
              <strong>{{ actor.displayName || actor.handle }}</strong>
              <small>@{{ actor.handle }}</small>
            </span>
          </button>
        </span>
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
            <div class="module-actions">
              <span class="module-help">
                <button
                  type="button"
                  class="info-button"
                  :aria-label="`About ${module.name}`"
                  :aria-describedby="`module-help-${module.id}`"
                >i</button>
                <span :id="`module-help-${module.id}`" class="module-tooltip" role="tooltip">
                  <strong>{{ module.description || `Controls the ${module.name} overlay.` }}</strong>
                  <span class="tooltip-obs">
                    <b>Use in OBS</b>
                    <span>Add a Browser Source and paste the URL shown below.</span>
                  </span>
                  <span v-if="module.requirements?.length" class="tooltip-requirements">
                    <b>Setup</b>
                    <span v-for="requirement in module.requirements" :key="requirement">• {{ requirement }}</span>
                  </span>
                </span>
              </span>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="module.enabled"
                  :aria-label="`Enable ${module.name}`"
                  @change="toggle(module)"
                >
                <span />
              </label>
            </div>
          </div>
          <div class="overlay-url">
            <code>{{ overlayUrl(module) }}</code>
            <button
              type="button"
              class="copy-button"
              :class="{ copied: copiedModuleId === module.id }"
              :aria-label="copiedModuleId === module.id ? `${module.name} OBS URL copied` : `Copy ${module.name} OBS URL`"
              @click="copyOverlayUrl(module)"
            >
              <span class="copy-icon" aria-hidden="true" />
            </button>
            <span class="sr-only" aria-live="polite">{{ copiedModuleId === module.id ? "Copied" : "" }}</span>
          </div>
          <section v-if="module.chatCommands?.length" class="module-commands">
            <h4>Chat interactions</h4>
            <div v-for="chatCommand in module.chatCommands" :key="chatCommand.command" class="chat-command">
              <code>{{ chatCommand.command }}</code>
              <span>{{ chatCommand.description }}</span>
            </div>
          </section>
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
.module-grid { columns: 320px 2; column-gap: 16px; }
.module-card { display: inline-block; width: 100%; margin: 0 0 16px; break-inside: avoid; vertical-align: top; }
.module-card, .settings { padding: 24px; border: 1px solid #28334b; border-radius: 18px; background: rgba(18, 24, 38, 0.88); box-shadow: 0 16px 48px rgba(0,0,0,.24); }
.stream-settings { margin-bottom: 44px; }
.selected-streamer { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; background: #0b101c; }
.selected-streamer img, .actor-suggestions img, .avatar-placeholder { width: 44px; height: 44px; flex: 0 0 44px; border-radius: 50%; object-fit: cover; background: #303a51; }
.selected-streamer > span:last-child, .actor-suggestions button > span:last-child { display: grid; gap: 2px; min-width: 0; }
.selected-streamer small, .actor-suggestions small { color: #8f9bb4; font-weight: 500; }
.actor-search { position: relative; }
.actor-suggestions { position: absolute; z-index: 20; top: calc(100% + 8px); left: 0; right: 0; overflow: hidden; border: 1px solid #36425d; border-radius: 12px; background: #111827; box-shadow: 0 16px 40px rgba(0,0,0,.42); }
.actor-suggestions button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border: 0; color: #eaf0ff; background: transparent; text-align: left; font: inherit; cursor: pointer; }
.actor-suggestions button:hover, .actor-suggestions button:focus-visible { background: #202a40; outline: none; }
.module-heading { display: flex; justify-content: space-between; gap: 24px; }
h3 { margin: 0 0 8px; font-size: 1.25rem; }
.status { color: #9aa6c1; font-size: .8rem; text-transform: uppercase; letter-spacing: .1em; }
.status[data-status="running"] { color: #70e7a1; }
.status[data-status="failed"] { color: #ff7f91; }
.overlay-url { position: relative; margin-top: 22px; }
code { display: block; min-width: 0; padding: 12px 52px 12px 12px; overflow: auto; border-radius: 9px; color: #a9bdf9; background: #090d16; }
.copy-button { position: absolute; top: 50%; right: 7px; display: grid; place-items: center; width: 34px; height: 34px; padding: 8px; border: 0; border-radius: 7px; color: #8fa1c7; background: transparent; transform: translateY(-50%); cursor: pointer; }
.copy-button:hover, .copy-button:focus-visible { color: white; outline: none; background: #1a2540; }
.copy-button.copied { color: #70e7a1; }
.copy-icon { width: 100%; height: 100%; background: currentColor; -webkit-mask: url("./assets/copy-document.svg") center / contain no-repeat; mask: url("./assets/copy-document.svg") center / contain no-repeat; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.module-commands { display: grid; gap: 10px; margin-top: 16px; }
.module-commands h4 { margin: 0; color: #aebbd7; font-size: .78rem; text-transform: uppercase; letter-spacing: .1em; }
.chat-command { display: grid; gap: 7px; padding: 12px 14px; border: 1px solid #28334b; border-radius: 10px; background: #0b101c; }
.chat-command code { color: #9db2ff; font: 650 .95rem/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.chat-command span { color: #9aa6c1; font-size: .84rem; }
.module-preview { position: relative; margin-top: 16px; overflow: hidden; aspect-ratio: 16 / 9; border: 1px solid #28334b; border-radius: 10px; background-color: #0b101c; background-image: linear-gradient(45deg, #141c2b 25%, transparent 25%), linear-gradient(-45deg, #141c2b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #141c2b 75%), linear-gradient(-45deg, transparent 75%, #141c2b 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.module-preview iframe { width: 100%; height: 100%; border: 0; background: transparent; }
.error { color: #ff7f91; }
.switch input { position: absolute; opacity: 0; }
.switch span { display: block; width: 48px; height: 28px; padding: 3px; border-radius: 99px; background: #3a4356; cursor: pointer; transition: background .2s; }
.switch span::after { content: ""; display: block; width: 22px; height: 22px; border-radius: 50%; background: white; transition: transform .2s; }
.switch input:checked + span { background: #5d7cff; }
.switch input:checked + span::after { transform: translateX(20px); }
.module-actions { display: flex; align-items: center; gap: 10px; }
.module-help { position: relative; display: block; }
.info-button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid #485570; border-radius: 50%; color: #b9c6df; background: #111827; font: 700 .9rem/1 Georgia, serif; cursor: help; }
.info-button:hover, .info-button:focus-visible { color: #fff; border-color: #7794e8; outline: none; background: #1a2540; }
.module-tooltip { position: absolute; z-index: 10; top: calc(100% + 12px); right: 0; display: grid; gap: 8px; width: 340px; padding: 13px 15px; border: 1px solid #3a4661; border-radius: 10px; color: #dbe4f8; background: #111827; box-shadow: 0 12px 32px rgba(0,0,0,.38); font-size: .84rem; line-height: 1.4; opacity: 0; pointer-events: none; transform: translateY(-4px); transition: opacity .16s, transform .16s; }
.module-tooltip > span { display: block; }
.tooltip-obs, .tooltip-requirements { display: grid !important; gap: 4px; padding-top: 4px; color: #b9c6df; }
.tooltip-obs b, .tooltip-requirements b { color: #dbe4f8; }
.module-tooltip::before { content: ""; position: absolute; right: 7px; bottom: 100%; border: 7px solid transparent; border-bottom-color: #3a4661; }
.module-tooltip::after { content: ""; position: absolute; right: 8px; bottom: 100%; border: 6px solid transparent; border-bottom-color: #111827; }
.module-help:hover .module-tooltip, .module-help:focus-within .module-tooltip { opacity: 1; transform: translateY(0); }
.settings, .module-settings { display: grid; gap: 18px; }
.settings > h2 { margin: 0; }
.settings > label { display: grid; gap: 8px; color: #b9c3da; font-weight: 650; }
.settings input:not([type]) { width: 100%; padding: 12px 14px; border: 1px solid #36425d; border-radius: 9px; color: white; background: #0b101c; font: inherit; }
.module-settings { grid-template-columns: auto auto 1fr; align-items: center; margin-top: 22px; padding-top: 20px; border-top: 1px solid #28334b; }
.module-settings h4 { grid-column: 1 / -1; margin: 0; color: #b9c3da; }
.module-settings label { display: flex; align-items: center; gap: 8px; }
.module-message, .save-status { justify-self: end; min-width: 3.5em; color: #9aa6c1; font-size: .85rem; }
</style>
