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
import { adminFetch } from "./cloud-admin-fetch.ts";
import type { CustomModuleMedia } from "../../../modules/custom-module/src/config.ts";
const CodeEditor = defineAsyncComponent(() => import("./CodeEditor.vue"));
const props = defineProps<{
  config: CloudConfig;
  moduleId: string;
  save: (config: CloudConfig) => Promise<boolean>;
  previewAspectRatio?: number;
}>();
const emit = defineEmits<{ mediaDrop: [] }>();
const savedModule = computed(() =>
  props.config.customModules?.find((module) => module.id === props.moduleId),
);
const draft = ref({
  ...customModuleSettings(savedModule.value ?? defaultCustomModuleSettings),
  name: savedModule.value?.name ?? "Custom Module",
});
const message = ref("");
const saving = ref(false);
const savedFeedback = ref(false);
let savedFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
const uploading = ref(false);
const draftFiles = new Map<string, File>();
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(savedFeedbackTimer);
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
      validateCustomModuleSettings(next);
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
  await dropMedia(list);
  return { accepted: list.some((file) => mediaType(file)), message: message.value };
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
  () =>
    contentKey(draft.value) !==
    contentKey({
      ...customModuleSettings(savedModule.value ?? defaultCustomModuleSettings),
      name: savedModule.value?.name ?? "Custom Module",
    }),
);
watch(
  () => savedModule.value,
  (value, previous) => {
    // Preserve unsaved editor text when another module is saved or this is toggled.
    const before = {
      ...customModuleSettings(previous ?? defaultCustomModuleSettings),
      name: previous?.name ?? "Custom Module",
    };
    const { enabled: oldEnabled, ...oldContent } = before;
    const { enabled: draftEnabled, ...draftContent } = draft.value;
    if (contentKey(oldContent) === contentKey(draftContent)) {
      draft.value = {
        ...customModuleSettings(value ?? defaultCustomModuleSettings),
        name: value?.name ?? "Custom Module",
      };
      return;
    }
    draft.value.enabled = value?.enabled ?? false;
    draft.value.name = value?.name ?? "Custom Module";
  },
);
async function save() {
  if (saving.value || uploading.value || !dirty.value) return;
  message.value = "";
  try {
    validateCustomModuleSettings(draft.value);
    validateCustomModules([{ ...draft.value, id: props.moduleId }]);
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
    if (
      await props.save({
        ...props.config,
        customModules: props.config.customModules?.map((module) =>
          module.id === props.moduleId
            ? {
                ...draft.value,
                id: module.id,
                ...(draft.value.media
                  ? { media: draft.value.media.map(({ id, blob }) => ({ id, blob })) }
                  : {}),
              }
            : module,
        ),
      })
    ) {
      draftFiles.clear();
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
  draft.value = {
    ...customModuleSettings(savedModule.value ?? defaultCustomModuleSettings),
    name: savedModule.value?.name ?? "Custom Module",
  };
  message.value = "";
}
</script>
<template>
  <section
    class="module-section editor-fields custom-module-editor"
    aria-label="Custom Module editor"
  >
    <p>
      <span class="html-label">HTML</span> and <span class="css-label">CSS</span> only.
      Drop images or videos onto the preview to upload them to your PDS. Scripts,
      embeds and links are blocked. Use the <span class="css-label">CSS</span> field for styles and animations. Each field supports
      up to
      {{ customModuleSourceLimit / 1000 }} KB.
    </p>
    <div class="custom-module-sources">
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
    </div>
    <div class="editor-actions">
      <button class="save-overlay-button success-button" type="button" :aria-busy="saving" :data-save-state="savedFeedback && !dirty ? 'saved' : undefined" :disabled="saving || uploading || !dirty" @click="save">
        <span class="button-press-shade" aria-hidden="true"></span><span class="button-hover-shade" aria-hidden="true"></span><span class="button-content">{{ saving ? 'Saving…' : savedFeedback && !dirty ? '✓ Saved' : 'Save overlay' }}</span></button
      ><button class="danger-button" type="button" :disabled="saving || uploading || !dirty" @click="reset"><span class="button-press-shade" aria-hidden="true"></span><span class="button-hover-shade" aria-hidden="true"></span><span class="button-content">
        Discard changes
      </span></button>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
    <div class="editor-preview">
    <CustomModulePreview
      :settings="draft"
      :stream-url="streamUrl"
      :aspect-ratio="previewAspectRatio"
      @html="
        (html) => {
          if (!saving && !uploading) draft.html = html;
        }
      "
      @media-drop="dropMedia"
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
  </section>
</template>
<style scoped>
.custom-module-editor {
  min-width: 0;
}
.editor-preview {
  margin-top: 32px;
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
.custom-module-sources {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
    grid-template-columns: 1fr;
  }
}
</style>
