<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { defaultChatConfiguration, parseChatConfiguration } from "../../../modules/chat/src/config";
import { parseThoughtInterval, type PokemonBlueConfiguration } from "../../../modules/pokemon-blue/src/config";

interface ModuleStatus {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  configurationLink?: { url: string; label: string; description: string };
  chatCommands: Array<{ command: string; description: string }>;
  preview?: { streamBackground?: boolean; interactive?: boolean };
  obsSize?: "stream-height";
  streamerQuery?: boolean;
  enabled: boolean;
  status: "running" | "stopped" | "failed";
  overlayUrl: string;
  error: string | null;
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
const moduleQuery = ref("");
const expandedModules = ref<Record<string, boolean>>({});
const pinStorageKey = "stream-overlay.admin.pinned-modules";
const pinnedModuleIds = ref<string[]>(readPins());
function readPins(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pinStorageKey) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
  } catch { return []; }
}
function isPinned(id: string) { return pinnedModuleIds.value.includes(id); }
function togglePin(id: string) {
  pinnedModuleIds.value = isPinned(id) ? pinnedModuleIds.value.filter(candidate => candidate !== id) : [...pinnedModuleIds.value, id];
  // These are browser-only layout preferences, not settings used by OBS.
  try { localStorage.setItem(pinStorageKey, JSON.stringify(pinnedModuleIds.value)); } catch { /* Keep working when browser storage is unavailable. */ }
}
function isExpanded(module: ModuleStatus) {
  return expandedModules.value[module.id] ?? false;
}
function toggleDetails(module: ModuleStatus) {
  expandedModules.value[module.id] = !isExpanded(module);
}
function matchesSearch(module: ModuleStatus) {
  const query = moduleQuery.value.trim().toLocaleLowerCase();
  return `${module.name} ${module.description}`.toLocaleLowerCase().includes(query);
}
const orderedModules = computed(() => [...modules.value].sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id))));
const matchingModuleCount = computed(() => modules.value.filter(matchesSearch).length);
const configuration = ref<PokemonBlueConfiguration>({
  thoughtIntervalSeconds: 120,
  components: { team: true, badges: true },
});
const streamConfiguration = ref<StreamConfiguration>({ streamerDid: "", profile: null });
const streamerQuery = ref("");
const actorSuggestions = ref<ActorProfile[]>([]);
const actorSearchOpen = ref(false);
const copiedModuleId = ref<string | null>(null);
const streamMessage = ref("");
const pokemonMessage = ref("");
const petResetArmed = ref(false);
const petResetBusy = ref(false);
const petResetMessage = ref("");
const paintConfiguration = ref({ color: "#ff5cbe", decaySeconds: 4 });
const chatConfiguration = ref({ ...defaultChatConfiguration });
const chatMessage = ref("");
let chatSaveTimer: ReturnType<typeof setTimeout> | undefined;
const paintMessage = ref("");
let paintSaveTimer: ReturnType<typeof setTimeout> | undefined;
const obsDimensions = computed(() => streamDimensions.value ?? { width: 1920, height: 1080 });
const streamDimensions = ref<{ width: number; height: number } | null>(null);
let dimensionsSequence = 0;
let dimensionsTimer: ReturnType<typeof setInterval> | undefined;
const streamEmbedUrl = computed(() => {
  const handle = streamConfiguration.value.profile?.handle;
  return handle ? `https://stream.place/embed/${encodeURIComponent(handle)}` : "";
});
const origin = computed(() => location.origin);
let loaded = false;
let actorSearchTimer: ReturnType<typeof setTimeout> | undefined;
let pokemonSaveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();
let actorSearchSequence = 0;
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

function overlayUrl(module: ModuleStatus) {
  const url = new URL(module.overlayUrl, origin.value);
  if (module.streamerQuery !== false && streamConfiguration.value.streamerDid) {
    url.searchParams.set("streamer", streamConfiguration.value.streamerDid);
  }
  return url.toString();
}

function previewUrl(module: ModuleStatus) {
  const url = new URL(overlayUrl(module));
  if (module.preview?.interactive) url.searchParams.set("interactive", "1");
  return url.toString();
}

async function refreshStreamDimensions() {
  const sequence = ++dimensionsSequence;
  const did = streamConfiguration.value.streamerDid;
  if (!did || !modules.value.some(module => module.preview?.streamBackground || module.obsSize)) {
    streamDimensions.value = null;
    return;
  }
  try {
    const response = await fetch("/api/stream/dimensions", { cache: "no-store" });
    if (!response.ok) throw new Error("Dimensions unavailable");
    const result = await response.json() as { streamerDid: string; dimensions: { width: number; height: number } | null };
    if (sequence !== dimensionsSequence || did !== streamConfiguration.value.streamerDid) return;
    const dimensions = result.streamerDid === did ? result.dimensions : null;
    streamDimensions.value = dimensions && Number.isSafeInteger(dimensions.width) && dimensions.width > 0
      && Number.isSafeInteger(dimensions.height) && dimensions.height > 0 ? dimensions : null;
  } catch {
    if (sequence === dimensionsSequence) streamDimensions.value = null;
  }
}

watch(() => streamConfiguration.value.streamerDid, () => {
  streamDimensions.value = null;
  void refreshStreamDimensions();
});

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
  // Enabled cards start open, but their layout state is independent after loading.
  for (const module of modules.value) {
    if (!(module.id in expandedModules.value)) expandedModules.value[module.id] = module.enabled;
  }
  if (modules.value.some(module => module.id === "chat")) {
    const response = await fetch("/api/chat/config", { cache: "no-store" });
    if (response.ok) {
      const settings = await response.json();
      const parsed = parseChatConfiguration(settings);
      if (parsed) chatConfiguration.value = parsed;
    }
  }
  if (modules.value.some(module => module.id === "overlay-paint")) {
    const response = await fetch("/api/overlay-paint/config", { cache: "no-store" });
    if (response.ok) paintConfiguration.value = await response.json();
  }
  configuration.value = { thoughtIntervalSeconds: 120, ...await configResponse.json() as PokemonBlueConfiguration };
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
  if (parseThoughtInterval(configuration.value.thoughtIntervalSeconds) === null) {
    pokemonMessage.value = "Thought interval must be between 1 and 3600 seconds";
    return;
  }
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

async function resetPetCounts() {
  if (petResetBusy.value) return;
  petResetBusy.value = true;
  petResetMessage.value = "Resetting…";
  try {
    const response = await fetch("/api/pokemon-blue/pet-counts", { method: "DELETE" });
    if (!response.ok) throw new Error("Reset failed");
    petResetMessage.value = "All pet counts reset";
    petResetArmed.value = false;
  } catch {
    petResetMessage.value = "Could not reset pet counts. Try again.";
  } finally { petResetBusy.value = false; }
}

async function savePaintConfiguration(configuration: { color: string; decaySeconds: number }) {
  paintMessage.value = "Saving…";
  try {
    const response = await fetch("/api/overlay-paint/config", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configuration),
    });
    paintMessage.value = response.ok ? "Saved" : "Could not save Paint settings";
  } catch { paintMessage.value = "Could not save Paint settings"; }
}

watch(chatConfiguration, value => {
  if (!loaded) return;
  clearTimeout(chatSaveTimer);
  const configuration = parseChatConfiguration(value);
  if (!configuration) {
    chatMessage.value = "Use a font size from 8 to 72 px, percentages from 0 to 100, and rotation from −180° to 180°";
    return;
  }
  chatMessage.value = "Saving…";
  chatSaveTimer = setTimeout(() => enqueueSave(async () => {
    try {
      const response = await fetch("/api/chat/config", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configuration),
      });
      chatMessage.value = response.ok ? "Saved" : "Could not save Chat settings";
    } catch { chatMessage.value = "Could not save Chat settings"; }
  }), 250);
}, { deep: true });

watch(paintConfiguration, value => {
  if (!loaded) return;
  if (paintSaveTimer) clearTimeout(paintSaveTimer);
  if (!Number.isFinite(value.decaySeconds) || value.decaySeconds < 0.1 || value.decaySeconds > 60) {
    paintMessage.value = "Enter a delay from 0.1 to 60 seconds";
    return;
  }
  const configuration = { ...value };
  paintMessage.value = "Saving…";
  paintSaveTimer = setTimeout(() => enqueueSave(() => savePaintConfiguration(configuration)), 250);
}, { deep: true });

let streamerSelectionSequence = 0;
function selectStreamer(identity: string) {
  const sequence = ++streamerSelectionSequence;
  streamMessage.value = "Loading profile…";
  actorSearchOpen.value = false;
  enqueueSave(() => saveStreamer(identity, sequence));
}

async function saveStreamer(identity: string, sequence: number) {
  try {
    const response = await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamerDid: identity }),
    });
    const result = await response.json() as StreamConfiguration | { error?: string };
    if (sequence !== streamerSelectionSequence) return;
    if (!response.ok) {
      streamMessage.value = "error" in result && result.error ? result.error : "Could not save configuration";
      return;
    }
    streamConfiguration.value = result as StreamConfiguration;
    streamerQuery.value = streamConfiguration.value.profile?.handle || streamConfiguration.value.streamerDid;
    actorSuggestions.value = [];
    streamMessage.value = "Selected and saved";
  } catch {
    if (sequence === streamerSelectionSequence) streamMessage.value = "Could not save configuration";
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
  // Only metadata is refreshed, not the video or canvas iframe.
  dimensionsTimer = setInterval(() => void refreshStreamDimensions(), 30_000);
});

onBeforeUnmount(() => {
  clearTimeout(chatSaveTimer);
  if (paintSaveTimer) clearTimeout(paintSaveTimer);
  dimensionsSequence++;
  if (dimensionsTimer) clearInterval(dimensionsTimer);
  if (actorSearchTimer) clearTimeout(actorSearchTimer);
  if (pokemonSaveTimer) clearTimeout(pokemonSaveTimer);
  if (copyResetTimer) clearTimeout(copyResetTimer);
});
</script>

<template>
  <main>
    <header>
      <p class="eyebrow">STREAM.PLACE OVERLAY</p>
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
      <label class="module-search">
        <span class="sr-only">Search modules</span>
        <input v-model="moduleQuery" type="search" placeholder="Search modules…" aria-label="Search modules">
      </label>
      <p v-if="modules.length && !matchingModuleCount" class="no-modules" role="status">No modules match your search.</p>
      <div class="module-grid">
        <article v-for="module in orderedModules" v-show="matchesSearch(module)" :key="module.id" class="module-card" :class="{ pinned: isPinned(module.id), collapsed: !isExpanded(module) }">
          <div class="module-heading">
            <div>
              <h3>{{ module.name }}</h3>
              <span class="status" :data-status="module.status">{{ module.status }}</span>
            </div>
            <div class="module-actions">
              <button type="button" class="module-icon-button pin-button" :aria-label="`${isPinned(module.id) ? 'Unpin' : 'Pin'} ${module.name}`" :aria-pressed="isPinned(module.id)" @click="togglePin(module.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-4 1-4 5-1 4-3-3-6 6 6-6-3-3 4-1 5-4z" /></svg>
              </button>
              <button type="button" class="module-icon-button" :aria-label="`${isExpanded(module) ? 'Hide' : 'Show'} ${module.name} details`" :aria-expanded="isExpanded(module)" :aria-controls="`module-body-${module.id}`" @click="toggleDetails(module)">
                <svg viewBox="0 0 24 24" aria-hidden="true" :class="{ expanded: isExpanded(module) }"><path d="m6 9 6 6 6-6" /></svg>
              </button>
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
          <div v-show="isExpanded(module)" :id="`module-body-${module.id}`" class="module-body">
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
          <section v-if="module.configurationLink" class="module-commands">
            <h4>External configuration</h4>
            <div class="chat-command">
              <a class="configuration-link" :href="module.configurationLink.url" target="_blank" rel="noopener noreferrer">{{ module.configurationLink.label }}</a>
              <span>{{ module.configurationLink.description }}</span>
            </div>
          </section>
          <section v-if="module.chatCommands?.length" class="module-commands">
            <h4>Chat interactions</h4>
            <div v-for="chatCommand in module.chatCommands" :key="chatCommand.command" class="chat-command">
              <code>{{ chatCommand.command }}</code>
              <span>{{ chatCommand.description }}</span>
            </div>
          </section>
          <section v-if="module.preview?.streamBackground || module.obsSize" class="module-commands obs-dimensions">
            <h4>OBS Browser Source size</h4>
            <div class="chat-command">
              <code><template v-if="module.preview?.streamBackground">Width: {{ obsDimensions.width }} px<br></template>Height: {{ obsDimensions.height }} px</code>
              <span v-if="module.obsSize">Set your OBS browser source to this height; choose the width for your chat column. {{ streamDimensions ? "Height matches your stream." : "1080 px fallback — stream height is not available yet." }}</span>
              <span v-else-if="streamDimensions">Matches your stream's video aspect ratio. Place this source above your video.</span>
              <span v-else>16:9 fallback — stream dimensions are not available yet.</span>
            </div>
          </section>
          <div
            class="module-preview"
            :style="module.preview?.streamBackground && streamDimensions
              ? { aspectRatio: `${streamDimensions.width} / ${streamDimensions.height}` } : undefined"
          >
            <iframe
              v-if="module.preview?.streamBackground && streamEmbedUrl"
              class="stream-background"
              :src="streamEmbedUrl"
              title="Stream.place background stream"
              allow="autoplay; fullscreen"
              loading="lazy"
            />
            <iframe
              :src="previewUrl(module)"
              :class="{ 'paint-foreground': module.preview?.interactive }"
              :title="`${module.name} live preview`"
              loading="lazy"
            />
          </div>
          <div v-if="module.preview?.interactive" class="paint-instructions">
            <p>Draw using a mouse, pen or touch. New input postpones fading for the whole drawing.</p>
            <p v-if="!streamEmbedUrl">Select your streamer account above to see your stream behind the canvas.</p>
          </div>
          <div v-if="module.id === 'chat'" class="module-settings chat-settings">
            <label>Perspective strength: {{ chatConfiguration.perspectiveStrength }}%
              <input v-model.number="chatConfiguration.perspectiveStrength" type="range" min="0" max="100" step="1" aria-label="Chat perspective strength">
              <span>Subtle at 0%; stronger near/far size differences at 100%. Requires X or Y rotation.</span>
            </label>
            <label>3D rotation X (tilt up/down): {{ chatConfiguration.rotationX }}°
              <input v-model.number="chatConfiguration.rotationX" type="range" min="-180" max="180" step="1" aria-label="Chat X rotation">
            </label>
            <label>3D rotation Y (tilt left/right): {{ chatConfiguration.rotationY }}°
              <input v-model.number="chatConfiguration.rotationY" type="range" min="-180" max="180" step="1" aria-label="Chat Y rotation">
            </label>
            <label>Font size (px)
              <input v-model.number="chatConfiguration.fontSize" type="number" min="8" max="72" step="1" aria-label="Chat font size">
            </label>
            <label>Message background color
              <input v-model="chatConfiguration.backgroundColor" type="color" aria-label="Chat message background color">
            </label>
            <label>Message background opacity: {{ chatConfiguration.backgroundOpacity }}%
              <input v-model.number="chatConfiguration.backgroundOpacity" type="range" min="0" max="100" step="1" aria-label="Chat message background opacity">
            </label>
            <label>Fade out from top: {{ chatConfiguration.fadeOut }}%
              <input v-model.number="chatConfiguration.fadeOut" type="range" min="0" max="100" step="1" aria-label="Chat fade-out percentage">
            </label>
            <span>0% shows the full height; 80% hides the upper 80% with a soft edge; 100% hides all messages.</span>
            <span class="module-message" aria-live="polite">{{ chatMessage }}</span>
          </div>
          <div v-if="module.id === 'overlay-paint'" class="module-settings paint-settings">
            <h4>Brush settings</h4>
            <label>Color <input v-model="paintConfiguration.color" type="color" aria-label="Paint brush color"></label>
            <label>Fade delay (seconds) <input v-model.number="paintConfiguration.decaySeconds" type="number" min="0.1" max="60" step="0.1" aria-label="Paint fade delay in seconds"></label>
            <span class="module-message" aria-live="polite">{{ paintMessage }}</span>
          </div>
          <div v-if="module.id === 'pokemon-blue'" class="module-settings">
            <h4>Visible components</h4>
            <label><input v-model="configuration.components.team" type="checkbox"> Team</label>
            <label><input v-model="configuration.components.badges" type="checkbox"> Badges</label>
            <h4>Thought bubbles</h4>
            <label>Interval (seconds)
              <input v-model.number="configuration.thoughtIntervalSeconds" type="number" min="1" max="3600" step="1" aria-label="Thought bubble interval in seconds">
            </label>
            <span>Time between team members thinking of their favourite petter. Changes apply live.</span>
            <span class="module-message" aria-live="polite">{{ pokemonMessage }}</span>
            <div class="pet-reset">
              <button v-if="!petResetArmed" type="button" @click="petResetArmed = true; petResetMessage = ''">Reset pet counts</button>
              <template v-else>
                <span>Clear all saved pet counts for every Pokémon and streamer? This cannot be undone.</span>
                <button type="button" :disabled="petResetBusy" @click="resetPetCounts">Confirm reset</button>
                <button type="button" :disabled="petResetBusy" @click="petResetArmed = false">Cancel</button>
              </template>
              <span class="module-message" aria-live="polite">{{ petResetMessage }}</span>
            </div>
          </div>
          </div>
          <p v-if="module.error" class="error">{{ module.error }}</p>
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
.module-search { display: block; margin-bottom: 20px; }
.module-search input { width: 100%; padding: 12px 14px; border: 1px solid #36425d; border-radius: 9px; color: white; background: #0b101c; font: inherit; }
.module-search input:focus-visible { outline: 2px solid #7794e8; outline-offset: 2px; }
.no-modules { color: #9aa6c1; }
.module-card.pinned { border-color: #526baf; }
.module-icon-button { display: grid; place-items: center; width: 24px; height: 28px; padding: 3px; border: 0; border-radius: 6px; background: transparent; color: #8fa1c7; cursor: pointer; }
.module-icon-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.module-icon-button:hover, .module-icon-button:focus-visible { color: white; background: #1a2540; outline: 2px solid #7794e8; }
.pin-button[aria-pressed="true"] { color: #a9bdf9; }
.pin-button[aria-pressed="true"] svg { fill: #526baf; }
.module-icon-button svg.expanded { transform: rotate(180deg); }
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
.module-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; }
.module-heading > div:first-child { flex: 1 1 120px; min-width: 0; }
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
.configuration-link { color: #9db2ff; font-size: .9rem; }
.module-preview { position: relative; margin-top: 16px; overflow: hidden; aspect-ratio: 16 / 9; border: 1px solid #28334b; border-radius: 10px; background-color: #0b101c; background-image: linear-gradient(45deg, #141c2b 25%, transparent 25%), linear-gradient(-45deg, #141c2b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #141c2b 75%), linear-gradient(-45deg, transparent 75%, #141c2b 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.module-preview iframe { width: 100%; height: 100%; border: 0; background: transparent; }
.module-preview .stream-background, .module-preview .paint-foreground { position: absolute; inset: 0; }
.module-preview .paint-foreground { z-index: 1; }
.paint-instructions { margin-top: 14px; color: #9aa6c1; font-size: .85rem; }
.paint-instructions label { display: flex; align-items: center; gap: 8px; color: #b9c3da; }
.paint-instructions p { margin: 8px 0 0; }
.paint-settings { grid-template-columns: 1fr 1fr; }
.paint-settings label { display: grid; align-content: start; }
.paint-settings input[type="color"] { width: 44px; height: 32px; padding: 2px; border: 1px solid #36425d; border-radius: 7px; background: #0b101c; cursor: pointer; }
.paint-settings input[type="number"] { width: 100%; max-width: 120px; padding: 7px 9px; border: 1px solid #36425d; border-radius: 7px; color: white; background: #0b101c; font: inherit; }
.paint-settings .module-message { grid-column: 1 / -1; }
.error { color: #ff7f91; }
.pet-reset { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.pet-reset > span { flex-basis: 100%; }
.pet-reset button { padding: 5px 9px; border: 1px solid #485570; border-radius: 6px; background: #111827; color: #eaf0ff; font: inherit; font-size: .8rem; cursor: pointer; }
.pet-reset button:hover, .pet-reset button:focus-visible { border-color: #ff7f91; outline: 2px solid #ff7f91; outline-offset: 2px; }
.pet-reset button:disabled { opacity: .5; cursor: wait; }
.switch input { position: absolute; opacity: 0; }
.switch span { display: block; width: 48px; height: 28px; padding: 3px; border-radius: 99px; background: #3a4356; cursor: pointer; transition: background .2s; }
.switch span::after { content: ""; display: block; width: 22px; height: 22px; border-radius: 50%; background: white; transition: transform .2s; }
.switch input:checked + span { background: #5d7cff; }
.switch input:checked + span::after { transform: translateX(20px); }
.module-actions { display: flex; align-items: center; flex: none; gap: 6px; }
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
.chat-settings { grid-template-columns: 1fr; }
.chat-settings label { flex-direction: column; align-items: stretch; }
.chat-settings input[type="range"] { width: 100%; accent-color: #a78bfa; cursor: pointer; }
.chat-settings input[type="color"] { width: 44px; height: 32px; padding: 2px; border: 1px solid #36425d; border-radius: 7px; background: #0b101c; cursor: pointer; }
.chat-settings input[type="number"] { width: 100%; max-width: 120px; padding: 7px 9px; border: 1px solid #36425d; border-radius: 7px; color: white; background: #0b101c; font: inherit; }
.chat-settings > span { color: #9aa6c1; font-size: .85rem; }
.module-message, .save-status { justify-self: end; min-width: 3.5em; color: #9aa6c1; font-size: .85rem; }
</style>
