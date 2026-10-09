<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { CloudCommand, CloudConfig, CloudMedia } from "./cloud-admin-types.ts";

const props = defineProps<{ did: string; config: CloudConfig; save: (candidate: CloudConfig, successMessage?: string) => Promise<boolean> }>();
const kinds = ["image", "audio", "video"] as const;
type MediaKind = typeof kinds[number];
const formOpen = ref(false), editing = ref<string | null>(null), busy = ref(false), message = ref("");
const pending = ref<Partial<Record<MediaKind, CloudMedia>>>({});
const previewUrls = ref<Partial<Record<MediaKind, string>>>({});
const mediaUrlInput = ref(""), unresolvedUrl = ref("");
const defaults = (): CloudCommand => ({ id: "", command: "", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false });
const form = ref(defaults());
const groups = computed(() => [
  { title: "Clips", commands: props.config.commands.filter(command => command.mode !== "sticker") },
  { title: "Emoticons (stickers)", commands: props.config.commands.filter(command => command.mode === "sticker") },
]);
function mediaUrl(kind: MediaKind) { return previewUrls.value[kind] || pending.value[kind]?.url || ""; }
function clearPreview(kind: MediaKind) { const preview = previewUrls.value[kind]; if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); delete previewUrls.value[kind]; }
function removeMedia(kind: MediaKind) { clearPreview(kind); delete pending.value[kind]; }
function reset() { formOpen.value = false; editing.value = null; form.value = defaults(); pending.value = {}; mediaUrlInput.value = ""; unresolvedUrl.value = ""; for (const kind of kinds) clearPreview(kind); }
function create() { reset(); formOpen.value = true; message.value = ""; }
function edit(command: CloudCommand) { reset(); formOpen.value = true; editing.value = command.id; form.value = { ...command }; for (const kind of kinds) { const media = command[kind]; if (!media) continue; pending.value[kind] = media.blob ? { blob: media.blob } : { url: media.url }; if (media.blob && media.url) previewUrls.value[kind] = media.url; } message.value = ""; }
function changeMode() { if (form.value.mode === "sticker") removeMedia("audio"); if (!pending.value.video && !pending.value.audio) form.value.durationSeconds = form.value.mode === "sticker" ? 8 : 5; }
const mediaTypes: Record<string, { kind: MediaKind; type: string }> = {
  gif: { kind: "image", type: "image/gif" }, png: { kind: "image", type: "image/png" }, jpg: { kind: "image", type: "image/jpeg" }, jpeg: { kind: "image", type: "image/jpeg" }, webp: { kind: "image", type: "image/webp" },
  mp3: { kind: "audio", type: "audio/mpeg" }, m4a: { kind: "audio", type: "audio/mp4" }, wav: { kind: "audio", type: "audio/wav" }, ogg: { kind: "audio", type: "audio/ogg" }, opus: { kind: "audio", type: "audio/ogg" },
  mp4: { kind: "video", type: "video/mp4" }, mov: { kind: "video", type: "video/quicktime" }, webm: { kind: "video", type: "video/webm" },
};
function extension(value: string) { try { return new URL(value, "https://local.invalid").pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase(); } catch { return value.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase(); } }
function fileMedia(file: File) { const declared = file.type.split(";", 1)[0].trim().toLowerCase(); const kind: MediaKind | undefined = declared.startsWith("image/") ? "image" : declared.startsWith("audio/") ? "audio" : declared.startsWith("video/") ? "video" : undefined; if (kind) return { kind, type: declared === "image/jpg" ? "image/jpeg" : declared }; return mediaTypes[extension(file.name) ?? ""]; }
function unsupportedFile(file: File) { return `Unsupported file: ${file.name}. Choose an image, GIF, audio, MP4, MOV, or WebM file.`; }
function attachUrl(kind: MediaKind, value: string) { if (form.value.mode === "sticker" && kind === "audio") { message.value = "Stickers do not support audio attachments."; return; } pending.value[kind] = { url: value }; clearPreview(kind); if (kind === "image") removeMedia("video"); if (kind === "video") removeMedia("image"); mediaUrlInput.value = ""; unresolvedUrl.value = ""; message.value = `${kind[0].toUpperCase()}${kind.slice(1)} URL attached.`; }
function probe(url: string, kind: MediaKind) { return new Promise<boolean>(resolve => { const element = kind === "image" ? new Image() : document.createElement(kind); const timer = setTimeout(() => finish(false), 4000); const finish = (result: boolean) => { clearTimeout(timer); element.onload = null; element.onerror = null; if (element instanceof HTMLMediaElement) { element.onloadedmetadata = null; element.removeAttribute("src"); element.load(); } resolve(result); }; element.onerror = () => finish(false); if (element instanceof HTMLMediaElement) { element.preload = "metadata"; element.onloadedmetadata = () => finish(true); } else element.onload = () => finish(true); element.src = url; }); }
async function addMediaUrl() { const value = mediaUrlInput.value.trim(); unresolvedUrl.value = ""; let url: URL; try { url = new URL(value); } catch { message.value = "Enter a valid direct HTTPS media URL."; return; } if (url.protocol !== "https:") { message.value = "Direct media URLs must use HTTPS."; return; } const known = mediaTypes[extension(url.toString()) ?? ""]; if (known) { attachUrl(known.kind, url.toString()); return; } busy.value = true; message.value = "Checking the direct media URL…"; try { for (const kind of kinds) if (await probe(url.toString(), kind)) { attachUrl(kind, url.toString()); return; } unresolvedUrl.value = url.toString(); message.value = "The URL did not identify playable media. Provider pages such as Giphy pages are not direct media URLs."; } finally { busy.value = false; } }
async function uploadFiles(files: FileList | null | undefined) {
  if (!files || busy.value) return; busy.value = true;
  try {
    for (const file of Array.from(files)) {
      const media = fileMedia(file), kind = media?.kind;
      if (!media || !kind) { message.value = unsupportedFile(file); continue; }
      if (form.value.mode === "sticker" && kind === "audio") { message.value = "Stickers do not support audio attachments."; continue; }
      message.value = `Uploading ${file.name} to your PDS…`;
      const response = await fetch(`/api/accounts/${encodeURIComponent(props.did)}/media`, { method: "POST", headers: { "Content-Type": media.type }, body: file });
      if (!response.ok) { const detail = await response.json().catch(() => ({})) as { message?: string }; message.value = detail.message ?? `Upload failed: ${file.name}`; continue; }
      pending.value[kind] = { blob: await response.json() }; clearPreview(kind); previewUrls.value[kind] = URL.createObjectURL(file);
      if (kind === "image") removeMedia("video"); if (kind === "video") removeMedia("image");
      message.value = "Uploaded — save the command to persist its blob reference.";
    }
  } catch { message.value = "The upload could not reach the server. Your existing command was not changed."; }
  finally { busy.value = false; }
}
async function acceptCardDrop(files: FileList | null | undefined) {
  const list = Array.from(files ?? []), supported = list.filter(file => fileMedia(file));
  if (!supported.length) { const error = list[0] ? unsupportedFile(list[0]) : "Drop an image, GIF, audio, MP4, MOV, or WebM file."; message.value = error; return { accepted: false, message: error }; }
  if (!formOpen.value) create();
  await uploadFiles(files);
  return { accepted: true };
}
function selected(event: Event) { const input = event.target as HTMLInputElement; void uploadFiles(input.files); input.value = ""; }
async function save() {
  const normalized = form.value.command.trim().replace(/^!/, "").toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(normalized)) { message.value = "Use 1–40 lowercase letters, numbers, underscores, or hyphens."; return; }
  const command: CloudCommand = { ...form.value, id: editing.value ?? crypto.randomUUID(), command: normalized, image: pending.value.image, audio: form.value.mode === "sticker" ? undefined : pending.value.audio, video: pending.value.video };
  const commands = props.config.commands.slice(), index = commands.findIndex(item => item.id === command.id);
  if (commands.some((item, itemIndex) => item.command === command.command && itemIndex !== index)) { message.value = `!${command.command} already exists.`; return; }
  if (index < 0) commands.push(command); else commands[index] = command;
  busy.value = true;
  const saved = await props.save({ ...props.config, commands }, editing.value ? "Command updated on your PDS." : "Command created on your PDS.");
  busy.value = false;
  if (saved) reset();
}
async function remove(command: CloudCommand) { if (!confirm(`Delete !${command.command}?`)) return; busy.value = true; const saved = await props.save({ ...props.config, commands: props.config.commands.filter(item => item.id !== command.id) }, `!${command.command} deleted from your PDS.`); busy.value = false; if (saved && editing.value === command.id) reset(); }
onBeforeUnmount(() => { for (const kind of kinds) clearPreview(kind); });
defineExpose({ acceptCardDrop });
</script>

<template>
  <section class="emoticon-controls">
    <h4>Emoticon commands</h4><p>Effect source: match your OBS canvas. Board source: start at 420 × 600 px, then size independently. Both disappear when disabled.</p>
    <details v-for="group in groups" :key="group.title" class="command-group" open><summary>{{ group.title }} <span>({{ group.commands.length }})</span></summary><p v-if="!group.commands.length" class="empty-copy">No commands yet</p><ul class="command-list"><li v-for="command in group.commands" :key="command.id"><strong>!{{ command.command }}</strong><span>{{ command.mode === 'sticker' ? 'Sticker' : `${command.durationSeconds}s clip` }}</span><button type="button" @click="edit(command)">Edit</button><button type="button" class="danger-button" @click="remove(command)">Delete</button></li></ul></details>
    <div v-if="!formOpen"><button class="primary-button" type="button" @click="create">Create command</button></div>
    <form v-if="formOpen" class="command-editor" @submit.prevent="save">
      <div class="editor-heading"><h4>{{ editing ? 'Edit command' : 'Create command' }}</h4><button type="button" class="secondary-button" @click="reset">Close</button></div>
      <label class="sticker-toggle"><input type="checkbox" :checked="form.mode === 'sticker'" @change="form.mode = ($event.target as HTMLInputElement).checked ? 'sticker' : 'effect'; changeMode()"> Sticker</label>
      <small v-if="form.mode === 'sticker'">Silent stickers drift upward independently. Every matching message spawns one.</small>
      <label>Command <input v-model="form.command" placeholder="!wow" required maxlength="40"></label>
      <div class="drop-zone" @dragenter.stop @dragover.stop.prevent @dragleave.stop @drop.stop.prevent="uploadFiles($event.dataTransfer?.files)">
        <label>Media — drop files or choose<input type="file" :accept="form.mode === 'sticker' ? 'image/*,video/*,.gif,.mp4,.mov,.webm' : 'image/*,audio/*,video/*,.gif,.mp4,.mov,.webm'" multiple :disabled="busy" @change="selected"></label>
        <div class="media-url-row"><label>Or add a direct HTTPS media URL<input v-model="mediaUrlInput" type="url" placeholder="https://…/media.gif" :disabled="busy" @keydown.enter.prevent="addMediaUrl"></label><button type="button" :disabled="busy || !mediaUrlInput.trim()" @click="addMediaUrl">Add URL</button></div>
        <small>{{ form.mode === 'sticker' ? 'Images, GIFs, or muted MP4/MOV/WebM videos. Use a file or a direct media URL.' : 'Images, GIFs, audio, MP4/MOV/WebM video. Use files or direct media URLs; you can attach one visual and separate audio.' }} A new image or video replaces the current visual.</small>
        <div v-if="unresolvedUrl" class="media-kind-choice"><span>What kind of direct media is this?</span><button type="button" @click="attachUrl('image', unresolvedUrl)">Image/GIF</button><button v-if="form.mode === 'effect'" type="button" @click="attachUrl('audio', unresolvedUrl)">Audio</button><button type="button" @click="attachUrl('video', unresolvedUrl)">Video</button></div>
        <div v-for="kind in kinds" v-show="pending[kind]" :key="kind" class="attachment"><span>{{ kind }} attached</span><button type="button" @click="removeMedia(kind)">Remove</button></div>
      </div>
      <label v-if="mediaUrl('image') || mediaUrl('video')" class="sticker-toggle"><input v-model="form.mirrored" type="checkbox"> Mirror horizontally</label>
      <img v-if="mediaUrl('image')" :src="mediaUrl('image')" class="asset-preview" :style="{ transform: form.mirrored ? 'scaleX(-1)' : undefined }" alt="Selected emoticon"><video v-if="mediaUrl('video')" :src="mediaUrl('video')" class="asset-preview" :style="{ transform: form.mirrored ? 'scaleX(-1)' : undefined }" controls muted playsinline preload="metadata" /><audio v-if="form.mode === 'effect' && mediaUrl('audio')" :src="mediaUrl('audio')" controls muted preload="metadata" />
      <div class="fields-row"><label class="compact-field">Duration (seconds) <input v-model.number="form.durationSeconds" type="number" min="0.1" max="3600" step="0.1" required></label><label v-if="form.mode === 'effect'" class="compact-field">Cooldown (seconds) <input v-model.number="form.cooldownSeconds" type="number" min="0" max="86400" step="1" required></label><label class="compact-field">CSS width <input v-model="form.width" :placeholder="form.mode === 'sticker' ? '5vw (default)' : '40vw (default)'"></label><label class="compact-field">CSS height <input v-model="form.height" :placeholder="form.mode === 'sticker' ? '5vw (default)' : '35vh (default)'"></label></div>
      <label v-if="form.mode === 'effect'">Volume <input v-model.number="form.volume" type="range" min="0" max="1" step="0.05"></label>
      <div class="form-actions"><button class="primary-button" type="submit" :disabled="busy">{{ editing ? 'Save changes' : 'Create command' }}</button><button type="button" class="secondary-button" :disabled="busy" @click="reset">Cancel</button></div>
    </form><p class="module-message" role="status">{{ message }}</p>
  </section>
</template>
