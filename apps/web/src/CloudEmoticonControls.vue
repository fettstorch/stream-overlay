<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { CloudCommand, CloudConfig, CloudMedia } from "./cloud-admin-types.ts";

const props = defineProps<{ did: string; config: CloudConfig; save: (candidate: CloudConfig, successMessage?: string) => Promise<boolean> }>();
const kinds = ["image", "audio", "video"] as const;
type MediaKind = typeof kinds[number];
const formOpen = ref(false), editing = ref<string | null>(null), busy = ref(false), message = ref("");
const pending = ref<Partial<Record<MediaKind, CloudMedia>>>({});
const previewUrls = ref<Partial<Record<MediaKind, string>>>({});
const defaults = (): CloudCommand => ({ id: "", command: "", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false });
const form = ref(defaults());
const groups = computed(() => [
  { title: "Clips", commands: props.config.commands.filter(command => command.mode !== "sticker") },
  { title: "Emoticons (stickers)", commands: props.config.commands.filter(command => command.mode === "sticker") },
]);
function mediaUrl(kind: MediaKind) { return previewUrls.value[kind] || pending.value[kind]?.url || ""; }
function clearPreview(kind: MediaKind) { if (previewUrls.value[kind]) URL.revokeObjectURL(previewUrls.value[kind]!); delete previewUrls.value[kind]; }
function removeMedia(kind: MediaKind) { clearPreview(kind); delete pending.value[kind]; }
function reset() { formOpen.value = false; editing.value = null; form.value = defaults(); pending.value = {}; for (const kind of kinds) clearPreview(kind); }
function create() { reset(); formOpen.value = true; message.value = ""; }
function edit(command: CloudCommand) { reset(); formOpen.value = true; editing.value = command.id; form.value = { ...command }; pending.value = { image: command.image, audio: command.audio, video: command.video }; message.value = ""; }
function changeMode() { if (form.value.mode === "sticker") removeMedia("audio"); if (!pending.value.video && !pending.value.audio) form.value.durationSeconds = form.value.mode === "sticker" ? 8 : 5; }
function setUrl(kind: MediaKind, event: Event) { const value = (event.target as HTMLInputElement).value.trim(); pending.value[kind] = value ? { url: value } : undefined; }
async function uploadFiles(files: FileList | null | undefined) {
  if (!files || busy.value) return; busy.value = true;
  try {
    for (const file of Array.from(files)) {
      const kind: MediaKind | null = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : null;
      if (!kind) { message.value = `Unsupported file: ${file.name}`; continue; }
      if (form.value.mode === "sticker" && kind === "audio") { message.value = "Stickers do not support audio attachments."; continue; }
      message.value = `Uploading ${file.name} to your PDS…`;
      const response = await fetch(`/api/accounts/${encodeURIComponent(props.did)}/media`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) { message.value = `Upload failed: ${file.name}`; continue; }
      pending.value[kind] = { blob: await response.json() }; clearPreview(kind); previewUrls.value[kind] = URL.createObjectURL(file);
      if (kind === "image") removeMedia("video"); if (kind === "video") removeMedia("image");
      message.value = "Uploaded — save the command to persist its blob reference.";
    }
  } catch { message.value = "Upload failed. Your existing command was not changed."; }
  finally { busy.value = false; }
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
      <div class="drop-zone" @dragover.prevent @drop.prevent="uploadFiles($event.dataTransfer?.files)"><label>Media — drop files or choose<input type="file" :accept="form.mode === 'sticker' ? 'image/*,video/*' : 'image/*,audio/*,video/*'" multiple :disabled="busy" @change="selected"></label><small>{{ form.mode === 'sticker' ? 'Images, GIFs, or muted videos.' : 'Images, GIFs, audio, or video. A new image or video replaces the current visual.' }}</small><div v-for="kind in kinds" v-show="pending[kind]" :key="kind" class="attachment"><span>{{ kind }} attached</span><button type="button" @click="removeMedia(kind)">Remove</button></div></div>
      <fieldset><legend>Or use direct HTTPS media URLs</legend><label>Image/GIF URL <input :value="pending.image?.url || ''" type="url" placeholder="https://…/image.gif" @input="setUrl('image', $event)"></label><label v-if="form.mode === 'effect'">Audio URL <input :value="pending.audio?.url || ''" type="url" placeholder="https://…/sound.mp3" @input="setUrl('audio', $event)"></label><label>Video URL <input :value="pending.video?.url || ''" type="url" placeholder="https://…/clip.webm" @input="setUrl('video', $event)"></label></fieldset>
      <label v-if="mediaUrl('image') || mediaUrl('video')" class="sticker-toggle"><input v-model="form.mirrored" type="checkbox"> Mirror horizontally</label>
      <img v-if="mediaUrl('image')" :src="mediaUrl('image')" class="asset-preview" :style="{ transform: form.mirrored ? 'scaleX(-1)' : undefined }" alt="Selected emoticon"><video v-if="mediaUrl('video')" :src="mediaUrl('video')" class="asset-preview" :style="{ transform: form.mirrored ? 'scaleX(-1)' : undefined }" controls muted playsinline preload="metadata" /><audio v-if="form.mode === 'effect' && mediaUrl('audio')" :src="mediaUrl('audio')" controls muted preload="metadata" />
      <div class="fields-row"><label class="compact-field">Duration (seconds) <input v-model.number="form.durationSeconds" type="number" min="0.1" max="3600" step="0.1" required></label><label v-if="form.mode === 'effect'" class="compact-field">Cooldown (seconds) <input v-model.number="form.cooldownSeconds" type="number" min="0" max="86400" step="1" required></label><label class="compact-field">CSS width <input v-model="form.width" :placeholder="form.mode === 'sticker' ? '5vw (default)' : '40vw (default)'"></label><label class="compact-field">CSS height <input v-model="form.height" :placeholder="form.mode === 'sticker' ? '5vw (default)' : '35vh (default)'"></label></div>
      <label v-if="form.mode === 'effect'">Volume <input v-model.number="form.volume" type="range" min="0" max="1" step="0.05"></label>
      <div class="form-actions"><button class="primary-button" type="submit" :disabled="busy">{{ editing ? 'Save changes' : 'Create command' }}</button><button type="button" class="secondary-button" :disabled="busy" @click="reset">Cancel</button></div>
    </form><p class="module-message" role="status">{{ message }}</p>
  </section>
</template>
