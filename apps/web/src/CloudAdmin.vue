<script setup lang="ts">
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
  if (moduleId === "pokemon-crystal-mgba")
    return [
      "Add this as a compact, transparent OBS browser source beside your gameplay—not a full-screen overlay.",
      "Start at 640 × 720 px, then adjust the source dimensions and position to fit your stream layout.",
      "Leave room around the party for pet animations and thought bubbles.",
    ];
  if (moduleId.startsWith("custom:")) {
    return [
      "The overlay fills the OBS browser source at whatever dimensions you choose.",
      "The source shows your saved HTML/CSS on a transparent canvas.",
    ];
  }
  if (moduleId === "bot")
    return [
      "Add the private Bot URL as a transparent OBS browser source. Any size works.",
      "The bot reads chat only while that source is running. Keep its URL private.",
    ];
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
      pages: [
        {
          path: `/custom-module/?module=${encodeURIComponent(module.id)}`,
          entrypoint: "custom-module.html",
        },
      ],
    },
  })),
]);
const paths = computed<Record<string, string>>(() =>
  Object.fromEntries(cloudModules.value.map((module) => [module.id, module.cloud.pages[0].path])),
);
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
function previewUrl(id: string) {
  const url = new URL(cloudUrl(paths.value[id]));
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

const effectUrl = computed(() => cloudUrl("/emotes/"));
const boardUrl = computed(() => cloudUrl("/emote-listings/"));
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
async function copyUrl(kind: string) {
  try {
    await navigator.clipboard.writeText(
      cloudUrl(
        kind === "board" ? "/emote-listings/" : kind === "effect" ? "/emotes/" : paths.value[kind],
      ),
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
      <ThemeToggle />
      <BrandWordmark />
      <p class="intro">
        Manage your <StreamplaceBrand /> stream overlays from anywhere and copy their stable URLs
        into your OBS’s browser sources.
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
      <section class="settings obs-guidance" aria-labelledby="obs-guidance-title">
        <h2 id="obs-guidance-title">Use your overlays in OBS</h2>
        <p>
          This service provides overlay URLs to add as Browser Sources in OBS. Before setting up a
          module, carefully read its instructions using the <strong>i</strong> button in the
          top-right corner for sizing and any module-specific setup.
        </p>
      </section>
      <p v-if="configurationMessage" role="status">{{ configurationMessage }}</p>
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
              v-if="cardDragDepth[module.id] > 0 && module.id === 'emoticons'"
              class="module-drop-overlay"
              role="status"
            >
              {{
                module.id.startsWith("custom:")
                  ? "Drop media onto the overlay"
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
                <p v-if="module.id.startsWith('custom:')">
                  <span
                    v-for="(text, index) in module.description.split(/(HTML|CSS)/g)"
                    :key="index"
                    :class="
                      text === 'HTML' ? 'html-label' : text === 'CSS' ? 'css-label' : undefined
                    "
                    >{{ text }}</span
                  >
                </p>
                <p v-else>{{ module.description }}</p>
                <template v-if="module.id !== 'emoticons' && module.id !== 'bot'">
                  <section class="module-commands"><h4>OBS URL</h4></section>
                  <div class="overlay-url">
                    <code>{{ cloudUrl(paths[module.id]) }}</code>
                    <a
                      class="open-url-button"
                      :href="cloudUrl(paths[module.id])"
                      target="_blank"
                      rel="noopener noreferrer"
                      :aria-label="`Open ${module.name} OBS URL`"
                      ><span class="external-link-icon" aria-hidden="true"
                    /></a>
                    <button
                      type="button"
                      class="copy-button"
                      :class="{ copied: copied === module.id }"
                      :aria-label="`Copy ${module.name} OBS URL`"
                      @click="copyUrl(module.id)"
                    >
                      <span class="copy-icon" aria-hidden="true" />
                    </button>
                  </div>
                </template>
                <template v-if="module.id === 'emoticons'">
                  <section class="module-commands overlay-url-heading">
                    <h4>{{ module.id === "emoticons" ? "Emotes OBS URL" : "OBS URL" }}</h4>
                    <ModuleHelp
                      v-if="module.id === 'emoticons'"
                      id="emoticons-effects-url"
                      name="Emotes OBS URL"
                      align="start"
                      description="This is the overlay for the actual clips/gifs & stickers. Ideally put this in a browser source that spans your whole stream."
                    />
                  </section>
                  <div class="overlay-url">
                    <code>{{ cloudUrl(paths[module.id]) }}</code
                    ><a
                      class="open-url-button"
                      :href="cloudUrl(paths[module.id])"
                      target="_blank"
                      rel="noopener noreferrer"
                      :aria-label="`Open ${module.name} OBS URL`"
                      ><span class="external-link-icon" aria-hidden="true" /></a
                    ><button
                      type="button"
                      class="copy-button"
                      :class="{
                        copied:
                          copied === module.id ||
                          (module.id === 'emoticons' && copied === 'effect'),
                      }"
                      :aria-label="`Copy ${module.name} OBS URL`"
                      @click="copyUrl(module.id === 'emoticons' ? 'effect' : module.id)"
                    >
                      <span class="copy-icon" aria-hidden="true" />
                    </button>
                  </div>
                  <section class="module-commands overlay-url-heading listing-url-heading">
                    <h4>Command listing OBS URL</h4>
                    <ModuleHelp
                      id="emoticons-listing-url"
                      name="Command listing OBS URL"
                      align="start"
                      description="This is a listing of your commands for your audience including cooldowns for your clips."
                    />
                  </section>
                  <div class="overlay-url board-url">
                    <code>{{ boardUrl }}</code
                    ><a
                      class="open-url-button"
                      :href="boardUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open Emotes command listing OBS URL"
                      ><span class="external-link-icon" aria-hidden="true" /></a
                    ><button
                      type="button"
                      class="copy-button"
                      :class="{ copied: copied === 'board' }"
                      aria-label="Copy Emotes command listing OBS URL"
                      @click="copyUrl('board')"
                    >
                      <span class="copy-icon" aria-hidden="true" />
                    </button>
                  </div>
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
                <CloudCustomModuleControls
                  v-else-if="module.id.startsWith('custom:')"
                  :module-id="module.id.slice(7)"
                  :ref="(el) => setModuleControls(module.id, el)"
                  :config="config"
                  :preview-aspect-ratio="dimensions.width / dimensions.height"
                  :save="(candidate) => saveConfiguration(candidate, undefined, module.id)"
                  @media-drop="cardDragDepth[module.id] = 0"
                />
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
