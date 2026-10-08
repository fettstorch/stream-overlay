<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { EmoticonAsset, EmoticonCommand, EmoticonState } from "../../../modules/emoticons/src/contracts";
import { observeEmoticonEvents } from "../../../modules/emoticons/src/events-client";
const commands = ref<EmoticonCommand[]>([]);
const commandGroups = computed(() => [
  { title: "Clips", commands: commands.value.filter(command => command.mode !== "sticker") },
  { title: "Emoticons (stickers)", commands: commands.value.filter(command => command.mode === "sticker") },
]);
const assets = ref<EmoticonAsset[]>([]);
const formOpen = ref(false);
const editing = ref<string | null>(null);
const message = ref("");
const busy = ref(false);
const defaults = () => ({ mode: "effect" as "effect" | "sticker", command: "", imageAssetId: null as string | null, audioAssetId: null as string | null, videoAssetId: null as string | null, durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "" });
const form = ref(defaults());
const imageUrl = computed(() => form.value.imageAssetId ? `/api/emoticons/assets/${form.value.imageAssetId}` : "");
const audioUrl = computed(() => form.value.audioAssetId ? `/api/emoticons/assets/${form.value.audioAssetId}` : "");
const videoUrl = computed(() => form.value.videoAssetId ? `/api/emoticons/assets/${form.value.videoAssetId}` : "");
type MediaKind = EmoticonAsset["kind"];
const assetKey = (kind: MediaKind) => `${kind}AssetId` as "imageAssetId" | "audioAssetId" | "videoAssetId";
function attachment(kind: MediaKind) {
  const id = form.value[assetKey(kind)];
  return assets.value.find(asset => asset.id === id);
}
let events: ReturnType<typeof observeEmoticonEvents> | undefined;
async function result(response: Response) {
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "Request failed"); return value;
}
function update(state: EmoticonState) { commands.value = state.commands; assets.value = state.assets; }
onMounted(() => {
  events = observeEmoticonEvents("admin", event => { if (event.type === "state") update(event.state); });
});
onBeforeUnmount(() => events?.close());
function edit(command: EmoticonCommand) { formOpen.value = true; editing.value = command.id; form.value = { ...command, mode: command.mode ?? "effect" }; message.value = ""; }
function changeMode() {
  if (form.value.mode === "sticker") form.value.audioAssetId = null;
  if (!form.value.videoAssetId && !form.value.audioAssetId) form.value.durationSeconds = form.value.mode === "sticker" ? 8 : 5;
}
function reset() { formOpen.value = false; editing.value = null; form.value = defaults(); }
function create() { reset(); formOpen.value = true; message.value = ""; }
async function save() {
  busy.value = true;
  try {
    await result(await fetch(`/api/emoticons/commands${editing.value ? `/${editing.value}` : ""}`, { method: editing.value ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form.value) }));
    reset(); message.value = "Saved";
  } catch (error) { message.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}
async function remove(command: EmoticonCommand) {
  if (!confirm(`Delete !${command.command}?`)) return;
  try { const response = await fetch(`/api/emoticons/commands/${command.id}`, { method: "DELETE" }); if (!response.ok) await result(response); if (editing.value === command.id) reset(); message.value = "Deleted"; }
  catch (error) { message.value = String(error); }
}
async function test(command: EmoticonCommand) {
  try { const response = await result(await fetch(`/api/emoticons/test/${command.id}`, { method: "POST" })); message.value = response.accepted ? command.mode === "sticker" ? "Sticker spawned" : "Queued — plays in connected effect sources" : "Not queued: disabled, on cooldown, queued or playing"; }
  catch (error) { message.value = String(error); }
}
async function upload(file: File | undefined) {
  if (!file || busy.value) return;
  const uploadId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage = "metadata";
  function diagnose(event: string, details: Record<string, unknown> = {}) {
    const data = { uploadId, stage, elapsedMs: Date.now() - startedAt, filename: file!.name, bytes: file!.size, contentType: file!.type, ...details };
    console.info(`[${event}]`, data);
    void fetch("/api/diagnostics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, details: data }), signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  const kind: MediaKind | null = /\.(mp4|mov)$/i.test(file.name) || file.type.startsWith("video/") ? "video"
    : file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") || file.type === "application/ogg" ? "audio" : null;
  if (!kind) { message.value = "Choose an image, GIF, audio, MP4, or MOV file"; diagnose("emoticons.upload-browser-rejected", { reason: "unsupported-type" }); return; }
  if (form.value.mode === "sticker" && kind === "audio") { message.value = "Stickers do not support audio attachments"; return; }
  busy.value = true; message.value = kind === "image" ? "Preparing upload…" : "Reading media duration…";
  diagnose("emoticons.upload-browser-started", { kind });
  const url = URL.createObjectURL(file);
  try {
    let duration = 0;
    if (kind !== "image") duration = await new Promise<number>((resolve, reject) => {
      const media = kind === "video" ? document.createElement("video") : new Audio();
      const timeout = setTimeout(() => finish(new Error("Could not read media duration")), 15000);
      function finish(error?: Error) { clearTimeout(timeout); media.onloadedmetadata = null; media.onerror = null; media.removeAttribute("src"); media.load(); if (error) reject(error); }
      media.onloadedmetadata = () => { const value = media.duration; finish(); Number.isFinite(value) && value > 0 ? resolve(value) : reject(new Error("Media duration is unavailable")); };
      media.onerror = () => finish(new Error("This browser cannot play that file. For video, try H.264/AAC in MP4 or MOV.")); media.preload = "metadata"; media.src = url;
    });
    diagnose("emoticons.upload-metadata-read", { kind, durationSeconds: duration });
    stage = "request"; message.value = "Uploading…";
    const data = new FormData(); data.set("file", file); data.set("kind", kind); data.set("durationSeconds", String(duration));
    diagnose("emoticons.upload-browser-requested");
    const response = await fetch("/api/emoticons/assets", { method: "POST", headers: { "X-Emoticon-Upload-Id": uploadId }, body: data, signal: AbortSignal.timeout(60000) });
    diagnose("emoticons.upload-browser-response", { status: response.status });
    const asset = await result(response) as EmoticonAsset;
    if (!assets.value.some(item => item.id === asset.id)) assets.value.push(asset);
    form.value[assetKey(kind)] = asset.id;
    if (kind !== "image") form.value.durationSeconds = asset.durationSeconds;
    if (kind === "image") form.value.videoAssetId = null;
    if (kind === "video") form.value.imageAssetId = null;
    message.value = "Uploaded — save the command to use it";
    diagnose("emoticons.upload-browser-completed", { assetId: asset.id });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    diagnose("emoticons.upload-browser-failed", { error: detail });
    message.value = error instanceof Error && error.name === "TimeoutError" ? "Upload timed out waiting for the server. Please retry; see upload diagnostics." : detail;
  }
  finally { URL.revokeObjectURL(url); busy.value = false; }
}
async function uploadFiles(files: FileList | null | undefined) {
  if (busy.value || !files) return;
  for (const file of Array.from(files)) await upload(file);
}
function selected(event: Event) { const input = event.target as HTMLInputElement; void uploadFiles(input.files); input.value = ""; }

</script>
<template>
  <section class="emoticon-controls">
    <h4>Emoticon commands</h4>
    <p>Effect source: match your OBS canvas. Board source: start at 420 × 600 px, then size independently. Both disappear when disabled.</p>
    <details v-for="group in commandGroups" :key="group.title" class="command-group">
    <summary>{{ group.title }} <span>({{ group.commands.length }})</span></summary>
    <p v-if="!group.commands.length">No commands yet</p>
    <ul class="command-list"><li v-for="command in group.commands" :key="command.id"><strong>!{{ command.command }}</strong><button type="button" @click="test(command)">Test</button><button type="button" @click="edit(command)">Edit</button><button type="button" @click="remove(command)">Delete</button></li></ul>
    </details>
    <div v-if="!formOpen"><button type="button" @click="create">Create command</button></div>
    <form v-if="formOpen" class="command-editor" @submit.prevent="save">
      <h4>{{ editing ? 'Edit command' : 'Create command' }}</h4>
      <label class="sticker-toggle"><input type="checkbox" :checked="form.mode === 'sticker'" @change="form.mode = ($event.target as HTMLInputElement).checked ? 'sticker' : 'effect'; changeMode()"> Sticker</label>
      <small v-if="form.mode === 'sticker'">Silent stickers drift upward independently. Every message spawns one, with no cooldown or queue.</small>
      <label>Command <input v-model="form.command" placeholder="!wow" required maxlength="33"></label>
      <div class="drop-zone" @dragover.prevent @drop.prevent="uploadFiles($event.dataTransfer?.files)">
        <label>Media — drop files or choose
          <input type="file" :accept="form.mode === 'sticker' ? 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,.mp4,.mov' : 'image/png,image/jpeg,image/gif,image/webp,audio/*,video/mp4,video/quicktime,.mp4,.mov'" multiple :disabled="busy" @change="selected">
        </label>
        <small v-if="form.mode === 'sticker'">Images, GIFs, or muted MP4/MOV videos. A new visual replaces the current one.</small>
        <small v-else>Images, GIFs, audio, MP4, or MOV. Videos play their own audio. A new image or video replaces the current visual.</small>
        <template v-for="kind in (['image', 'audio', 'video'] as const)" :key="kind">
        <div v-if="form[assetKey(kind)]" class="attachment">
          <span>{{ attachment(kind)?.originalName || attachment(kind)?.filename || 'Attached file' }}</span>
          <button type="button" :disabled="busy" :aria-label="`Remove ${kind} attachment`" @click="form[assetKey(kind)] = null">Remove</button>
        </div>
        </template>
      </div>
      <img v-if="imageUrl" :src="imageUrl" class="asset-preview" alt="Selected emoticon">
      <video v-if="videoUrl" :key="videoUrl" :src="videoUrl" class="asset-preview" controls muted playsinline preload="metadata"></video>
      <audio v-if="audioUrl" :key="audioUrl" :src="audioUrl" controls muted preload="metadata"></audio>
      <div class="fields-row">
        <label class="compact-field">Duration (seconds) <input v-model.number="form.durationSeconds" type="number" min="0.001" step="any" required></label>
        <label v-if="form.mode === 'effect'" class="compact-field">Cooldown (seconds) <input v-model.number="form.cooldownSeconds" type="number" min="0" step="1" required></label>
        <label class="compact-field">CSS width <input v-model="form.width" :placeholder="form.mode === 'sticker' ? '80px (default)' : '40vw (default)'"></label>
        <label class="compact-field">CSS height <input v-model="form.height" :placeholder="form.mode === 'sticker' ? '80px (default)' : '35vh (default)'"></label>
      </div>
      <small v-if="form.mode === 'sticker'">Drift lifetime. Default: 8 seconds; video loops silently.</small>
      <small v-else>Plays for at least the audio or video duration. Default: 5 seconds. Cooldown starts when accepted; repeats are ignored while queued or playing.</small>
      <label v-if="form.mode === 'effect'">Volume <input v-model.number="form.volume" type="range" min="0" max="1" step="0.05"></label>
      <small v-if="form.mode === 'sticker'">Default: 80 × 80 px, preserving proportions, spawning across the bottom and drifting upward.</small>
      <small v-else>Examples: 300px, 40vw, 25vh, 50%, auto. Images and videos keep their proportions inside this box, centered at 5vh from the top.</small>
      <div><button type="submit" :disabled="busy">{{ editing ? 'Save changes' : 'Create command' }}</button><button type="button" :disabled="busy" @click="reset">Cancel</button></div>
    </form>
    <p role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.emoticon-controls{display:grid;gap:12px;margin-top:20px;padding-top:18px;border-top:1px solid #28334b;color:#bdc8df;font-size:.85rem}.emoticon-controls h4,.emoticon-controls p{margin:0}form{display:grid;gap:10px}.command-editor{padding:16px;border:1px solid #36425d;border-radius:10px;background:#0b1220}.fields-row{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:start}.compact-field{justify-items:start}.compact-field input{width:14ch;box-sizing:content-box}.command-group{border:1px solid #28334b;border-radius:8px;padding:12px}.command-group summary{cursor:pointer;font-weight:600}.command-group summary span{color:#93a3bf;font-weight:400}.command-group[open] summary{margin-bottom:12px}label{display:grid;gap:6px}input,button{font:inherit;color:#eef2ff;background:#101828;border:1px solid #36425d;border-radius:6px;padding:8px;min-width:0}button{cursor:pointer;margin-right:6px}button:disabled{opacity:.5}input:focus-visible,button:focus-visible{outline:2px solid #7794e8}.sticker-toggle{display:flex;align-items:center;gap:8px}.drop-zone{padding:16px;border:2px dashed #526baf;border-radius:10px;display:grid;gap:8px}.drop-zone:hover{background:#18243b}.attachment{display:flex;align-items:center;gap:8px}.attachment span{flex:1;min-width:0;overflow-wrap:anywhere}.asset-preview{max-width:100%;max-height:150px;object-fit:contain}audio{width:100%}.command-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}.command-list li{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.command-list strong{flex:1}small{color:#93a3bf}
</style>
