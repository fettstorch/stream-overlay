<script setup lang="ts">
import { adminFetch } from "./cloud-admin-fetch.ts";
import CollapsibleSection from "./CollapsibleSection.vue";
import { emoteEvents, type EmoteEventType } from "../../../modules/emoticons/src/events.ts";
import DeleteConfirmation from "./DeleteConfirmation.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CloudCommand, CloudConfig, CloudMedia } from "./cloud-admin-types.ts";
import { validateCloudCommand } from "../../../modules/emoticons/src/validation.ts";
import { searchGiphy, resolveGiphy, type GiphyChoice } from "./giphy.ts";
import { getDebouncer } from "@fettstorch/jule";
import giphyAttribution from "./assets/branding/PoweredBy_200px-White_HorizLogo.png";

const props = defineProps<{
  did: string;
  config: CloudConfig;
  save: (candidate: CloudConfig, successMessage?: string) => Promise<boolean>;
  beforeTest?: (command: CloudCommand) => Promise<void>;
  panel?: string;
}>();
const emit = defineEmits<{ 'panel-change': [panel: string] }>();
const kinds = ["image", "audio", "video"] as const;
const deleting = ref<CloudCommand | null>(null);
type MediaKind = (typeof kinds)[number];
const formOpen = ref(false),
  editing = ref<string | null>(null),
  busy = ref(false),
  message = ref("");
const pending = ref<Partial<Record<MediaKind, CloudMedia>>>({});
// Keep draft bytes until saved: deleting the last record using an uploaded CID
// can invalidate its blob reference, even after a successful duplicate upload.
const draftFiles: Partial<Record<MediaKind, File>> = {};
const previewUrls = ref<Partial<Record<MediaKind, string>>>({});
const mediaUrlInput = ref(""),
  unresolvedUrl = ref("");
const giphyResults = ref<GiphyChoice[]>([]), giphySearching = ref(false);
const giphySearchMode = computed(() => Boolean(mediaUrlInput.value.trim()) && !/^[a-z][a-z0-9+.-]*:/i.test(mediaUrlInput.value.trim()));
let giphyGeneration = 0, giphyOperationId = "";
const giphyDebouncer = getDebouncer();
watch(mediaUrlInput, () => {
  giphyDebouncer.clear();
  giphyGeneration++; giphyResults.value = []; giphySearching.value = false;
  if (giphySearchMode.value) giphyDebouncer.debounce(() => void submitMediaInput(), 400);
});
function giphyLog(event: "started" | "completed" | "failed" | "selected", operationId: string, count?: number) {
  void adminFetch(`/api/accounts/${encodeURIComponent(props.did)}/giphy-diagnostics`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, operationId, count }), signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
async function submitMediaInput() {
  giphyDebouncer.clear();
  if (!giphySearchMode.value) return addMediaUrl();
  const generation = ++giphyGeneration, operationId = crypto.randomUUID();
  giphyOperationId = operationId; giphySearching.value = true; giphyResults.value = [];
  message.value = "Searching GIPHY…"; giphyLog("started", operationId);
  try {
    const results = await searchGiphy(mediaUrlInput.value.trim());
    if (generation !== giphyGeneration) return;
    giphyResults.value = results;
    message.value = results.length ? "Choose a GIF to attach it." : "No GIFs found. Try another search.";
    giphyLog("completed", operationId, results.length);
  } catch (error) {
    if (generation !== giphyGeneration) return;
    message.value = error instanceof Error ? error.message : "Giphy search failed. Try again.";
    giphyLog("failed", operationId);
  } finally { if (generation === giphyGeneration) giphySearching.value = false; }
}
function selectGiphy(gif: GiphyChoice) {
  giphyLog("selected", giphyOperationId);
  removeMedia("image"); removeMedia("video");
  pending.value.image = { giphyId: gif.id };
  previewUrls.value.image = gif.url;
  mediaUrlInput.value = ""; unresolvedUrl.value = "";
  message.value = "GIF attached — only its Giphy ID will be stored on your PDS.";
}
watch(() => pending.value.image?.giphyId, async id => {
  if (!id || previewUrls.value.image) return;
  try { const url = await resolveGiphy(id); if (pending.value.image?.giphyId === id) previewUrls.value.image = url; }
  catch { if (pending.value.image?.giphyId === id) message.value = "The saved Giphy GIF could not be previewed."; }
});
const defaults = (): CloudCommand => ({
  id: "",
  command: "",
  mode: "sticker",
  durationSeconds: 8,
  cooldownSeconds: 20,
  volume: 1,
  width: "",
  height: "",
  mirrored: false,
});
const form = ref(defaults());
const mediaDurations = ref<Partial<Record<MediaKind, number>>>({});
function readDuration(kind: MediaKind, event: Event) {
  const duration = (event.target as HTMLMediaElement).duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  mediaDurations.value[kind] = duration;
  if (!editing.value && (form.value.durationSeconds === 5 || form.value.durationSeconds === 8))
    form.value.durationSeconds = Math.min(3600, Math.round(duration * 1000) / 1000);
}
function trimPreview(event: Event) {
  const element = event.target as HTMLMediaElement;
  if (element.currentTime >= form.value.durationSeconds) {
    element.pause();
    element.currentTime = 0;
  }
}
const groups = computed(() => [
  {
    title: "Clips",
    commands: props.config.commands.filter((command) => command.mode !== "sticker"),
  },
  {
    title: "Emotes (stickers)",
    commands: props.config.commands.filter((command) => command.mode === "sticker"),
  },
]);
function mediaUrl(kind: MediaKind) {
  return previewUrls.value[kind] || pending.value[kind]?.url || "";
}
function clearPreview(kind: MediaKind) {
  const preview = previewUrls.value[kind];
  if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
  delete previewUrls.value[kind];
}
function removeMedia(kind: MediaKind) {
  clearPreview(kind);
  delete pending.value[kind];
  delete draftFiles[kind];
}
function clearDraft() {
  formOpen.value = false;
  editing.value = null;
  form.value = defaults();
  pending.value = {};
  for (const kind of kinds) delete draftFiles[kind];
  mediaDurations.value = {};
  mediaUrlInput.value = "";
  unresolvedUrl.value = "";
  for (const kind of kinds) clearPreview(kind);
}
function reset() {
  clearDraft();
  emit('panel-change', 'commands');
}
function cancel() {
  if (props.panel !== 'create') return reset();
  clearDraft();
  formOpen.value = true;
  message.value = "";
}
function create() {
  reset();
  formOpen.value = true;
  message.value = "";
  emit('panel-change', 'create');
}
watch(() => props.panel, panel => { if (panel === 'create' && !formOpen.value) create(); });
const mappedEvents = computed(() => emoteEvents.flatMap(event => {
  const mapping = props.config.eventMappings?.find(mapping => mapping.event === event.id);
  const command = props.config.commands.find(command => command.id === mapping?.commandId && command.mode === "effect");
  return command ? [{ ...event, command }] : [];
}));
async function test(command: CloudCommand, event?: EmoteEventType) {
  busy.value = true;
  try {
    await props.beforeTest?.(command);
    const response = await adminFetch(
      `/api/accounts/${encodeURIComponent(props.did)}/test/${encodeURIComponent(command.id)}${event ? `?event=${encodeURIComponent(event)}` : ""}`,
      { method: "POST" },
    );
    const detail = (await response.json()) as { message?: string; requestId?: string };
    message.value = detail.message ?? "Could not test the command.";
    if (!response.ok && detail.requestId) message.value += ` Reference: ${detail.requestId}`;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "The test could not reach the server.";
  } finally {
    busy.value = false;
  }
}
function edit(command: CloudCommand) {
  reset();
  formOpen.value = true;
  editing.value = command.id;
  form.value = { ...command };
  for (const kind of kinds) {
    const media = command[kind];
    if (!media) continue;
    pending.value[kind] = media.blob ? { blob: media.blob } : { url: media.url };
    if (media.blob && media.url) previewUrls.value[kind] = media.url;
  }
  message.value = "";
  emit('panel-change', 'create');
}
function changeMode() {
  if (form.value.mode === "sticker") removeMedia("audio");
  if (!pending.value.video && !pending.value.audio)
    form.value.durationSeconds = form.value.mode === "sticker" ? 8 : 5;
}
const mediaTypes: Record<string, { kind: MediaKind; type: string }> = {
  gif: { kind: "image", type: "image/gif" },
  png: { kind: "image", type: "image/png" },
  jpg: { kind: "image", type: "image/jpeg" },
  jpeg: { kind: "image", type: "image/jpeg" },
  webp: { kind: "image", type: "image/webp" },
  mp3: { kind: "audio", type: "audio/mpeg" },
  m4a: { kind: "audio", type: "audio/mp4" },
  wav: { kind: "audio", type: "audio/wav" },
  ogg: { kind: "audio", type: "audio/ogg" },
  opus: { kind: "audio", type: "audio/ogg" },
  mp4: { kind: "video", type: "video/mp4" },
  mov: { kind: "video", type: "video/quicktime" },
  webm: { kind: "video", type: "video/webm" },
};
function extension(value: string) {
  try {
    return new URL(value, "https://local.invalid").pathname
      .match(/\.([a-z0-9]+)$/i)?.[1]
      .toLowerCase();
  } catch {
    return value.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  }
}
function fileMedia(file: File) {
  const declared = file.type.split(";", 1)[0].trim().toLowerCase();
  const kind: MediaKind | undefined = declared.startsWith("image/")
    ? "image"
    : declared.startsWith("audio/")
      ? "audio"
      : declared.startsWith("video/")
        ? "video"
        : undefined;
  if (kind) return { kind, type: declared === "image/jpg" ? "image/jpeg" : declared };
  return mediaTypes[extension(file.name) ?? ""];
}
function unsupportedFile(file: File) {
  return `Unsupported file: ${file.name}. Choose an image, GIF, audio, MP4, MOV, or WebM file.`;
}
function attachUrl(kind: MediaKind, value: string) {
  if (form.value.mode === "sticker" && kind === "audio") {
    message.value = "Stickers do not support audio attachments.";
    return;
  }
  pending.value[kind] = { url: value };
  delete draftFiles[kind];
  clearPreview(kind);
  if (kind === "image") removeMedia("video");
  if (kind === "video") removeMedia("image");
  mediaUrlInput.value = "";
  unresolvedUrl.value = "";
  message.value = `${kind[0].toUpperCase()}${kind.slice(1)} URL attached.`;
}
function probe(url: string, kind: MediaKind) {
  return new Promise<boolean>((resolve) => {
    const element = kind === "image" ? new Image() : document.createElement(kind);
    const timer = setTimeout(() => finish(false), 4000);
    const finish = (result: boolean) => {
      clearTimeout(timer);
      element.onload = null;
      element.onerror = null;
      if (element instanceof HTMLMediaElement) {
        element.onloadedmetadata = null;
        element.removeAttribute("src");
        element.load();
      }
      resolve(result);
    };
    element.onerror = () => finish(false);
    if (element instanceof HTMLMediaElement) {
      element.preload = "metadata";
      element.onloadedmetadata = () => finish(true);
    } else element.onload = () => finish(true);
    element.src = url;
  });
}
async function addMediaUrl() {
  const value = mediaUrlInput.value.trim();
  unresolvedUrl.value = "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    message.value = "Enter a valid direct HTTPS media URL.";
    return;
  }
  if (url.protocol !== "https:") {
    message.value = "Direct media URLs must use HTTPS.";
    return;
  }
  const known = mediaTypes[extension(url.toString()) ?? ""];
  if (known) {
    attachUrl(known.kind, url.toString());
    return;
  }
  busy.value = true;
  message.value = "Checking the direct media URL…";
  try {
    for (const kind of kinds)
      if (await probe(url.toString(), kind)) {
        attachUrl(kind, url.toString());
        return;
      }
    unresolvedUrl.value = url.toString();
    message.value =
      "The URL did not identify playable media. Provider pages such as Giphy pages are not direct media URLs.";
  } finally {
    busy.value = false;
  }
}
async function uploadFiles(files: FileList | null | undefined) {
  if (!files || busy.value) return;
  busy.value = true;
  try {
    for (const file of Array.from(files)) {
      const media = fileMedia(file),
        kind = media?.kind;
      if (!media || !kind) {
        message.value = unsupportedFile(file);
        continue;
      }
      if (form.value.mode === "sticker" && kind === "audio") {
        message.value = "Stickers do not support audio attachments.";
        continue;
      }
      message.value = `Uploading ${file.name} to your PDS…`;
      const response = await adminFetch(`/api/accounts/${encodeURIComponent(props.did)}/media`, {
        method: "POST",
        headers: { "Content-Type": media.type },
        body: file,
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as {
          message?: string;
          requestId?: string;
        };
        const requestId = detail.requestId ?? response.headers.get("x-request-id");
        message.value = `${detail.message ?? `Upload failed: ${file.name}`}${requestId ? ` Reference: ${requestId}` : ""}`;
        continue;
      }
      pending.value[kind] = { blob: await response.json() };
      draftFiles[kind] = file;
      clearPreview(kind);
      previewUrls.value[kind] = URL.createObjectURL(file);
      if (kind === "image") removeMedia("video");
      if (kind === "video") removeMedia("image");
      message.value = "Uploaded — save the command to persist its blob reference.";
    }
  } catch {
    message.value = "The upload could not reach the server. Your existing command was not changed.";
  } finally {
    busy.value = false;
  }
}
async function acceptCardDrop(files: FileList | null | undefined) {
  const list = Array.from(files ?? []),
    supported = list.filter((file) => fileMedia(file));
  if (!supported.length) {
    const error = list[0]
      ? unsupportedFile(list[0])
      : "Drop an image, GIF, audio, MP4, MOV, or WebM file.";
    message.value = error;
    return { accepted: false, message: error };
  }
  if (!formOpen.value) create();
  emit('panel-change', 'create');
  await uploadFiles(files);
  return { accepted: true };
}
function selected(event: Event) {
  const input = event.target as HTMLInputElement;
  void uploadFiles(input.files);
  input.value = "";
}
async function save() {
  if (busy.value) return;
  const normalized = form.value.command.trim().replace(/^!/, "").toLowerCase();
  const command: CloudCommand = {
    ...form.value,
    id: editing.value ?? crypto.randomUUID(),
    command: normalized,
    image: pending.value.image,
    audio: form.value.mode === "sticker" ? undefined : pending.value.audio,
    video: pending.value.video,
  };
  try {
    validateCloudCommand(command);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Invalid command";
    return;
  }
  const commands = props.config.commands.slice(),
    index = commands.findIndex((item) => item.id === command.id);
  if (commands.some((item, itemIndex) => item.command === command.command && itemIndex !== index)) {
    message.value = `!${command.command} already exists.`;
    return;
  }
  if (index < 0) commands.push(command);
  else commands[index] = command;
  busy.value = true;
  try {
    for (const kind of kinds) {
      const file = draftFiles[kind];
      if (!file || !command[kind]?.blob) continue;
      message.value = "Refreshing draft media on your PDS before saving…";
      const response = await adminFetch(`/api/accounts/${encodeURIComponent(props.did)}/media`, {
        method: "POST", headers: { "Content-Type": fileMedia(file)!.type }, body: file,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(`${detail.message ?? "Could not refresh the draft media."}${detail.requestId ? ` Reference: ${detail.requestId}` : ""}`);
      }
      pending.value[kind] = command[kind] = { blob: await response.json() };
    }
    const saved = await props.save(
      { ...props.config, commands },
      editing.value ? "Command updated on your PDS." : "Command created on your PDS.",
    );
    if (saved) reset();
    message.value = "";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Could not save the command.";
  } finally {
    busy.value = false;
  }
}
async function remove(command: CloudCommand) {
  if (props.config.preferences?.confirmDeletion !== false) {
    deleting.value = command;
    return;
  }
  await deleteConfirmed(command);
}
async function deleteConfirmed(command: CloudCommand, dontShowAgain = false) {
  busy.value = true;
  const saved = await props.save(
    {
      ...props.config,
      ...(dontShowAgain ? { preferences: { confirmDeletion: false } } : {}),
      commands: props.config.commands.filter((item) => item.id !== command.id),
    },
    `!${command.command} deleted from your PDS.`,
  );
  busy.value = false;
  if (saved) deleting.value = null;
  if (saved && editing.value === command.id) reset();
}
onBeforeUnmount(() => {
  giphyDebouncer.clear();
  giphyGeneration++;
  for (const kind of kinds) clearPreview(kind);
});
defineExpose({ acceptCardDrop });
</script>

<template>
  <section class="emoticon-controls" :class="{ 'create-panel': panel === 'create' }">
    <DeleteConfirmation
      v-if="deleting"
      :name="`!${deleting.command}`"
      :busy="busy"
      @cancel="deleting = null"
      @confirm="deleteConfirmed(deleting!, $event)"
    />
    <div v-show="!panel || panel === 'commands' || panel === 'create'">
    <h4 v-if="!panel">Emote commands</h4>
    <CollapsibleSection
      v-for="group in groups"
      :key="group.title"
      class="command-group"
      :title="group.title"
      :count="group.commands.length"
      ><p v-if="!group.commands.length" class="empty-copy">No commands yet</p>
      <ul class="command-list striped-list">
        <li v-for="command in group.commands" :key="command.id">
          <strong>!{{ command.command }}</strong
          ><button type="button" :disabled="busy" @click="test(command)">Test</button
          ><button type="button" @click="edit(command)">Edit</button
          ><button type="button" class="danger-button" @click="remove(command)">Delete</button>
        </li>
      </ul></CollapsibleSection
    >
    <CollapsibleSection v-if="panel === 'commands' && mappedEvents.length" class="command-group" title="Events" :count="mappedEvents.length">
      <ul class="command-list striped-list">
        <li v-for="event in mappedEvents" :key="event.id">
          <strong>{{ event.name }} · !{{ event.command.command }}</strong>
          <button type="button" :disabled="busy" :aria-label="`Simulate ${event.name}`" @click="test(event.command, event.id)">Simulate</button>
        </li>
      </ul>
    </CollapsibleSection>
    <slot name="previews" />
    </div>
    <div v-if="!formOpen && !panel">
      <button class="primary-button" type="button" @click="create">Create new command</button>
    </div>
    <form v-if="formOpen" v-show="!panel || panel === 'create'" :inert="panel === 'commands' || undefined" class="module-section command-editor editor-fields" @submit.prevent="save">
      <div v-if="editing || !panel" class="editor-heading">
        <h4>{{ editing ? "Edit command" : "Create command" }}</h4>
        <button v-if="!panel" type="button" class="secondary-button" @click="reset">Close</button>
      </div>
      <div class="command-mode-selector">
        <strong :class="{ 'mode-selected': form.mode === 'effect' }">Clip</strong>
        <label class="switch choice-switch">
          <input
          type="checkbox"
          aria-label="Sticker mode"
          :checked="form.mode === 'sticker'"
          @change="
            form.mode = ($event.target as HTMLInputElement).checked ? 'sticker' : 'effect';
            changeMode();
          "
          /><span aria-hidden="true" />
        </label>
        <strong :class="{ 'mode-selected': form.mode === 'sticker' }">Sticker</strong>
      </div>
      <small v-if="form.mode === 'sticker'"
        >Silent stickers drift upward independently. Every matching message spawns one.</small
      >
      <small v-else>Clips play your image, GIF, video or audio for a set duration. A cooldown limits how often chat can trigger them.</small>
      <label
        >Command <input v-model="form.command" placeholder="!wow" required maxlength="40"
      /></label>
      <div
        class="drop-zone"
        @dragenter.stop
        @dragover.stop.prevent
        @dragleave.stop
        @drop.stop.prevent="uploadFiles($event.dataTransfer?.files)"
      >
        <label
          >Media — drop files or choose<input
            type="file"
            :accept="
              form.mode === 'sticker'
                ? 'image/*,video/*,.gif,.mp4,.mov,.webm'
                : 'image/*,audio/*,video/*,.gif,.mp4,.mov,.webm'
            "
            multiple
            :disabled="busy"
            @change="selected"
        /></label>
        <div class="media-url-row">
          <label
            >Or paste a media URL / search GIPHY<input
              v-model="mediaUrlInput"
              type="text"
              placeholder="https://…/media.gif or a GIF search"
              :disabled="busy"
              @keydown.enter.prevent="submitMediaInput" /></label
          ><button v-if="!giphySearchMode" type="button" :disabled="busy || !mediaUrlInput.trim()" @click="submitMediaInput">
            Add URL
          </button>
        </div>
        <div v-if="giphySearchMode || giphyResults.length" class="giphy-picker">
          <img :src="giphyAttribution" alt="Powered by GIPHY" width="200" />
          <div v-if="giphyResults.length" class="giphy-results" aria-label="Giphy search results">
            <button v-for="gif in giphyResults" :key="gif.id" type="button" :aria-label="`Choose ${gif.title}`"
              :disabled="busy" @click="selectGiphy(gif)">
              <img :src="gif.preview" :alt="gif.title" loading="lazy" />
            </button>
          </div>
        </div>
        <small
          >{{
            form.mode === "sticker"
              ? "Images, GIFs, or muted MP4/MOV/WebM videos. Use a file or a direct media URL."
              : "Images, GIFs, audio, MP4/MOV/WebM video. Use files or direct media URLs; you can attach one visual and separate audio."
          }}
          A new image or video replaces the current visual.</small
        >
        <div v-if="unresolvedUrl" class="media-kind-choice">
          <span>What kind of direct media is this?</span
          ><button type="button" @click="attachUrl('image', unresolvedUrl)">Image/GIF</button
          ><button
            v-if="form.mode === 'effect'"
            type="button"
            @click="attachUrl('audio', unresolvedUrl)"
          >
            Audio</button
          ><button type="button" @click="attachUrl('video', unresolvedUrl)">Video</button>
        </div>
        <div v-for="kind in kinds" v-show="pending[kind]" :key="kind" class="attachment">
          <span>{{ kind }} attached</span
          ><button type="button" @click="removeMedia(kind)">Remove</button>
        </div>
      </div>
      <label v-if="mediaUrl('image') || mediaUrl('video')" class="sticker-toggle"
        ><input v-model="form.mirrored" type="checkbox" /> Mirror horizontally</label
      >
      <img
        v-if="mediaUrl('image')"
        :src="mediaUrl('image')"
        class="asset-preview"
        :style="{ transform: form.mirrored ? 'scaleX(-1)' : undefined }"
        alt="Selected emoticon"
      /><video
        v-if="mediaUrl('video')"
        :src="mediaUrl('video')"
        class="asset-preview"
        :style="{ transform: form.mirrored ? 'scaleX(-1)' : undefined }"
        controls
        muted
        playsinline
        preload="metadata"
        @loadedmetadata="readDuration('video', $event)"
        @timeupdate="trimPreview"
      /><audio
        v-if="form.mode === 'effect' && mediaUrl('audio')"
        :src="mediaUrl('audio')"
        controls
        muted
        preload="metadata"
        @loadedmetadata="readDuration('audio', $event)"
        @timeupdate="trimPreview"
      />
      <small v-if="mediaDurations.video || mediaDurations.audio"
        >Full media duration:
        {{ Math.max(mediaDurations.video || 0, mediaDurations.audio || 0).toFixed(1) }}s. Playback
        stops at the configured duration.</small
      >
      <div class="fields-row">
        <label class="compact-field"
          >Duration (seconds)
          <input
            v-model.number="form.durationSeconds"
            type="number"
            min="0.001"
            max="3600"
            step="any"
            required /></label
        ><label v-if="form.mode === 'effect'" class="compact-field"
          >Cooldown (seconds)
          <input
            v-model.number="form.cooldownSeconds"
            type="number"
            min="0"
            max="86400"
            step="1"
            required /></label
        ><label class="compact-field"
          >CSS width
          <input
            v-model="form.width"
            :placeholder="form.mode === 'sticker' ? '5vw (default)' : '40vw (default)'" /></label
        ><label class="compact-field"
          >CSS height
          <input
            v-model="form.height"
            :placeholder="form.mode === 'sticker' ? '5vw (default)' : '35vh (default)'"
        /></label>
      </div>
      <div v-if="form.mode === 'effect'" class="appearance-controls">
        <label class="chat-slider">
          <span>Volume</span>
          <output>{{ Math.round(form.volume * 100) }}%</output>
          <input v-model.number="form.volume" type="range" min="0" max="1" step="0.05" aria-label="Volume" />
        </label>
      </div>
      <div class="form-actions">
        <button class="primary-button" type="submit" :disabled="busy">
          {{ editing ? "Save changes" : "Create new command" }}</button
        ><button type="button" class="secondary-button" :disabled="busy" @click="cancel">
          Cancel
        </button>
      </div>
    </form>
    <p v-if="message" class="module-message" role="status">{{ message }}</p>
  </section>
</template>
