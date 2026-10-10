<script setup lang="ts">
import BrandWordmark from "./BrandWordmark.vue";
import CollapseTransition from "./CollapseTransition.vue";
import DrawnTabs from "./DrawnTabs.vue";
import { vModuleWidth } from "./module-width-motion.ts";
import { adminFetch } from "./cloud-admin-fetch.ts";
import BrandMascot from "./BrandMascot.vue";
import StreamplaceBrand from "./StreamplaceBrand.vue";
import { getCloudModuleCatalog } from "../../../modules/catalog.ts";
import type { ModuleManifest as CloudModule } from "../../../packages/overlay-sdk/src/manifest.ts";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { attachActorCombobox } from "./actor-combobox.ts";
import {
  loadPublicActorProfile,
  searchPublicActors,
  type PublicActorProfile,
} from "./actor-search.ts";
import CloudEmoticonControls from "./CloudEmoticonControls.vue";
import CloudModuleControls from "./CloudModuleControls.vue";
import CollapsibleSection from "./CollapsibleSection.vue";
import ModuleHelp from "./ModuleHelp.vue";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
import type { ChatConfiguration } from "../../../modules/chat/src/config.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { useModuleCollection } from "./use-module-collection.ts";

const cloudModuleCatalog = getCloudModuleCatalog(import.meta.env.VITE_ENABLE_CLOUD_PETS === "true");

const sessionState = ref<"loading" | "anonymous" | "authenticated">("loading");
const loadState = ref<"loading" | "ready" | "error">("loading");
const did = ref("");
const config = ref<CloudConfig | null>(null);
const loginMessage = ref("");
const configurationMessage = ref("");
const moduleMessages = ref<Record<string, string>>({});
const saving = ref(false);
const profile = ref<PublicActorProfile | null>(null);
const profileState = ref<"loading" | "ready" | "unavailable">("loading");
const copied = ref<string | null>(null);
const dimensions = ref({ width: 1920, height: 1080 });
const dimensionsDetected = ref(false);
let dimensionsTimer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
function obsInstructions(moduleId: string) {
  const { width, height } = dimensions.value;
  const size =
    moduleId === "chat"
      ? `Set the height to ${height} px; choose the width for your chat column.`
      : `Set the browser source to ${width} × ${height} px to cover your stream.`;
  return [
    size,
    dimensionsDetected.value
      ? "Dimensions match your stream.place stream."
      : "1920 × 1080 fallback — stream dimensions are not available yet.",
    ...(moduleId === "emoticons"
      ? [
          "Add the command listing as a separate Browser Source. Start at 420 × 600 px and size it independently.",
        ]
      : []),
  ];
}
const listingPreviewOpen = ref(false);
const effectPreviewOpen = ref(false);
let chatPreviewFrame: HTMLIFrameElement | undefined;
let chatPreviewConfiguration: ChatConfiguration | undefined;
function updateChatPreview(configuration: ChatConfiguration) {
  chatPreviewConfiguration = configuration;
  chatPreviewFrame?.contentWindow?.postMessage(
    { type: "chat-preview-configuration", configuration },
    location.origin,
  );
}
function chatPreviewLoaded(event: Event) {
  chatPreviewFrame = event.target as HTMLIFrameElement;
  if (chatPreviewConfiguration) updateChatPreview(chatPreviewConfiguration);
}
const effectPreviewFrame = ref<HTMLIFrameElement>();
const listingPreviewFrame = ref<HTMLIFrameElement>();
const emoticonTab = ref("commands");
const emoticonTabs = computed(() => [
  { id: "commands", label: "Commands" },
  { id: "create", label: "Create new" },
]);
async function prepareEmoticonTest() {
  emoticonTab.value = "commands";
  effectPreviewOpen.value = true;
  await nextTick();
  const deadline = Date.now() + 10_000;
  while (!disposed && Date.now() < deadline) {
    if (
      effectPreviewFrame.value?.contentDocument?.documentElement?.dataset.overlayReady === "true"
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The emoticon preview could not connect. Please try Test again.");
}
const handleInput = ref<HTMLInputElement>();
const loginStatus = ref<HTMLElement>();
let autocomplete: ReturnType<typeof attachActorCombobox> | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
const cloudModules = ref<CloudModule[]>([...cloudModuleCatalog]);
const paths: Record<string, string> = Object.fromEntries(
  cloudModuleCatalog.map((module) => [module.id, module.cloud.pages[0].path]),
);
function moduleEnabled(id: string) {
  const module = cloudModuleCatalog.find((module) => module.id === id);
  if (!config.value || !module) return false;
  const key = module.cloud.enabledKey;
  return key === "emoticons" ? config.value.enabled : moduleSettings(config.value).modules[key];
}
function previewUrl(id: string) {
  const url = new URL(cloudUrl(paths[id]));
  url.searchParams.set("preview", "1");
  const module: CloudModule | undefined = cloudModuleCatalog.find((module) => module.id === id);
  if (module?.cloud.interactivePreview) url.searchParams.set("interactive", "1");
  return url.toString();
}
const streamUrl = computed(() =>
  did.value ? `https://stream.place/embed/${encodeURIComponent(did.value)}?muted=true` : "",
);
const {
  query: moduleQuery,
  isPinned,
  togglePin,
  isExpanded,
  toggleDetails,
  expandCard,
  matchesSearch,
  orderedModules,
  matchingCount,
} = useModuleCollection(cloudModules);
type ModuleDropControls = {
  acceptCardDrop: (
    files: FileList | null | undefined,
  ) => Promise<{ accepted: boolean; message?: string }>;
};
const moduleControls = new Map<string, ModuleDropControls>();
const cardDragDepth = ref<Record<string, number>>({});
function setModuleControls(id: string, value: unknown) {
  if (value) moduleControls.set(id, value as ModuleDropControls);
  else moduleControls.delete(id);
}
function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}
function cardDragEnter(id: string, event: DragEvent) {
  if (id !== "emoticons" || !hasFiles(event)) return;
  event.preventDefault();
  cardDragDepth.value[id] = (cardDragDepth.value[id] ?? 0) + 1;
}
function cardDragOver(event: DragEvent) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}
function cardDragLeave(id: string, event: DragEvent) {
  if (!hasFiles(event)) return;
  cardDragDepth.value[id] = Math.max(0, (cardDragDepth.value[id] ?? 1) - 1);
}
async function cardDrop(module: CloudModule, event: DragEvent) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  cardDragDepth.value[module.id] = 0;
  const result = await moduleControls.get(module.id)?.acceptCardDrop(event.dataTransfer?.files);
  if (!result) return;
  if (result.accepted) {
    if (!isExpanded(module)) toggleDetails(module);
  } else if (result.message) moduleMessages.value[module.id] = result.message;
}

const effectUrl = computed(() => cloudUrl("/effect/"));
const boardUrl = computed(() => cloudUrl("/board/"));
const listingPreviewUrl = computed(() => `${boardUrl.value}&preview=1`);
function cloudUrl(path: string) {
  const url = new URL(path, location.origin);
  if (did.value) url.searchParams.set("did", did.value);
  return url.toString();
}
async function parseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}
function initialConfig(): CloudConfig {
  return { enabled: true, streamerDid: did.value, revision: "new", commands: [] };
}
async function loadProfile() {
  profileState.value = "loading";
  try {
    profile.value = await loadPublicActorProfile(did.value);
    profileState.value = "ready";
  } catch {
    profile.value = null;
    profileState.value = "unavailable";
  }
}

async function loadConfiguration() {
  loadState.value = "loading";
  configurationMessage.value = "";
  try {
    const response = await adminFetch(`/api/accounts/${encodeURIComponent(did.value)}/config`, {
      cache: "no-store",
    });
    if (response.status === 404) {
      config.value = initialConfig();
      loadState.value = "ready";
      configurationMessage.value = "No PDS configuration yet. Your first save will create it.";
      return;
    }
    if (!response.ok)
      throw new Error(await parseError(response, "Could not load your PDS configuration."));
    config.value = { ...((await response.json()) as CloudConfig), streamerDid: did.value };
    loadState.value = "ready";
  } catch {
    loadState.value = "error";
    configurationMessage.value =
      "Could not load your PDS configuration. Nothing was replaced; retry when your PDS is available.";
  }
}
async function refreshStream() {
  if (!config.value) return;
  let result: { width: number; height: number } | null = null;
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(did.value)}/dimensions`, {
      cache: "no-store",
    });
    if (response.ok) {
      const value = (await response.json()).dimensions;
      if (
        value &&
        Number.isSafeInteger(value.width) &&
        value.width > 0 &&
        Number.isSafeInteger(value.height) &&
        value.height > 0
      )
        result = value;
    }
  } catch {
    /* Use the documented fallback until the stream is available. */
  }
  if (disposed) return;
  dimensionsDetected.value = result !== null;
  dimensions.value = result ?? { width: 1920, height: 1080 };
}
async function saveConfiguration(
  candidate: CloudConfig,
  _successMessage?: string,
  moduleId = "emoticons",
) {
  if (saving.value) return false;
  saving.value = true;
  moduleMessages.value[moduleId] = "";
  try {
    const response = await adminFetch(`/api/accounts/${encodeURIComponent(did.value)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...candidate, streamerDid: did.value }),
    });
    if (!response.ok) {
      let reason = "Your PDS could not save the configuration.";
      try {
        const body = (await response.json()) as {
          error?: string;
          message?: string;
          requestId?: string;
        };
        reason =
          body.message ||
          ({
            "invalid-origin": "Open this admin from its configured OAuth URL, then try again.",
            forbidden: "Sign in again before saving.",
            "pds-write-not-authorized":
              "Your ATProto session does not grant access to write these records.",
            "configuration-changed": "The configuration changed on your PDS. Reload and try again.",
            "pds-rejected-record": "Your PDS rejected the Streamface record format.",
          }[body.error ?? ""] ??
            reason);
        const requestId = body.requestId ?? response.headers.get("x-request-id");
        if (requestId) reason += ` Reference: ${requestId}`;
      } catch {
        /* Use the safe fallback. */
      }
      throw new Error(reason);
    }
    config.value = { ...((await response.json()) as CloudConfig), streamerDid: did.value };
    return true;
  } catch (error) {
    moduleMessages.value[moduleId] =
      `${error instanceof Error ? error.message : "Save failed."} Your last saved configuration is still active.`;
    return false;
  } finally {
    saving.value = false;
  }
}
async function toggleEnabled(module: CloudModule, event: Event) {
  if (!config.value) return;
  const input = event.target as HTMLInputElement;
  const candidate = { ...config.value, ...moduleSettings(config.value) };
  if (module.id === "emoticons") candidate.enabled = input.checked;
  else
    candidate.modules[
      module.id === "overlay-paint" ? "paint" : module.id === "streamplace-pets" ? "pets" : "chat"
    ] = input.checked;
  if (!(await saveConfiguration(candidate, undefined, module.id)))
    input.checked = moduleEnabled(module.id);
}
async function copyUrl(kind: string) {
  try {
    await navigator.clipboard.writeText(
      cloudUrl(kind === "board" ? "/board/" : kind === "effect" ? "/effect/" : paths[kind]),
    );
    copied.value = kind;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = null;
    }, 1800);
  } catch {
    copied.value = null;
  }
}
function login(event: Event) {
  const handle = String(
    new FormData(event.currentTarget as HTMLFormElement).get("handle") ?? "",
  ).trim();
  if (handle) location.href = `/oauth/login?handle=${encodeURIComponent(handle)}`;
}
async function logout() {
  await fetch("/oauth/logout", { method: "POST" });
  location.reload();
}
async function load() {
  const error = new URLSearchParams(location.search).get("error");
  if (error)
    loginMessage.value =
      error === "oauth-callback-failed"
        ? "Sign-in failed or expired. Please try again."
        : "Could not start sign-in. Check the handle and try again.";
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401) {
        const detail = await response.json().catch(() => null);
        if (detail?.error === "session-expired") loginMessage.value = detail.message;
      }
      sessionState.value = "anonymous";
      await nextTick();
      if (handleInput.value && loginStatus.value)
        autocomplete = attachActorCombobox({
          input: handleInput.value,
          status: loginStatus.value,
          searcher: searchPublicActors,
        });
      return;
    }
    did.value = ((await response.json()) as { did: string }).did;
    sessionState.value = "authenticated";
    await Promise.all([loadProfile(), loadConfiguration()]);
    await nextTick();
    await refreshStream();
    if (!disposed) dimensionsTimer = setInterval(() => void refreshStream(), 30_000);
  } catch {
    sessionState.value = "anonymous";
    loginMessage.value = "Could not reach the cloud service. Reload to try again.";
  }
}
function sessionExpired(event: Event) {
  loginMessage.value = (event as CustomEvent<string>).detail;
  config.value = null;
  did.value = "";
  profile.value = null;
  sessionState.value = "anonymous";
  clearInterval(dimensionsTimer);
  void load();
}
onMounted(() => {
  window.addEventListener("cloud-session-expired", sessionExpired);
  void load();
});
onBeforeUnmount(() => {
  window.removeEventListener("cloud-session-expired", sessionExpired);
  disposed = true;
  autocomplete?.dispose();
  clearTimeout(copyTimer);
  clearInterval(dimensionsTimer);
});
</script>

<template>
  <main>
    <header>
      <BrandWordmark />
      <p class="intro">
        Manage your <StreamplaceBrand /> stream overlays from anywhere and copy their stable URLs
        into your OBS’s browser sources.
      </p>
    </header>
    <section v-if="sessionState === 'loading'" class="settings loading-card" aria-live="polite">
      Connecting to Streamface…
    </section>
    <section v-else-if="sessionState === 'anonymous'" class="settings auth-card">
      <div>
        <p class="section-kicker">AT PROTOCOL</p>
        <h2>Connect your account</h2>
        <p>Your overlay settings, commands and media stay in your own PDS.</p>
      </div>
      <form class="login-form" @submit.prevent="login">
        <label
          >ATProto handle<input
            ref="handleInput"
            name="handle"
            autocomplete="username"
            placeholder="Search name or handle"
            required /></label
        ><button class="primary-button" type="submit">Continue with AT Protocol</button>
      </form>
      <p ref="loginStatus" class="save-status login-status" aria-live="polite">
        {{ loginMessage }}
      </p>
    </section>
    <template v-else>
      <section class="settings account-card">
        <div class="account-summary">
          <p class="section-kicker">ATPROTO ACCOUNT</p>
          <p class="connected-status"><span aria-hidden="true" />Connected</p>
          <div class="account-profile">
            <img v-if="profile?.avatar" :src="profile.avatar" alt="" /><span
              v-else
              class="avatar-placeholder"
              aria-hidden="true"
            /><span
              ><strong v-if="profileState === 'ready'">{{
                profile?.displayName || `@${profile?.handle}`
              }}</strong
              ><strong v-else-if="profileState === 'loading'">Loading profile…</strong
              ><strong v-else>Profile unavailable</strong
              ><small v-if="profile">@{{ profile.handle }}</small
              ><small v-else-if="profileState === 'unavailable'"
                >Signed in with AT Protocol</small
              ></span
            >
          </div>
          <CollapsibleSection v-if="config" title="General settings">
            <label class="account-preference"
              ><input
                type="checkbox"
                :checked="config.preferences?.confirmDeletion !== false"
                :disabled="saving"
                @change="
                  saveConfiguration(
                    {
                      ...config!,
                      preferences: { confirmDeletion: ($event.target as HTMLInputElement).checked },
                    },
                    undefined,
                    'preferences',
                  )
                "
              />Ask for confirmation before deleting commands</label
            >
            <p v-if="moduleMessages.preferences" role="alert">{{ moduleMessages.preferences }}</p>
          </CollapsibleSection>
          <button
            v-if="profileState === 'unavailable'"
            type="button"
            class="profile-retry"
            @click="loadProfile"
          >
            Retry profile
          </button>
        </div>
        <button type="button" class="secondary-button" @click="logout">Log out</button>
      </section>
      <section class="settings obs-guidance" aria-labelledby="obs-guidance-title">
        <h2 id="obs-guidance-title">Use your overlays in OBS</h2>
        <p>
          This service provides overlay URLs to add as Browser Sources in OBS. Before setting up a
          module, carefully read its instructions using the <strong>i</strong> button in the
          top-right corner for sizing and any module-specific setup.
        </p>
      </section>
      <p v-if="configurationMessage" role="status">{{ configurationMessage }}</p>
      <section>
        <h2>Modules</h2>
        <label class="module-search"
          ><span class="sr-only">Search modules</span
          ><input
            v-model="moduleQuery"
            type="search"
            placeholder="Search modules…"
            aria-label="Search modules"
        /></label>
        <p v-if="!matchingCount" class="no-modules" role="status">No modules match your search.</p>
        <TransitionGroup name="module-layout" tag="div" class="module-grid">
          <article
            v-for="module in orderedModules"
            v-show="matchesSearch(module)"
            :key="module.id"
            v-module-width="isExpanded(module)"
            class="module-card cloud-module"
            :class="{
              pinned: isPinned(module.id),
              collapsed: !isExpanded(module),
              'file-drag-active': cardDragDepth[module.id] > 0,
            }"
            :data-module="module.id"
            @click="expandCard(module, $event)"
            @dragenter="cardDragEnter(module.id, $event)"
            @dragover="cardDragOver"
            @dragleave="cardDragLeave(module.id, $event)"
            @drop="cardDrop(module, $event)"
          >
            <div v-if="cardDragDepth[module.id] > 0" class="module-drop-overlay" role="status">
              Drop media to create a command
            </div>
            <div class="module-heading">
              <div>
                <h3>{{ module.name }}</h3>
                <span
                  class="status"
                  :data-status="moduleEnabled(module.id) ? 'running' : 'stopped'"
                  >{{ moduleEnabled(module.id) ? "running" : "stopped" }}</span
                >
              </div>
              <div class="module-actions">
                <button
                  type="button"
                  class="module-icon-button pin-button"
                  :aria-label="`${isPinned(module.id) ? 'Unpin' : 'Pin'} ${module.name}`"
                  :aria-pressed="isPinned(module.id)"
                  @click="togglePin(module.id)"
                >
                  <span class="pin-icon" aria-hidden="true" /></button
                ><button
                  type="button"
                  class="module-icon-button"
                  :aria-label="`${isExpanded(module) ? 'Hide' : 'Show'} ${module.name} details`"
                  :aria-expanded="isExpanded(module)"
                  :aria-controls="`module-body-${module.id}`"
                  @click="toggleDetails(module)"
                >
                  <span
                    class="fold-icon"
                    aria-hidden="true"
                    :class="{ expanded: isExpanded(module) }"
                  /></button
                ><ModuleHelp
                  :id="module.id"
                  :name="module.name"
                  :description="module.description"
                  :instructions="obsInstructions(module.id)"
                /><label v-if="config" class="switch"
                  ><input
                    type="checkbox"
                    :checked="moduleEnabled(module.id)"
                    :aria-label="`Enable ${module.name}`"
                    @change="toggleEnabled(module, $event)" /><span
                /></label>
              </div>
            </div>
            <div v-if="loadState === 'error'" class="state-panel error-panel">
              <strong>Your saved configuration could not be loaded.</strong
              ><span>We did not replace it with an empty setup.</span
              ><button type="button" @click="loadConfiguration">Retry</button>
            </div>
            <div v-else-if="loadState === 'loading'" class="state-panel">
              Loading your configuration…
            </div>
            <CollapseTransition>
            <div
              v-if="config && loadState === 'ready'"
              v-show="isExpanded(module)"
              :id="`module-body-${module.id}`"
              class="module-body"
              :inert="saving || !isExpanded(module) || undefined"
            >
              <p>{{ module.description }}</p>
              <template v-if="module.id !== 'emoticons'">
                <section class="module-commands"><h4>OBS URL</h4></section>
                <div class="overlay-url">
                  <code>{{ cloudUrl(paths[module.id]) }}</code>
                  <a class="open-url-button" :href="cloudUrl(paths[module.id])" target="_blank" rel="noopener noreferrer"
                    :aria-label="`Open ${module.name} effects OBS URL`"><span class="external-link-icon" aria-hidden="true" /></a>
                  <button type="button" class="copy-button" :class="{ copied: copied === module.id }"
                    :aria-label="`Copy ${module.name} effects OBS URL`" @click="copyUrl(module.id)"><span class="copy-icon" aria-hidden="true" /></button>
                </div>
              </template>
              <template v-if="module.id === 'emoticons'">
              <DrawnTabs v-model="emoticonTab" :tabs="emoticonTabs" label="Emoticon tools">
              <div v-show="emoticonTab === 'commands'" :inert="emoticonTab !== 'commands' || undefined">
              <section class="module-commands overlay-url-heading">
                <h4>{{ module.id === "emoticons" ? "Effects OBS URL" : "OBS URL" }}</h4>
                <ModuleHelp v-if="module.id === 'emoticons'" id="emoticons-effects-url" name="Effects OBS URL" align="start"
                  description="This is the overlay for the actual clips/gifs & stickers. Ideally put this in a browser source that spans your whole stream." />
              </section>
              <div class="overlay-url">
                <code>{{ cloudUrl(paths[module.id]) }}</code
                ><a
                  class="open-url-button"
                  :href="cloudUrl(paths[module.id])"
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="`Open ${module.name} effects OBS URL`"
                  ><span class="external-link-icon" aria-hidden="true" /></a
                ><button
                  type="button"
                  class="copy-button"
                  :class="{
                    copied:
                      copied === module.id || (module.id === 'emoticons' && copied === 'effect'),
                  }"
                  :aria-label="`Copy ${module.name} effects OBS URL`"
                  @click="copyUrl(module.id === 'emoticons' ? 'effect' : module.id)"
                >
                  <span class="copy-icon" aria-hidden="true" />
                </button>
              </div>
                <CollapsibleSection class="overlay-live-preview" v-model:open="effectPreviewOpen" title="Live Preview" control-label="Emoticon overlay live preview">
                  <div v-if="effectPreviewOpen && isExpanded(module) && emoticonTab === 'commands'" class="cloud-preview"
                    :style="{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }">
                    <iframe :src="streamUrl" title="Stream background" tabindex="-1" class="preview-background" allow="autoplay" />
                    <iframe :ref="(value) => (effectPreviewFrame = value as HTMLIFrameElement | undefined)"
                      :src="previewUrl(module.id)" title="Emoticons preview" allow="autoplay" />
                  </div>
                </CollapsibleSection>
                <section class="module-commands overlay-url-heading listing-url-heading"><h4>Command listing OBS URL</h4>
                  <ModuleHelp id="emoticons-listing-url" name="Command listing OBS URL" align="start"
                    description="This is a listing of your commands for your audience including cooldowns for your clips." />
                </section>
                <div class="overlay-url board-url">
                  <code>{{ boardUrl }}</code
                  ><a
                    class="open-url-button"
                    :href="boardUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open Emoticons instruction board OBS URL"
                    ><span class="external-link-icon" aria-hidden="true" /></a
                  ><button
                    type="button"
                    class="copy-button"
                    :class="{ copied: copied === 'board' }"
                    aria-label="Copy Emoticons instruction board OBS URL"
                    @click="copyUrl('board')"
                  >
                    <span class="copy-icon" aria-hidden="true" />
                  </button>
                </div>
                <CollapsibleSection class="overlay-live-preview" v-model:open="listingPreviewOpen" title="Live Preview" control-label="Listing overlay live preview">
                  <iframe v-if="listingPreviewOpen && isExpanded(module) && emoticonTab === 'commands'"
                    :ref="(value) => (listingPreviewFrame = value as HTMLIFrameElement | undefined)"
                    :src="listingPreviewUrl" title="Emoticons command listing preview" class="listing-preview" />
                </CollapsibleSection>
              </div>
                <CloudEmoticonControls
                  :ref="(value) => setModuleControls(module.id, value)"
                  :did="did"
                  :config="config"
                  :save="saveConfiguration"
                  :before-test="prepareEmoticonTest"
                  :panel="emoticonTab"
                  @panel-change="emoticonTab = $event"
                />
              </DrawnTabs>
              </template>
              <CloudModuleControls
                v-else
                :module-id="module.id"
                :config="config"
                :save="(candidate) => saveConfiguration(candidate, undefined, module.id)"
                @chat-preview="updateChatPreview"
              />
              <p v-if="module.id === 'chat'" class="chat-preview-note">
                Sample chat preview — these messages are generated here, not sent to your stream.
                Your OBS source still shows live chat.
              </p>
              <div
                v-if="module.id !== 'emoticons' && isExpanded(module)"
                class="cloud-preview"
                :style="{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }"
              >
                <iframe
                  v-if="module.id === 'overlay-paint'"
                  :src="streamUrl"
                  title="Stream background"
                  tabindex="-1"
                  class="preview-background"
                  allow="autoplay"
                />
                <iframe
                  :src="previewUrl(module.id)"
                  :title="`${module.name} preview`"
                  allow="autoplay"
                  @load="module.id === 'chat' && chatPreviewLoaded($event)"
                />
              </div>
            </div>
            </CollapseTransition>
            <p
              v-if="moduleMessages[module.id]"
              class="module-message"
              role="status"
              aria-live="polite"
            >
              {{ moduleMessages[module.id] }}
            </p>
          </article>
        </TransitionGroup>
      </section>
    </template>
  </main>
  <BrandMascot />
</template>
