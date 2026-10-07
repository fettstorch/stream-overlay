<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { EmoticonAsset, EmoticonCommand, EmoticonState } from "../../../modules/emoticons/src/contracts";
const commands = ref<EmoticonCommand[]>([]);
const assets = ref<EmoticonAsset[]>([]);
const editing = ref<string | null>(null);
const message = ref("");
const busy = ref(false);
const defaults = () => ({ command: "", label: "", imageAssetId: null as string | null, audioAssetId: null as string | null, durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "" });
const form = ref(defaults());
const imageUrl = computed(() => form.value.imageAssetId ? `/api/emoticons/assets/${form.value.imageAssetId}` : "");
const audioUrl = computed(() => form.value.audioAssetId ? `/api/emoticons/assets/${form.value.audioAssetId}` : "");
let events: EventSource | undefined;
async function result(response: Response) {
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "Request failed"); return value;
}
function update(state: EmoticonState) { commands.value = state.commands; assets.value = state.assets; }
onMounted(async () => {
  try { update(await result(await fetch("/api/emoticons/commands"))); } catch (error) { message.value = String(error); }
  events = new EventSource("/api/emoticons/events");
  events.onmessage = event => { const value = JSON.parse(event.data); if (value.type === "state") update(value.state); };
});
onBeforeUnmount(() => events?.close());
function edit(command: EmoticonCommand) { editing.value = command.id; form.value = { ...command }; message.value = ""; }
function reset() { editing.value = null; form.value = defaults(); }
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
  try { const response = await result(await fetch(`/api/emoticons/test/${command.id}`, { method: "POST" })); message.value = response.accepted ? "Queued — preview is muted; OBS plays audio" : "Not queued: disabled, on cooldown, queued or playing"; }
  catch (error) { message.value = String(error); }
}
async function upload(file: File | undefined, kind: "image" | "audio") {
  if (!file || busy.value) return;
  busy.value = true; message.value = "Uploading…";
  const url = URL.createObjectURL(file);
  try {
    let duration = 0;
    if (kind === "audio") duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio(); const timeout = setTimeout(() => finish(new Error("Could not read audio duration")), 15000);
      function finish(error?: Error) { clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute("src"); audio.load(); if (error) reject(error); }
      audio.onloadedmetadata = () => { const value = audio.duration; finish(); Number.isFinite(value) && value > 0 ? resolve(value) : reject(new Error("Audio duration is unavailable")); };
      audio.onerror = () => finish(new Error("This browser cannot read that audio file")); audio.src = url;
    });
    const data = new FormData(); data.set("file", file); data.set("kind", kind); data.set("durationSeconds", String(duration));
    const asset = await result(await fetch("/api/emoticons/assets", { method: "POST", body: data })) as EmoticonAsset;
    form.value[kind === "image" ? "imageAssetId" : "audioAssetId"] = asset.id; message.value = "Uploaded — save the command to use it";
  } catch (error) { message.value = error instanceof Error ? error.message : String(error); }
  finally { URL.revokeObjectURL(url); busy.value = false; }
}
function selected(event: Event, kind: "image" | "audio") { const input = event.target as HTMLInputElement; void upload(input.files?.[0], kind); input.value = ""; }

</script>
<template>
  <section class="emoticon-controls">
    <h4>Emoticon commands</h4>
    <p>Effect source: match your OBS canvas. Board source: start at 420 × 600 px, then size independently. Both disappear when disabled.</p>
    <ul class="command-list"><li v-for="command in commands" :key="command.id"><strong>!{{ command.command }}</strong><span>{{ command.label }}</span><button type="button" @click="test(command)">Test</button><button type="button" @click="edit(command)">Edit</button><button type="button" @click="remove(command)">Delete</button></li></ul>
    <form @submit.prevent="save">
      <h4>{{ editing ? 'Edit command' : 'Create command' }}</h4>
      <label>Command <input v-model="form.command" placeholder="!wow" required maxlength="33"></label>
      <label>Board label <input v-model="form.label" placeholder="Celebrate!" maxlength="120"></label>
      <div v-for="kind in (['image', 'audio'] as const)" :key="kind" class="drop-zone" @dragover.prevent @drop.prevent="upload($event.dataTransfer?.files[0], kind)">
        <label>{{ kind === 'image' ? 'Image / GIF' : 'Audio' }} — drop a file or choose
          <input type="file" :accept="kind === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : 'audio/*'" :disabled="busy" @change="selected($event, kind)">
        </label>
        <select v-model="form[kind === 'image' ? 'imageAssetId' : 'audioAssetId']"><option :value="null">None</option><option v-for="asset in assets.filter(asset => asset.kind === kind)" :key="asset.id" :value="asset.id">{{ asset.originalName || asset.filename }}</option></select>
      </div>
      <img v-if="imageUrl" :src="imageUrl" class="asset-preview" alt="Selected emoticon">
      <audio v-if="audioUrl" :key="audioUrl" :src="audioUrl" controls muted preload="metadata"></audio>
      <label>Duration (seconds) <input v-model.number="form.durationSeconds" type="number" min="0.1" step="0.1" required></label>
      <small>Plays for at least the audio duration. Default: 5 seconds.</small>
      <label>Cooldown (seconds) <input v-model.number="form.cooldownSeconds" type="number" min="0" step="1" required></label>
      <small>Starts immediately when accepted. Repeats are ignored while queued or playing.</small>
      <label>Volume <input v-model.number="form.volume" type="range" min="0" max="1" step="0.05"></label>
      <label>CSS width <input v-model="form.width" placeholder="40vw (default)"></label>
      <label>CSS height <input v-model="form.height" placeholder="35vh (default)"></label>
      <small>Examples: 300px, 40vw, 25vh, 50%, auto. Images keep their proportions inside this box, centered at 5vh from the top.</small>
      <div><button type="submit" :disabled="busy">{{ editing ? 'Save changes' : 'Create command' }}</button><button v-if="editing" type="button" @click="reset">Cancel</button></div>
    </form>
    <p role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.emoticon-controls{display:grid;gap:12px;margin-top:20px;padding-top:18px;border-top:1px solid #28334b;color:#bdc8df;font-size:.85rem}.emoticon-controls h4,.emoticon-controls p{margin:0}form{display:grid;gap:10px}label{display:grid;gap:6px}input,select,button{font:inherit;color:#eef2ff;background:#101828;border:1px solid #36425d;border-radius:6px;padding:8px;min-width:0}button{cursor:pointer;margin-right:6px}button:disabled{opacity:.5}input:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid #7794e8}.drop-zone{padding:16px;border:2px dashed #526baf;border-radius:10px;display:grid;gap:8px}.drop-zone:hover{background:#18243b}.asset-preview{max-width:100%;max-height:150px;object-fit:contain}audio{width:100%}.command-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}.command-list li{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.command-list span{flex:1}small{color:#93a3bf}
</style>
