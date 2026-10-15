<script setup lang="ts">
import ChatPreviewFrame from "./ChatPreviewFrame.vue";
import { overlayPlacement } from "../../../packages/protocol/src/overlay-layout.ts";
import type { OverlayLayout } from "../../../packages/protocol/src/overlay-layout.ts";
import OverlayLayoutEditor from "./OverlayLayoutEditor.vue";
import BrandWordmark from "./BrandWordmark.vue";
import ThemeToggle from "./ThemeToggle.vue";
import pencilIcon from "./assets/custom-module-pencil.png";
import { version } from "../../../package.json";
import CollapseTransition from "./CollapseTransition.vue";
import DrawnTabs from "./DrawnTabs.vue";
import { vModuleWidth } from "./module-width-motion.ts";
import { adminFetch } from "./cloud-admin-fetch.ts";
import BrandMascot from "./BrandMascot.vue";
import StreamplaceBrand from "./StreamplaceBrand.vue";
import { getCloudModuleCatalog } from "../../../modules/catalog.ts";
import type { ModuleManifest as CloudModule } from "../../../packages/overlay-sdk/src/manifest.ts";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { attachActorCombobox } from "./actor-combobox.ts";
import {
  loadPublicActorProfile,
  searchPublicActors,
  type PublicActorProfile,
} from "./actor-search.ts";
import CloudEmoticonControls from "./CloudEmoticonControls.vue";
import EmoticonModeration from "./EmoticonModeration.vue";
import EmoteEvents from "./EmoteEvents.vue";
import SetupImport from "./SetupImport.vue";
import CloudModuleControls from "./CloudModuleControls.vue";
import CloudBotControls from "./CloudBotControls.vue";
import CloudCrystalControls from "./CloudCrystalControls.vue";
import CrystalChatTest from "./CrystalChatTest.vue";
import CrystalPettingControls from "./CrystalPettingControls.vue";
import CloudCustomModuleControls from "./CloudCustomModuleControls.vue";
import CollapsibleSection from "./CollapsibleSection.vue";
import ModuleHelp from "./ModuleHelp.vue";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
import type { ChatConfiguration } from "../../../modules/chat/src/config.ts";
import type { CloudCommand, CloudConfig } from "./cloud-admin-types.ts";
import { useModuleCollection } from "./use-module-collection.ts";
import { customModuleManifest } from "../../../modules/custom-module/src/manifest.ts";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";

const cloudModuleCatalog = getCloudModuleCatalog(import.meta.env.VITE_ENABLE_CLOUD_PETS === "true");

const sessionState = ref<"loading" | "anonymous" | "authenticated">("loading");
const loadState = ref<"loading" | "ready" | "error">("loading");
const did = ref("");
const config = ref<CloudConfig | null>(null);
const loginMessage = ref("");
const configurationMessage = ref("");
const moduleMessages = ref<Record<string, string>>({});
const saving = ref(false);
const editingTitle = ref<string | null>(null);
const titleDraft = ref("");
const titleInput = ref<HTMLInputElement>();
async function editTitle(module: CloudModule) {
  editingTitle.value = module.id;
  titleDraft.value = module.name;
  await nextTick();
  titleInput.value?.focus();
  titleInput.value?.select();
}
async function saveTitle() {
  if (!config.value || !editingTitle.value || saving.value) return;
  const id = editingTitle.value;
  const name = titleDraft.value.trim();
  if (!name || new TextEncoder().encode(name).length > 200) {
    moduleMessages.value[id] = "Module names must be between 1 and 200 bytes.";
    titleInput.value?.focus();
    return;
  }
  if (
    await saveConfiguration(
      {
        ...config.value,
        customModules: config.value.customModules?.map((module) =>
          `custom:${module.id}` === id ? { ...module, name } : module,
        ),
      },
      undefined,
      id,
    )
  )
    editingTitle.value = null;
}
const tutorialOpen = ref(false);
const publicTutorialOpen = ref(true);
const profile = ref<PublicActorProfile | null>(null);
const profileState = ref<"loading" | "ready" | "unavailable">("loading");
const copied = ref<string | null>(null);
const dimensions = ref({ width: 1920, height: 1080 });
const dimensionsDetected = ref(false);
let dimensionsTimer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
function obsInstructions(moduleId: string) {
  if (moduleId.startsWith("custom:") && config.value?.customModules?.find((module) => `custom:${module.id}` === moduleId)?.displayMode === "page")
    return ["Enable this module and open its page from the module settings."];
  return [
    "Enable this module to show it in your shared overlay.",
    "Arrange its position and size in the overlay layout above.",
  ];
}
const sourceUrl = ref("");
const displaySourceUrl = computed(() => sourceUrl.value.replace(/([?&]token=)[^&#]*/gi, "$1…"));
function customPageUrl(id: string) {
  if (!sourceUrl.value) return undefined;
  const url = new URL(sourceUrl.value);
  url.searchParams.set("only", id);
  url.searchParams.set("fit", "1");
  return url.toString();
}
function openSource() {
  window.open(sourceUrl.value, "_blank", "noopener,noreferrer");
}
const sourceMessage = ref("");
async function loadSource() {
  sourceUrl.value = "";
  sourceMessage.value = "";
  try {
    const response = await adminFetch(
      `/api/accounts/${encodeURIComponent(did.value)}/overlay/source`,
    );
    if (!response.ok) throw new Error();
    const data = (await response.json()) as { url?: string };
    if (!data.url) throw new Error();
    sourceUrl.value = data.url;
  } catch {
    sourceMessage.value = "Could not load your overlay URL.";
  }
}
const sharedPreviewUrl = computed(() => {
  const url = new URL(cloudUrl("/overlay/"));
  url.searchParams.set("preview", "1");
  return url.toString();
});
const chatPreviewConfiguration = ref<ChatConfiguration>();
const previewLayout = ref<OverlayLayout>();
function updateChatPreview(configuration: ChatConfiguration) {
  chatPreviewConfiguration.value = configuration;
}
const effectPreviewFrame = ref<HTMLIFrameElement>();
const listingPreviewFrame = ref<HTMLIFrameElement>();
const emoticonTab = ref("commands");
const crystalTab = ref("testing");
const crystalTabs = [
  { id: "testing", label: "Testing" },
  { id: "script", label: "Lua script" },
  { id: "artwork", label: "Pokémon artwork" },
  { id: "petting", label: "Petting" },
];
const emoticonTabs = computed(() => [
  { id: "commands", label: "Testing" },
  { id: "create", label: "Commands" },
  { id: "events", label: "Events" },
  { id: "moderation", label: "Moderation" },
]);
async function prepareEmoticonTest(command: CloudCommand) {
  emoticonTab.value = "commands";
  await nextTick();
  const deadline = Date.now() + 10_000;
  while (!disposed && Date.now() < deadline) {
    if (
      effectPreviewFrame.value?.contentDocument?.documentElement?.dataset.overlayReady === "true"
    ) {
      if (command.mode !== "effect") return;
      const frame = effectPreviewFrame.value;
      const animations: Animation[] = [];
      for (let element: HTMLElement | null = frame; element; element = element.parentElement) {
        animations.push(...(element.getAnimations?.() ?? []));
      }
      // Center the final preview size, not its partially expanded position.
      await Promise.allSettled(animations.map((animation) => animation.finished));
      if (disposed || !frame.isConnected) return;
      frame.scrollIntoView?.({
        block: "center",
        inline: "nearest",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The emoticon preview could not connect. Please try Test again.");
}
const handleInput = ref<HTMLInputElement>();
const loginStatus = ref<HTMLElement>();
let autocomplete: ReturnType<typeof attachActorCombobox> | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
const cloudModules = computed<CloudModule[]>(() => [
  ...cloudModuleCatalog.filter((module) => module.id !== "custom-module"),
  ...(config.value?.customModules ?? []).map((module) => ({
    ...customModuleManifest,
    id: `custom:${module.id}`,
    name: module.name,
    cloud: {
      ...customModuleManifest.cloud,
    },
  })),
]);
async function createCustomModule() {
  if (!config.value) return;
  const module = {
    ...defaultCustomModuleSettings,
    id: crypto.randomUUID(),
    name: "Untitled module",
  };
  if (
    await saveConfiguration(
      { ...config.value, customModules: [...(config.value.customModules ?? []), module] },
      undefined,
      "custom-modules",
    )
  ) {
    moduleQuery.value = "";
    const card = cloudModules.value.find((card) => card.id === `custom:${module.id}`)!;
    toggleDetails(card);
    await editTitle(card);
  }
}
async function deleteCustomModule(id: string) {
  if (!config.value) return;
  if (
    config.value.preferences?.confirmDeletion !== false &&
    !window.confirm("Delete this custom module?")
  )
    return;
  await saveConfiguration(
    {
      ...config.value,
      customModules: config.value.customModules?.filter((module) => `custom:${module.id}` !== id),
    },
    undefined,
    id,
  );
}
function moduleEnabled(id: string) {
  if (id === "pokemon-crystal-mgba") return config.value?.pokemonCrystalMgbaEnabled ?? true;
  if (id.startsWith("custom:"))
    return (
      config.value?.customModules?.find((module) => `custom:${module.id}` === id)?.enabled ?? false
    );
  const module = cloudModuleCatalog.find((module) => module.id === id);
  if (!config.value || !module) return false;
  if (id === "bot") return config.value.bot?.enabled ?? false;
  if (module.cloud.enabledKey === "customModule") return false;
  const key = module.cloud.enabledKey;
  if (key === "pokemonCrystalMgba") return config.value.pokemonCrystalMgbaEnabled ?? true;
  return key === "emoticons"
    ? config.value.enabled
    : key === "bot"
      ? (config.value.bot?.enabled ?? false)
      : moduleSettings(config.value).modules[key];
}
const layoutModules = computed(() =>
  cloudModules.value
    .filter((module) => !config.value?.customModules?.some(
      (custom) => `custom:${custom.id}` === module.id && custom.displayMode === "page",
    ))
    .map((module) => ({
      id: module.id,
      name: module.name,
      enabled: moduleEnabled(module.id),
    })),
);
function overlayModule(id: string) {
  return cloudModules.value.find(
    (module) => module.id === (id === "emoticons-board" ? "emoticons" : id),
  );
}
const overlayModuleMessage = ref("");
function toggleOverlayModule(id: string, event: Event) {
  overlayModuleMessage.value = "";
  if (id === "emoticons-board") {
    if (!config.value || !config.value.enabled) return;
    const input = event.target as HTMLInputElement;
    const layout = config.value.preferences?.overlayLayout ?? [];
    const candidate = {
      ...config.value,
      preferences: {
        confirmDeletion: config.value.preferences?.confirmDeletion ?? true,
        ...config.value.preferences,
        overlayLayout: [
          ...layout.filter((item) => item.id !== id),
          { ...overlayPlacement(id, layout), hidden: !input.checked },
        ],
      },
    };
    void saveConfiguration(candidate, undefined, "emoticons").then((saved) => {
      overlayModuleMessage.value = moduleMessages.value.emoticons ?? "";
      if (!saved)
        input.checked =
          !!config.value?.enabled &&
          !overlayPlacement(id, config.value?.preferences?.overlayLayout).hidden;
    });
    return;
  }
  const module = overlayModule(id);
  if (module)
    void toggleEnabled(module, event).then(() => {
      overlayModuleMessage.value = moduleMessages.value[module.id] ?? "";
    });
}
async function editOverlayModule(id: string) {
  const module = overlayModule(id);
  if (!module) return;
  moduleQuery.value = "";
  selectedBadge.value = null;
  if (id === "emoticons-board") emoticonTab.value = "commands";
  if (!isExpanded(module)) toggleDetails(module);
  await nextTick();
  const body = document.getElementById(`module-body-${module.id}`);
  const card = body?.closest("article");
  if (!card) return;
  await Promise.allSettled(
    [...(card.getAnimations?.() ?? []), ...(body?.getAnimations?.() ?? [])].map(
      (animation) => animation.finished,
    ),
  );
  if (disposed || !card.isConnected) return;
  card.scrollIntoView({
    block: "start",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
}
function previewUrl(id: string) {
  const url = new URL(cloudUrl("/overlay/"));
  url.searchParams.set("preview", "1");
  url.searchParams.set("only", id);
  url.searchParams.set("fit", "1");
  if (id === "overlay-paint") url.searchParams.set("interactive", "1");
  return url.toString();
}
const streamUrl = computed(() =>
  did.value ? `https://stream.place/embed/${encodeURIComponent(did.value)}?muted=true` : "",
);
const {
  query: moduleQuery,
  badges,
  selectedBadge,
  toggleBadge,
  isPinned,
  togglePin,
  isExpanded,
  toggleDetails,
  expandCard,
  matchesSearch,
  orderedModules,
  matchingCount,
} = useModuleCollection(cloudModules);
watchEffect(() => {
  if (cloudModules.value.length < 10) moduleQuery.value = "";
});
const emotePreviewsStarted = ref(false);
watchEffect(() => {
  const module = cloudModules.value.find((module) => module.id === "emoticons");
  // Start lazily, then keep the iframe and its asset cache alive while hidden.
  if (module && isExpanded(module) && emoticonTab.value === "commands")
    emotePreviewsStarted.value = true;
});
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
  if ((id !== "emoticons" && !id.startsWith("custom:")) || !hasFiles(event)) return;
  event.preventDefault();
  cardDragDepth.value[id] = (cardDragDepth.value[id] ?? 0) + 1;
  if (id.startsWith("custom:")) {
    const module = cloudModules.value.find((module) => module.id === id);
    if (module && !isExpanded(module)) toggleDetails(module);
  }
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

const listingPreviewUrl = computed(() => previewUrl("emoticons-board"));
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
  const accountDid = did.value;
  let result: { width: number; height: number } | null = null;
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(accountDid)}/dimensions`, {
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
  if (disposed || did.value !== accountDid) return;
  if (result) {
    dimensionsDetected.value = true;
    dimensions.value = result;
  }
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
  else if (module.id === "pokemon-crystal-mgba")
    candidate.pokemonCrystalMgbaEnabled = input.checked;
  else if (module.id === "bot")
    candidate.bot = { ...candidate.bot, enabled: input.checked, rules: candidate.bot?.rules ?? [] };
  else if (module.id.startsWith("custom:")) {
    candidate.customModules = candidate.customModules?.map((item) =>
      `custom:${item.id}` === module.id ? { ...item, enabled: input.checked } : item,
    );
  } else
    candidate.modules[
      module.id === "overlay-paint" ? "paint" : module.id === "streamplace-pets" ? "pets" : "chat"
    ] = input.checked;
  if (!(await saveConfiguration(candidate, undefined, module.id)))
    input.checked = moduleEnabled(module.id);
}
async function copyUrl() {
  try {
    await navigator.clipboard.writeText(sourceUrl.value);
    copied.value = "overlay";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = null;
    }, 1800);
  } catch {
    sourceMessage.value = "Could not copy the URL.";
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
    await Promise.all([loadProfile(), loadConfiguration(), loadSource()]);
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
      <ThemeToggle />
      <BrandWordmark />
      <p class="intro">
        Manage your <StreamplaceBrand /> modules from anywhere with one shared OBS overlay.
      </p>
    </header>
    <section v-if="sessionState === 'loading'" class="settings loading-card" aria-live="polite">
      Connecting to Streamface…
    </section>
    <template v-else-if="sessionState === 'anonymous'">
      <section class="settings auth-card">
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
          ><button class="primary-button atproto-button" type="submit">
            <span class="button-press-shade" aria-hidden="true"></span
            ><span class="button-hover-shade" aria-hidden="true"></span
            ><span class="button-content">Continue with AT Protocol</span>
          </button>
        </form>
        <p ref="loginStatus" class="save-status login-status" aria-live="polite">
          {{ loginMessage }}
        </p>
      </section>
      <CollapsibleSection
        v-model:open="publicTutorialOpen"
        title="Tutorial"
        class="shadowed-section"
      >
        <p>
          This tutorial shows you how to create a browser source in OBS and use one of your
          streamface modules in it.
        </p>
        <video
          v-if="publicTutorialOpen"
          class="tutorial-video"
          controls
          autoplay
          muted
          playsinline
          aria-label="Emotes tutorial"
        >
          <source src="/emotes-tutorial.mp4" type="video/mp4" />
          Your browser does not support video playback.
        </video>
      </CollapsibleSection>
    </template>
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
                      preferences: {
                        ...config!.preferences,
                        confirmDeletion: ($event.target as HTMLInputElement).checked,
                      },
                    },
                    undefined,
                    'preferences',
                  )
                "
              />Ask for confirmation before deletions</label
            >
            <label class="account-preference"
              ><input
                type="checkbox"
                :checked="config.preferences?.vimControls === true"
                :disabled="saving"
                @change="
                  saveConfiguration(
                    {
                      ...config!,
                      preferences: {
                        confirmDeletion: true,
                        ...config!.preferences,
                        vimControls: ($event.target as HTMLInputElement).checked,
                      },
                    },
                    undefined,
                    'preferences',
                  )
                "
              />Vim controls in code editors</label
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
        <button type="button" class="secondary-button danger-button" @click="logout">
          <span class="button-press-shade" aria-hidden="true"></span
          ><span class="button-hover-shade" aria-hidden="true"></span
          ><span class="button-content">Log out</span>
        </button>
      </section>
      <CollapsibleSection v-if="config" title="Quickstart" class="shadowed-section">
        <SetupImport
          :did="did"
          :config="config"
          :save="(candidate) => saveConfiguration(candidate, undefined, 'preferences')"
        />
        <p v-if="moduleMessages.preferences" role="alert">{{ moduleMessages.preferences }}</p>
      </CollapsibleSection>
      <CollapsibleSection v-model:open="tutorialOpen" title="Tutorial" class="shadowed-section">
        <p>
          This tutorial shows you how to create a browser source in OBS and use one of your
          streamface modules in it.
        </p>
        <video
          v-if="tutorialOpen"
          class="tutorial-video"
          controls
          preload="none"
          playsinline
          aria-label="Emotes tutorial"
        >
          <source src="/emotes-tutorial.mp4" type="video/mp4" />
          Your browser does not support video playback.
        </video>
      </CollapsibleSection>
      <CollapsibleSection
        title="Your Overlay"
        initially-open
        class="settings obs-guidance shadowed-section"
      >
        <p>
          Add this URL as one OBS Browser Source. Enable modules below and arrange them in the
          overlay preview.
        </p>
        <p>
          Set the source to {{ dimensions.width }} × {{ dimensions.height }} px<span
            v-if="!dimensionsDetected"
          >
            (default until your stream size is detected)</span
          >. Keep the URL private: it also authorizes your bot. Leave “Shutdown source when not
          visible” unchecked to keep it running across scenes.
        </p>
        <div v-if="sourceUrl" class="overlay-url">
          <code>{{ displaySourceUrl }}</code>
          <button
            type="button"
            class="open-url-button"
            @click="openSource"
            aria-label="Open shared overlay"
          >
            <span class="external-link-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="copy-button"
            :class="{ copied: copied === 'overlay' }"
            aria-label="Copy shared overlay URL"
            @click="copyUrl"
          >
            <span class="copy-icon" aria-hidden="true" />
          </button>
        </div>
        <p v-if="sourceMessage" role="status">
          {{ sourceMessage }} <button type="button" @click="loadSource">Retry</button>
        </p>
        <OverlayLayoutEditor
          v-if="config"
          :config="config"
          :preview-url="sharedPreviewUrl"
          :chat-configuration="chatPreviewConfiguration"
          @layout-change="previewLayout = $event"
          :dimensions="dimensions"
          :modules="layoutModules"
          :saving="saving"
          :module-message="overlayModuleMessage"
          @toggle-module="toggleOverlayModule"
          @edit-module="editOverlayModule"
          :save="(candidate) => saveConfiguration(candidate, undefined, 'overlay-layout')"
        />
      </CollapsibleSection>
      <p v-if="configurationMessage" role="status">{{ configurationMessage }}</p>
      <section>
        <div class="modules-heading">
          <h2>Modules</h2>
          <button
            type="button"
            aria-label="Create custom module"
            :disabled="!config || saving"
            @click="createCustomModule"
          >
            <span class="button-press-shade" aria-hidden="true"></span
            ><span class="button-hover-shade" aria-hidden="true"></span
            ><span class="button-content"> New </span>
          </button>
        </div>
        <div class="module-badges" aria-label="Filter modules by badge">
          <button
            v-for="badge in badges"
            :key="badge"
            type="button"
            class="module-badge"
            :data-badge="badge"
            :aria-pressed="selectedBadge === badge"
            @click="toggleBadge(badge)"
          >
            <span class="button-content">{{ badge }}</span>
          </button>
        </div>
        <p v-if="moduleMessages['custom-modules']" role="status">
          {{ moduleMessages["custom-modules"] }}
        </p>
        <label v-if="cloudModules.length >= 10" class="module-search"
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
            <div
              v-if="cardDragDepth[module.id] > 0 && (module.id === 'emoticons' || module.id.startsWith('custom:'))"
              class="module-drop-overlay"
              role="status"
            >
              {{
                module.id.startsWith("custom:")
                  ? "Drop a ZIP app or media onto this module"
                  : "Drop media to create a command"
              }}
            </div>
            <div class="module-heading">
              <div>
                <div class="custom-module-title">
                  <input
                    v-if="editingTitle === module.id"
                    :ref="
                      (el) => {
                        titleInput = el as HTMLInputElement;
                      }
                    "
                    v-model="titleDraft"
                    aria-label="Custom Module name"
                    maxlength="200"
                    @click.stop
                    @keydown.enter.prevent="saveTitle"
                    @keydown.esc.prevent="editingTitle = null"
                    @blur="saveTitle"
                  />
                  <h3 v-else>{{ module.name }}</h3>
                  <button
                    v-if="module.id.startsWith('custom:') && editingTitle !== module.id"
                    type="button"
                    class="module-icon-button"
                    :aria-label="`Rename ${module.name}`"
                    @click.stop="editTitle(module)"
                  >
                    <img :src="pencilIcon" class="pencil-icon" alt="" />
                  </button>
                </div>
                <div class="module-badges card-badges">
                  <span
                    v-for="badge in module.badges"
                    :key="badge"
                    class="module-badge"
                    :data-badge="badge"
                    >{{ badge }}</span
                  >
                </div>
                <span v-if="module.id.startsWith('custom:')" class="custom-module-badge"
                  >Custom Module</span
                >
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
              ><button type="button" @click="loadConfiguration">
                <span class="button-press-shade" aria-hidden="true"></span
                ><span class="button-hover-shade" aria-hidden="true"></span
                ><span class="button-content">Retry</span>
              </button>
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
                <p v-if="!module.id.startsWith('custom:')">{{ module.description }}</p>
                <template v-if="module.id === 'emoticons'">
                  <DrawnTabs v-model="emoticonTab" :tabs="emoticonTabs" label="Emote tools">
                    <div
                      class="emoticon-tab-content"
                      :class="{ 'commands-columns': emoticonTab === 'commands' }"
                    >
                      <div
                        class="command-previews"
                        v-show="emoticonTab === 'commands'"
                        :inert="emoticonTab !== 'commands' || undefined"
                      >
                        <section class="module-section overlay-live-preview">
                          <h4>Emote overlay preview</h4>
                          <div
                            v-if="emotePreviewsStarted"
                            class="cloud-preview"
                            :style="{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }"
                          >
                            <iframe
                              :ref="
                                (value) =>
                                  (effectPreviewFrame = value as HTMLIFrameElement | undefined)
                              "
                              :src="previewUrl(module.id)"
                              title="Emotes preview"
                              allow="autoplay"
                            />
                          </div>
                        </section>
                        <section class="module-section overlay-live-preview">
                          <h4>Listing overlay preview</h4>
                          <iframe
                            v-if="emotePreviewsStarted"
                            :ref="
                              (value) =>
                                (listingPreviewFrame = value as HTMLIFrameElement | undefined)
                            "
                            :src="listingPreviewUrl"
                            title="Emotes command listing preview"
                            class="listing-preview"
                          />
                        </section>
                      </div>
                      <EmoticonModeration
                        v-show="emoticonTab === 'moderation'"
                        :config="config"
                        :save="saveConfiguration"
                      />
                      <EmoteEvents
                        v-if="emoticonTab === 'events'"
                        :config="config"
                        :save="saveConfiguration"
                      />
                      <CloudEmoticonControls
                        v-show="emoticonTab === 'commands' || emoticonTab === 'create'"
                        :inert="!['commands', 'create'].includes(emoticonTab) || undefined"
                        :ref="(value) => setModuleControls(module.id, value)"
                        :did="did"
                        :config="config"
                        :save="saveConfiguration"
                        :before-test="prepareEmoticonTest"
                        :panel="emoticonTab"
                        @panel-change="emoticonTab = $event"
                      />
                    </div>
                  </DrawnTabs>
                </template>
                <CloudBotControls
                  v-else-if="module.id === 'bot'"
                  :config="config"
                  :avatar="profile?.avatar"
                  :save="(candidate) => saveConfiguration(candidate, undefined, 'bot')"
                />
                <DrawnTabs
                  v-else-if="module.id === 'pokemon-crystal-mgba'"
                  v-model="crystalTab"
                  :tabs="crystalTabs"
                  label="Pokémon tools"
                >
                  <div
                    v-show="crystalTab === 'testing'"
                    :inert="crystalTab !== 'testing' || undefined"
                  >
                    <div
                      class="cloud-preview"
                      :style="{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }"
                    >
                      <iframe
                        :src="previewUrl(module.id)"
                        :title="`${module.name} preview`"
                        allow="autoplay"
                      />
                    </div>
                    <CrystalChatTest :did="config.streamerDid" />
                  </div>
                  <CloudCrystalControls
                    v-show="crystalTab === 'script' || crystalTab === 'artwork'"
                    :inert="!['script', 'artwork'].includes(crystalTab) || undefined"
                    :panel="crystalTab === 'script' ? 'script' : 'artwork'"
                    :config="config"
                    :save="(candidate) => saveConfiguration(candidate, undefined, module.id)"
                  />
                  <CrystalPettingControls
                    v-if="crystalTab === 'petting'"
                    :config="config"
                    :save="(candidate) => saveConfiguration(candidate, undefined, module.id)"
                  />
                </DrawnTabs>
                <div v-else-if="module.id.startsWith('custom:')">
                  <CloudCustomModuleControls
                    :module-id="module.id.slice(7)"
                    :page-url="customPageUrl(module.id)"
                    :ref="(el) => setModuleControls(module.id, el)"
                    :config="config"
                    :preview-aspect-ratio="dimensions.width / dimensions.height"
                    :save="(candidate) => saveConfiguration(candidate, undefined, module.id)"
                    @media-drop="cardDragDepth[module.id] = 0"
                  >
                    <p>
                      <span
                        v-for="(text, index) in module.description.split(/(HTML|CSS)/g)"
                        :key="index"
                        :class="
                          text === 'HTML' ? 'html-label' : text === 'CSS' ? 'css-label' : undefined
                        "
                        >{{ text }}</span
                      >
                    </p>
                  </CloudCustomModuleControls>
                </div>
                <CloudModuleControls
                  v-else
                  :module-id="module.id"
                  :config="config"
                  :save="(candidate) => saveConfiguration(candidate, undefined, module.id)"
                  @chat-preview="updateChatPreview"
                />
                <button
                  v-if="module.id.startsWith('custom:')"
                  class="danger-button"
                  type="button"
                  :disabled="saving"
                  @click="deleteCustomModule(module.id)"
                >
                  <span class="button-press-shade" aria-hidden="true"></span
                  ><span class="button-hover-shade" aria-hidden="true"></span
                  ><span class="button-content"> Delete module </span>
                </button>
                <p v-if="module.id === 'chat'" class="chat-preview-note">
                  Sample chat preview — these messages are generated here, not sent to your stream.
                  Your OBS source still shows live chat.
                </p>
                <div
                  v-if="
                    module.id !== 'emoticons' &&
                    module.id !== 'bot' &&
                    module.id !== 'pokemon-crystal-mgba' &&
                    !module.id.startsWith('custom:') &&
                    isExpanded(module)
                  "
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
                  <ChatPreviewFrame
                    v-if="module.id === 'chat'"
                    :src="previewUrl(module.id)"
                    :dimensions="dimensions"
                    :configuration="chatPreviewConfiguration"
                    :layout="previewLayout ?? config?.preferences?.overlayLayout"
                  />
                  <iframe
                    v-else
                    :src="previewUrl(module.id)"
                    :title="`${module.name} preview`"
                    allow="autoplay"
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
  <footer class="site-footer">
    <span>v{{ version }} · created by <a href="https://fettstorch.dev">@fettstorch.dev</a></span>
    <a class="footer-privacy" href="/privacy">Privacy</a>
  </footer>
  <BrandMascot />
</template>
<style scoped>
.module-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.card-badges {
  gap: 6px;
  margin: 4px 0 8px;
}
.module-badge[data-badge="commands"] {
  --badge-border: #7650a0;
  --badge-fill: #eee2fa;
}
.module-badge[data-badge="overlay"] {
  --badge-border: #23778c;
  --badge-fill: #d9f1f6;
}
.module-badge[data-badge="game"] {
  --badge-border: #437c35;
  --badge-fill: #e2f2d9;
}
.module-badge[data-badge="pokemon"] {
  --badge-border: #a36b10;
  --badge-fill: #fff0c7;
}
.module-badge,
:global(html[data-theme] #app button.module-badge) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 3px solid var(--badge-border);
  border-radius: 999px;
  background: var(--badge-fill);
  color: var(--badge-border);
  padding: 2px 10px;
  min-height: 0;
  font-size: 0.8em;
  font-weight: 700;
  line-height: 1.3;
  box-shadow: none;
  transform: none;
}
:global(html[data-theme] #app button.module-badge::before),
:global(html[data-theme] #app button.module-badge::after) {
  display: none;
}
:global(html[data-theme] #app button.module-badge .button-content) {
  color: inherit;
  transform: none;
}
:global(html[data-theme] #app button.module-badge[aria-pressed="true"]) {
  outline: 2px solid var(--badge-border);
  outline-offset: 3px;
}
:global(html[data-theme] #app button.module-badge:focus-visible) {
  outline: 2px dashed var(--badge-border);
  outline-offset: 3px;
}
:global(html[data-theme] #app button.module-badge:hover) {
  filter: brightness(0.96);
}
.modules-heading {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}
.modules-heading h2 {
  margin: 0;
}
.html-label {
  color: #b77b00;
}
.css-label {
  color: #1769c2;
}
:global(html[data-theme="dark"] .html-label) {
  color: #f5c542;
}
:global(html[data-theme="dark"] .css-label) {
  color: #69b5ff;
}
.account-preference {
  display: flex;
  align-items: center;
  gap: 8px;
}
.account-preference + .account-preference {
  margin-top: 12px;
}
.custom-module-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.custom-module-title input {
  min-width: 0;
  max-width: 100%;
  font: inherit;
  font-weight: 700;
}
.pencil-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  mix-blend-mode: multiply;
}
:global(html[data-theme="dark"] .pencil-icon) {
  filter: invert(1);
  mix-blend-mode: screen;
}
.custom-module-badge {
  display: block;
  margin-block-end: 0.25em;
  font-size: 0.75rem;
  opacity: 0.8;
}
.tutorial-video {
  display: block;
  width: 100%;
  height: auto;
}
main {
  position: relative;
  z-index: 2;
}
.site-footer {
  position: fixed;
  left: 20px;
  bottom: 16px;
  z-index: 1;
  margin: 0;
  text-align: left;
  font-size: 1rem;
  color: #000;
}
.site-footer a {
  color: inherit;
}
.footer-privacy {
  display: block;
}
</style>
