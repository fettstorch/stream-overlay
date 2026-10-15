<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, onBeforeUnmount } from "vue";
import {
  defaultCustomModuleSettings,
  validateCustomModuleSettings,
  customModuleSourceLimit,
  customModuleSettings,
  validateCustomModules,
} from "../../../modules/custom-module/src/config.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
import CustomModulePreview from "./CustomModulePreview.vue";
import AppButton from "./AppButton.vue";
import { adminFetch } from "./cloud-admin-fetch.ts";
import type { CustomModuleMedia } from "../../../modules/custom-module/src/config.ts";
const CodeEditor = defineAsyncComponent(() => import("./CodeEditor.vue"));
function editorSettings(settings: Parameters<typeof customModuleSettings>[0]) {
  const { enabled, displayMode, ...source } = customModuleSettings(settings);
  return { ...source, javascript: settings.javascript ?? "" };
}
const props = defineProps<{
  config: CloudConfig;
  moduleId: string;
  save: (config: CloudConfig) => Promise<boolean>;
  previewAspectRatio?: number;
  pageUrl?: string;
}>();
const emit = defineEmits<{ mediaDrop: [] }>();
const savedModule = computed(() =>
  props.config.customModules?.find((module) => module.id === props.moduleId),
);
const draft = ref(editorSettings(savedModule.value ?? defaultCustomModuleSettings));
const previewSettings = computed(() => ({
  ...draft.value,
  enabled: savedModule.value?.enabled ?? false,
}));
const displayMode = computed(() => savedModule.value?.displayMode ?? "overlay");
const savingDisplayMode = ref(false);
const displayModeMessage = ref("");
async function changeDisplayMode(event: Event) {
  const input = event.target as HTMLInputElement;
  if (savingDisplayMode.value || saving.value) return;
  const next = input.checked ? "page" : "overlay";
  savingDisplayMode.value = true;
  displayModeMessage.value = "";
  try {
    const saved = await props.save({
      ...props.config,
      customModules: props.config.customModules?.map((module) =>
        module.id === props.moduleId ? { ...module, displayMode: next } : module,
      ),
    });
    if (!saved) displayModeMessage.value = "Could not save the display mode. Please try again.";
  } catch {
    displayModeMessage.value = "Could not save the display mode. Please try again.";
  } finally {
    input.checked = displayMode.value === "page";
    savingDisplayMode.value = false;
  }
}
const message = ref("");
const pageCopied = ref(false);
let pageCopyTimer: ReturnType<typeof setTimeout> | undefined;
const displayPageUrl = computed(() => props.pageUrl?.replace(/([?&]token=)[^&#]*/gi, "$1…"));
function openPage() {
  if (props.pageUrl) window.open(props.pageUrl, "_blank", "noopener,noreferrer");
}
async function copyPageUrl() {
  if (!props.pageUrl) return;
  try {
    await navigator.clipboard.writeText(props.pageUrl);
    if (disposed) return;
    pageCopied.value = true;
    clearTimeout(pageCopyTimer);
    pageCopyTimer = setTimeout(() => { pageCopied.value = false; }, 1800);
  } catch {
    if (!disposed) message.value = "Could not copy the URL.";
  }
}
const saving = ref(false);
const savedFeedback = ref(false);
let savedFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
const uploading = ref(false);
const sourceMode = ref(savedModule.value?.bundle ? "zip" : "code");
const bundleInput = ref<HTMLInputElement>();
let draftBundleFile: File | undefined;
watch(sourceMode, (mode) => { if (mode === "code") delete draft.value.bundle; });
async function uploadBundle(file?: File) {
  if (!file || uploading.value || saving.value) return;
  sourceMode.value = "zip";
  emit("mediaDrop");
  uploading.value = true; message.value = `Uploading ${file.name} to your PDS…`;
  try {
    if (!file.size || file.size > 10_000_000) throw new Error("ZIP apps must be between 1 byte and 10 MB.");
    if (new TextEncoder().encode(file.name).length > 200) throw new Error("Use a ZIP filename shorter than 200 bytes.");
    const blob = await uploadFile(file, "application/zip");
    if (disposed) return;
    draft.value.bundle = { name: file.name, blob };
    draftBundleFile = file;
    message.value = "ZIP app added to the draft. Save overlay to keep it.";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Could not upload the ZIP app.";
  } finally { uploading.value = false; }
}
async function selectedBundle(event: Event) {
  const input = event.target as HTMLInputElement;
  await uploadBundle(input.files?.[0]);
  input.value = "";
}
async function dropFiles(files: File[], x = 50, y = 50) {
  const zip = files.find((file) => /\.zip$/i.test(file.name));
  if (zip) await uploadBundle(zip);
  else await dropMedia(files, x, y);
}
function dragFiles(event: DragEvent) {
  if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
}
async function dropEditorFiles(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  event.preventDefault(); event.stopPropagation();
  await dropFiles(files);
}
const draftFiles = new Map<string, File>();
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(savedFeedbackTimer);
  clearTimeout(pageCopyTimer);
});
const fileTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
function mediaType(file: File) {
  const type = file.type || fileTypes[file.name.split(".").pop()?.toLowerCase() ?? ""];
  return Object.values(fileTypes).includes(type) ? type : undefined;
}
async function uploadFile(file: File, type: string): Promise<CustomModuleMedia["blob"]> {
  const response = await adminFetch(
    `/api/accounts/${encodeURIComponent(props.config.streamerDid)}/media`,
    {
      method: "POST",
      headers: { "Content-Type": type },
      body: file,
    },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      `${detail.message ?? "Media upload failed"}${detail.requestId ? ` Reference: ${detail.requestId}` : ""}`,
    );
  }
  return response.json();
}
async function dropMedia(files: File[], x = 50, y = 50) {
  emit("mediaDrop");
  if (uploading.value || saving.value) return;
  if (!Number.isFinite(x)) x = 50;
  if (!Number.isFinite(y)) y = 50;
  uploading.value = true;
  try {
    for (const file of files) {
      const type = mediaType(file);
      if (!type) throw new Error("Drop PNG, JPEG, GIF, WebP, AVIF, MP4, MOV or WebM files.");
      if (!file.size || file.size > 10_000_000)
        throw new Error("Media must be between 1 byte and 10 MB.");
      if ((draft.value.media?.length ?? 0) >= 100)
        throw new Error("A Custom Module supports up to 100 media attachments.");
      message.value = `Uploading ${file.name} to your PDS…`;
      const blob = await uploadFile(file, type);
      if (disposed) return;
      const id = crypto.randomUUID();
      // Parent-owned blob URLs are inaccessible from the opaque-origin preview.
      // Keep the preview bytes local; only the PDS blob reference is persisted.
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read media for the preview."));
        reader.readAsDataURL(new Blob([file], { type }));
      });
      if (disposed) return;
      const media = { id, blob, url };
      const element = document.createElement(type.startsWith("image/") ? "img" : "video");
      element.setAttribute("src", `streamface-media:${id}`);
      if (element instanceof HTMLVideoElement) {
        for (const attr of ["autoplay", "loop", "muted", "playsinline"])
          element.setAttribute(attr, "");
      } else element.setAttribute("alt", file.name);
      element.setAttribute(
        "style",
        `position: absolute; left: ${Math.max(0, Math.min(100, x))}%; top: ${Math.max(0, Math.min(100, y))}%; width: 25%; height: auto;`,
      );
      const next = {
        ...draft.value,
        html: `${draft.value.html}\n${element.outerHTML}`,
        media: [...(draft.value.media ?? []), media],
      };
      validateCustomModuleSettings({ ...savedModule.value, ...next });
      draft.value = next;
      draftFiles.set(id, file);
      message.value = "Media added to the draft. Save overlay or :w to keep it.";
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Could not upload media.";
  } finally {
    uploading.value = false;
  }
}
async function acceptCardDrop(files: FileList | null | undefined) {
  const list = Array.from(files ?? []);
  if (!list.length) return { accepted: false };
  await dropFiles(list);
  return { accepted: list.some((file) => /\.zip$/i.test(file.name) || mediaType(file)), message: message.value };
}
defineExpose({ acceptCardDrop });
const showStream = ref(false);
const vimMode = computed(() => props.config.preferences?.vimControls === true);
function contentKey(value: object) {
  return JSON.stringify(value, (key, value) => (key === "url" ? undefined : value));
}
const streamUrl = computed(() =>
  showStream.value && props.config.streamerDid
    ? `https://stream.place/embed/${encodeURIComponent(props.config.streamerDid)}?muted=true`
    : undefined,
);
const dirty = computed(
  () => contentKey(draft.value) !== contentKey(editorSettings(savedModule.value ?? defaultCustomModuleSettings)),
);
watch(
  () => savedModule.value,
  (value, previous) => {
    // Metadata saves must preserve unsaved source edits.
    if (contentKey(editorSettings(previous ?? defaultCustomModuleSettings)) === contentKey(draft.value)) {
      draft.value = editorSettings(value ?? defaultCustomModuleSettings);
      sourceMode.value = value?.bundle ? "zip" : "code";
    }
  },
);
async function save() {
  if (saving.value || savingDisplayMode.value || uploading.value || !dirty.value) return;
  message.value = "";
  try {
    if (sourceMode.value === "zip" && !draft.value.bundle) throw new Error("Choose a ZIP app before saving.");
    validateCustomModuleSettings(previewSettings.value);
    validateCustomModules([{ ...savedModule.value, ...draft.value, id: props.moduleId }]);
    saving.value = true;
    savedFeedback.value = false;
    clearTimeout(savedFeedbackTimer);
    // Unreferenced uploads can expire on a PDS. Refresh staged files before attaching them.
    const authored = new DOMParser().parseFromString(draft.value.html, "text/html");
    const referenced = new Set(
      Array.from(authored.querySelectorAll("img[src],video[src]"), (element) =>
        element.getAttribute("src")?.replace(/^streamface-media:/, ""),
      ),
    );
    if (draft.value.media)
      draft.value.media = draft.value.media.filter((media) => referenced.has(media.id));
    for (const media of draft.value.media ?? []) {
      const file = draftFiles.get(media.id);
      if (file) media.blob = await uploadFile(file, mediaType(file)!);
    }
    if (draft.value.bundle && draftBundleFile)
      draft.value.bundle.blob = await uploadFile(draftBundleFile, "application/zip");
    if (
      await props.save({
        ...props.config,
        customModules: props.config.customModules?.map((module) => {
          if (module.id !== props.moduleId) return module;
          const { html, css, javascript, bundle, media, ...metadata } = module;
          return {
            ...metadata,
            ...draft.value,
            ...(draft.value.media
              ? { media: draft.value.media.map(({ id, blob }) => ({ id, blob })) }
              : {}),
          };
        }),
      })
    ) {
      draftFiles.clear();
      draftBundleFile = undefined;
      savedFeedback.value = true;
      savedFeedbackTimer = setTimeout(() => { savedFeedback.value = false; }, 1800);
      message.value = "Custom Module saved. Connected overlays update automatically.";
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Could not save Custom Module.";
  } finally {
    saving.value = false;
  }
}
function reset() {
  draftFiles.clear();
  draftBundleFile = undefined;
  draft.value = editorSettings(savedModule.value ?? defaultCustomModuleSettings);
  sourceMode.value = savedModule.value?.bundle ? "zip" : "code";
  message.value = "";
}
</script>
<template>
  <div
    class="editor-fields custom-module-editor"
    aria-label="Custom Module editor"
    @dragover="dragFiles"
    @drop="dropEditorFiles"
  >
    <div class="command-mode-selector">
      <strong :class="{ 'mode-selected': displayMode !== 'page' }">Shared overlay</strong>
      <label class="switch choice-switch">
        <input
          type="checkbox"
          aria-label="Own page mode"
          :checked="displayMode === 'page'"
          :disabled="saving || savingDisplayMode"
          :aria-busy="savingDisplayMode"
          @change="changeDisplayMode"
        >
        <span aria-hidden="true" />
      </label>
      <strong :class="{ 'mode-selected': displayMode === 'page' }">Own page</strong>
    </div>
    <p v-if="displayModeMessage" role="status">{{ displayModeMessage }}</p>
    <slot />
    <p v-if="displayMode === 'page'">This module fills its own page and stays off the shared overlay. Enable the module to show its content.</p>
    <div v-if="displayMode === 'page' && pageUrl" class="overlay-url">
      <code>{{ displayPageUrl }}</code>
      <button type="button" class="open-url-button" aria-label="Open module page" @click="openPage">
        <span class="external-link-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="copy-button"
        :class="{ copied: pageCopied }"
        aria-label="Copy module page URL"
        @click="copyPageUrl"
      >
        <span class="copy-icon" aria-hidden="true" />
      </button>
    </div>
    <p v-if="sourceMode === 'code'">
      Use <span class="html-label">HTML</span>, <span class="css-label">CSS</span> and JavaScript.
      Use the JavaScript field for scripts; it runs after your HTML is rendered.
      Drop images or videos onto the preview to upload them to your PDS. Use the <span class="css-label">CSS</span> field for styles and animations. Each field supports
      up to
      {{ customModuleSourceLimit / 1000 }} KB.
    </p>
    <div class="command-mode-selector">
      <strong :class="{ 'mode-selected': sourceMode === 'code' }">Code</strong>
      <label class="switch choice-switch">
        <input type="checkbox" aria-label="ZIP app mode" :checked="sourceMode === 'zip'" :disabled="saving || uploading"
          @change="sourceMode = ($event.target as HTMLInputElement).checked ? 'zip' : 'code'">
        <span aria-hidden="true" />
      </label>
      <strong :class="{ 'mode-selected': sourceMode === 'zip' }">ZIP app</strong>
    </div>
    <div v-if="sourceMode === 'zip'" class="editor-fields">
      <p>Drop a ZIP here or choose a file. Include index.html and the built app's assets.</p>
      <p>For Vite, set <code>base: './'</code> in vite.config so asset URLs point inside your app rather than the website root.</p>
      <small>Maximum 10 MB zipped, 50 MB unpacked, 1,000 files.</small>
      <input ref="bundleInput" hidden type="file" accept=".zip,application/zip" :disabled="saving || uploading" @change="selectedBundle">
      <AppButton class="zip-upload-button" :disabled="saving || uploading" @click="bundleInput?.click()">{{ uploading ? 'Uploading…' : draft.bundle ? 'Replace ZIP app' : 'Choose ZIP app' }}</AppButton>
      <small v-if="draft.bundle">{{ draft.bundle.name }}</small>
    </div>
    <div v-else class="custom-module-sources">
      <div class="source-field">
        <span class="html-label">HTML</span
        ><CodeEditor
          v-model="draft.html"
          language="html"
          label="Custom Module HTML"
          :vim-mode="vimMode"
          @save="save"
        />
      </div>
      <div class="source-field">
        <span class="css-label">CSS</span
        ><CodeEditor
          v-model="draft.css"
          language="css"
          label="Custom Module CSS"
          :vim-mode="vimMode"
          @save="save"
        />
      </div>
      <div class="source-field">
        <span class="javascript-label">JavaScript</span>
        <CodeEditor
          v-model="draft.javascript"
          language="javascript"
          label="Custom Module JavaScript"
          :vim-mode="vimMode"
          @save="save"
        />
      </div>
    </div>
    <div class="editor-actions">
      <button class="save-overlay-button success-button" type="button" :aria-busy="saving" :data-save-state="savedFeedback && !dirty ? 'saved' : undefined" :disabled="saving || savingDisplayMode || uploading || !dirty" @click="save">
        <span class="button-press-shade" aria-hidden="true"></span><span class="button-hover-shade" aria-hidden="true"></span><span class="button-content">{{ saving ? 'Saving…' : savedFeedback && !dirty ? '✓ Saved' : 'Save overlay' }}</span></button
      ><button class="danger-button" type="button" :disabled="saving || savingDisplayMode || uploading || !dirty" @click="reset"><span class="button-press-shade" aria-hidden="true"></span><span class="button-hover-shade" aria-hidden="true"></span><span class="button-content">
        Discard changes
      </span></button>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
    <div class="editor-preview">
    <CustomModulePreview
      :did="config.streamerDid"
      :settings="previewSettings"
      :stream-url="streamUrl"
      :aspect-ratio="previewAspectRatio"
      @html="
        (html) => {
          if (!saving && !uploading) draft.html = html;
        }
      "
      @media-drop="dropFiles"
      @error="message = $event"
    />
    </div>
    <div class="stream-preview-option">
      <span>Show my stream behind the preview</span>
      <label class="switch"
        ><input
          v-model="showStream"
          type="checkbox"
          aria-label="Show my stream behind the preview" /><span
      /></label>
    </div>
  </div>
</template>
<style scoped>
.custom-module-editor {
  min-width: 0;
}
.zip-upload-button { justify-self: start; }
.editor-preview {
  margin-top: 32px;
}
.html-label {
  color: #b77b00;
}
.css-label {
  color: #1769c2;
}
.javascript-label { color: #886000; }
:global(html[data-theme="dark"] .javascript-label) { color: #f5df55; }
:global(html[data-theme="dark"] .html-label) {
  color: #f5c542;
}
:global(html[data-theme="dark"] .css-label) {
  color: #69b5ff;
}
.custom-module-sources {
  display: flex;
  gap: 16px;
  margin-block: 16px;
}
label,
.source-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-weight: 700;
}
.source-field {
  flex: 1 1 0;
  min-width: 0;
  transition: flex-grow 180ms ease;
}
@media (min-width: 701px) {
  .source-field:focus-within {
    flex-grow: 4;
  }
}
@media (min-width: 701px) and (hover: hover) {
  .custom-module-sources:has(> .source-field:hover) > .source-field {
    flex-grow: 1;
  }
  .custom-module-sources:has(> .source-field:hover) > .source-field:hover {
    flex-grow: 4;
  }
}
@media (prefers-reduced-motion: reduce) {
  .source-field { transition: none; }
}
.editor-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.save-overlay-button { min-width: 8em; }
.stream-preview-option {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-block: 16px;
}
@media (max-width: 700px) {
  .custom-module-sources {
    flex-direction: column;
  }
}
</style>
