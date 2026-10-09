<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { attachActorCombobox } from "./actor-combobox.ts";
import { loadPublicActorProfile, searchPublicActors, type PublicActorProfile } from "./actor-search.ts";
import CloudEmoticonControls from "./CloudEmoticonControls.vue";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { useModuleCollection } from "./use-module-collection.ts";

const sessionState = ref<"loading" | "anonymous" | "authenticated">("loading");
const loadState = ref<"loading" | "ready" | "error">("loading");
const did = ref("");
const config = ref<CloudConfig | null>(null);
const loginMessage = ref("");
const moduleMessage = ref("");
const profile = ref<PublicActorProfile | null>(null);
const profileState = ref<"loading" | "ready" | "unavailable">("loading");
const copied = ref<"effect" | "board" | null>(null);
const handleInput = ref<HTMLInputElement>();
const loginStatus = ref<HTMLElement>();
let autocomplete: ReturnType<typeof attachActorCombobox> | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
type CloudModule = { id: string; name: string; description: string };
const cloudModules = ref<CloudModule[]>([{ id: "emoticons", name: "Emoticons", description: "Trigger clips and stickers from stream chat." }]);
const { query: moduleQuery, isPinned, togglePin, isExpanded, toggleDetails, expandCard, matchesSearch, orderedModules, matchingCount } = useModuleCollection(cloudModules);
type ModuleDropControls = { acceptCardDrop: (files: FileList | null | undefined) => Promise<{ accepted: boolean; message?: string }> };
const moduleControls = new Map<string, ModuleDropControls>();
const cardDragDepth = ref<Record<string, number>>({});
function setModuleControls(id: string, value: unknown) { if (value) moduleControls.set(id, value as ModuleDropControls); else moduleControls.delete(id); }
function hasFiles(event: DragEvent) { return Array.from(event.dataTransfer?.types ?? []).includes("Files"); }
function cardDragEnter(id: string, event: DragEvent) { if (!hasFiles(event)) return; event.preventDefault(); cardDragDepth.value[id] = (cardDragDepth.value[id] ?? 0) + 1; }
function cardDragOver(event: DragEvent) { if (!hasFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; }
function cardDragLeave(id: string, event: DragEvent) { if (!hasFiles(event)) return; cardDragDepth.value[id] = Math.max(0, (cardDragDepth.value[id] ?? 1) - 1); }
async function cardDrop(module: CloudModule, event: DragEvent) { if (!hasFiles(event)) return; event.preventDefault(); cardDragDepth.value[module.id] = 0; const result = await moduleControls.get(module.id)?.acceptCardDrop(event.dataTransfer?.files); if (!result) return; if (result.accepted) { if (!isExpanded(module)) toggleDetails(module); } else if (result.message) moduleMessage.value = result.message; }

const effectUrl = computed(() => cloudUrl("/effect/"));
const boardUrl = computed(() => cloudUrl("/board/"));
function cloudUrl(path: string) { const url = new URL(path, location.origin); if (did.value) url.searchParams.set("did", did.value); return url.toString(); }
async function parseError(response: Response, fallback: string) { try { const body = await response.json() as { error?: string }; return body.error || fallback; } catch { return fallback; } }
function initialConfig(): CloudConfig { return { enabled: true, streamerDid: did.value, revision: "new", commands: [] }; }
async function loadProfile() {
  profileState.value = "loading";
  try { profile.value = await loadPublicActorProfile(did.value); profileState.value = "ready"; }
  catch { profile.value = null; profileState.value = "unavailable"; }
}

async function loadConfiguration() {
  loadState.value = "loading"; moduleMessage.value = "Loading your PDS configuration…";
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(did.value)}/config`, { cache: "no-store" });
    if (response.status === 404) {
      config.value = initialConfig(); loadState.value = "ready";
      moduleMessage.value = "No PDS configuration yet. Your first save will create it.";
      return;
    }
    if (!response.ok) throw new Error(await parseError(response, "Could not load your PDS configuration."));
    config.value = await response.json() as CloudConfig; loadState.value = "ready"; moduleMessage.value = "Loaded from your PDS.";
  } catch {
    loadState.value = "error";
    moduleMessage.value = "Could not load your PDS configuration. Nothing was replaced; retry when your PDS is available.";
  }
}
async function saveConfiguration(candidate: CloudConfig, successMessage = "Saved to your PDS.") {
  moduleMessage.value = "Saving to your PDS…";
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(did.value)}/config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidate) });
    if (!response.ok) {
      let reason = "Your PDS could not save the configuration.";
      try { const body = await response.json() as { error?: string; message?: string }; reason = body.message || ({ "invalid-origin": "Open this admin from its configured OAuth URL, then try again.", forbidden: "Sign in again before saving.", "pds-write-not-authorized": "Your ATProto session does not grant access to write these records.", "configuration-changed": "The configuration changed on your PDS. Reload and try again.", "pds-rejected-record": "Your PDS rejected the Stream Overlay record format." }[body.error ?? ""] ?? reason); } catch { /* Use the safe fallback. */ }
      throw new Error(reason);
    }
    config.value = await response.json() as CloudConfig; moduleMessage.value = successMessage; return true;
  } catch (error) { moduleMessage.value = `${error instanceof Error ? error.message : "Save failed."} Your last saved configuration is still active.`; return false; }
}
async function toggleEnabled(event: Event) {
  if (!config.value) return;
  const input = event.target as HTMLInputElement;
  if (!await saveConfiguration({ ...config.value, enabled: input.checked }, input.checked ? "Emoticons enabled." : "Emoticons disabled.")) input.checked = config.value.enabled;
}
async function copyUrl(kind: "effect" | "board") {
  try { await navigator.clipboard.writeText(kind === "effect" ? effectUrl.value : boardUrl.value); copied.value = kind; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copied.value = null; }, 1800); }
  catch { copied.value = null; }
}
function login(event: Event) { const handle = String(new FormData(event.currentTarget as HTMLFormElement).get("handle") ?? "").trim(); if (handle) location.href = `/oauth/login?handle=${encodeURIComponent(handle)}`; }
async function logout() { await fetch("/oauth/logout", { method: "POST" }); location.reload(); }
async function load() {
  const error = new URLSearchParams(location.search).get("error");
  if (error) loginMessage.value = error === "oauth-callback-failed" ? "Sign-in failed or expired. Please try again." : "Could not start sign-in. Check the handle and try again.";
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) {
      sessionState.value = "anonymous"; await nextTick();
      if (handleInput.value && loginStatus.value) autocomplete = attachActorCombobox({ input: handleInput.value, status: loginStatus.value, searcher: searchPublicActors });
      return;
    }
    did.value = (await response.json() as { did: string }).did; sessionState.value = "authenticated";
    await Promise.all([loadProfile(), loadConfiguration()]);
  } catch { sessionState.value = "anonymous"; loginMessage.value = "Could not reach the cloud service. Reload to try again."; }
}
onMounted(load);
onBeforeUnmount(() => { autocomplete?.dispose(); clearTimeout(copyTimer); });
</script>

<template>
  <main>
    <header><p class="eyebrow">STREAM.PLACE OVERLAY</p><h1>Control room</h1><p class="intro">Manage your Emoticons from anywhere and copy their stable OBS URLs.</p></header>
    <section v-if="sessionState === 'loading'" class="settings loading-card" aria-live="polite">Connecting to Stream Overlay…</section>
    <section v-else-if="sessionState === 'anonymous'" class="settings auth-card">
      <div><p class="section-kicker">AT PROTOCOL</p><h2>Connect your account</h2><p>Your commands and media stay in your own PDS. Sign in to open the same Emoticons controls you use locally.</p></div>
      <form class="login-form" @submit.prevent="login"><label>ATProto handle<input ref="handleInput" name="handle" autocomplete="username" placeholder="Search name or handle" required></label><button class="primary-button" type="submit">Continue with AT Protocol</button></form>
      <p ref="loginStatus" class="save-status login-status" aria-live="polite">{{ loginMessage }}</p>
    </section>
    <template v-else>
      <section class="settings account-card">
        <div class="account-summary"><p class="section-kicker">ATPROTO ACCOUNT</p><p class="connected-status"><span aria-hidden="true" />Connected</p><div class="account-profile"><img v-if="profile?.avatar" :src="profile.avatar" alt=""><span v-else class="avatar-placeholder" aria-hidden="true" /><span><strong v-if="profileState === 'ready'">{{ profile?.displayName || `@${profile?.handle}` }}</strong><strong v-else-if="profileState === 'loading'">Loading profile…</strong><strong v-else>Profile unavailable</strong><small v-if="profile">@{{ profile.handle }}</small><small v-else-if="profileState === 'unavailable'">Signed in with AT Protocol</small></span></div><button v-if="profileState === 'unavailable'" type="button" class="profile-retry" @click="loadProfile">Retry profile</button></div>
        <button type="button" class="secondary-button" @click="logout">Log out</button>
      </section>
      <section><h2>Modules</h2><label class="module-search"><span class="sr-only">Search modules</span><input v-model="moduleQuery" type="search" placeholder="Search modules…" aria-label="Search modules"></label><p v-if="!matchingCount" class="no-modules" role="status">No modules match your search.</p><div class="module-grid"><article v-for="module in orderedModules" v-show="matchesSearch(module)" :key="module.id" class="module-card cloud-module" :class="{ pinned: isPinned(module.id), collapsed: !isExpanded(module), 'file-drag-active': cardDragDepth[module.id] > 0 }" @click="expandCard(module, $event)" @dragenter="cardDragEnter(module.id, $event)" @dragover="cardDragOver" @dragleave="cardDragLeave(module.id, $event)" @drop="cardDrop(module, $event)">
        <div v-if="cardDragDepth[module.id] > 0" class="module-drop-overlay" role="status">Drop media to create a command</div>
        <div class="module-heading"><div><h3>{{ module.name }}</h3><span class="status" :data-status="config?.enabled ? 'running' : 'stopped'">{{ config?.enabled ? 'running' : 'stopped' }}</span></div><div class="module-actions"><button type="button" class="module-icon-button pin-button" :aria-label="`${isPinned(module.id) ? 'Unpin' : 'Pin'} ${module.name}`" :aria-pressed="isPinned(module.id)" @click="togglePin(module.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-4 1-4 5-1 4-3-3-6 6 6-6-3-3 4-1 5-4z" /></svg></button><button type="button" class="module-icon-button" :aria-label="`${isExpanded(module) ? 'Hide' : 'Show'} ${module.name} details`" :aria-expanded="isExpanded(module)" :aria-controls="`module-body-${module.id}`" @click="toggleDetails(module)"><svg viewBox="0 0 24 24" aria-hidden="true" :class="{ expanded: isExpanded(module) }"><path d="m6 9 6 6 6-6" /></svg></button><label v-if="config" class="switch"><input type="checkbox" :checked="config.enabled" aria-label="Enable Emoticons" @change="toggleEnabled"><span /></label></div></div>
        <div v-if="loadState === 'error'" class="state-panel error-panel"><strong>Your saved configuration could not be loaded.</strong><span>We did not replace it with an empty setup.</span><button type="button" @click="loadConfiguration">Retry</button></div>
        <div v-else-if="loadState === 'loading'" class="state-panel">Loading your configuration…</div>
        <div v-else-if="config" v-show="isExpanded(module)" :id="`module-body-${module.id}`" class="module-body">
          <section class="module-commands"><h4>Effects OBS URL</h4></section><div class="overlay-url"><code>{{ effectUrl }}</code><a class="open-url-button" :href="effectUrl" target="_blank" rel="noopener noreferrer" aria-label="Open Emoticons effects OBS URL"><span class="external-link-icon" aria-hidden="true" /></a><button type="button" class="copy-button" :class="{ copied: copied === 'effect' }" aria-label="Copy Emoticons effects OBS URL" @click="copyUrl('effect')"><span class="copy-icon" aria-hidden="true" /></button></div>
          <section class="module-commands"><h4>Instruction board OBS URL</h4></section><div class="overlay-url board-url"><code>{{ boardUrl }}</code><a class="open-url-button" :href="boardUrl" target="_blank" rel="noopener noreferrer" aria-label="Open Emoticons instruction board OBS URL"><span class="external-link-icon" aria-hidden="true" /></a><button type="button" class="copy-button" :class="{ copied: copied === 'board' }" aria-label="Copy Emoticons instruction board OBS URL" @click="copyUrl('board')"><span class="copy-icon" aria-hidden="true" /></button></div>
          <CloudEmoticonControls :ref="value => setModuleControls(module.id, value)" :did="did" :config="config" :save="saveConfiguration" />
        </div>
        <p class="module-message" role="status" aria-live="polite">{{ moduleMessage }}</p>
      </article></div></section>
    </template>
  </main>
</template>
