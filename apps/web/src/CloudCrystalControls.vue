<script setup lang="ts">
import { getDebouncer } from "@fettstorch/jule";
import AppButton from "./AppButton.vue";
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { RelayClient } from "@streamface/browser-runtime";
import type { PokemonSnapshot } from "@streamface/pokemon-model";
import fallback from "../../../assets/unknown-pokemon.svg";
import { searchGiphy, type GiphyChoice } from "./giphy.ts";
import giphyAttribution from "./assets/branding/PoweredBy_200px-White_HorizLogo.png";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { adminFetch, uploadMedia } from "./cloud-admin-fetch.ts";
import {
  validateCrystalMedia,
  type CrystalMedia,
} from "../../../modules/pokemon-crystal/src/cloud-contracts.ts";
const props = defineProps<{
  config: CloudConfig;
  save: (config: CloudConfig) => Promise<boolean>;
  panel?: "script" | "artwork";
}>();
const species = ref(25);
const sortedMappings = computed(() =>
  [...(props.config.pokemonCrystalMgbaMedia ?? [])].sort((a, b) => a.number - b.number),
);
const party = ref<PokemonSnapshot["party"]>([]);
const editing = ref(false);
const artworkEditor = ref<HTMLElement>();
let partyRelay: RelayClient | undefined;
let partyExpiry: ReturnType<typeof setTimeout> | undefined;
function clearParty() {
  party.value = [];
  clearTimeout(partyExpiry);
}
onMounted(() => {
  partyRelay = new RelayClient(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/relay`,
    {
      type: "hello",
      did: props.config.streamerDid,
      page: "pokemon-crystal-mgba",
      channel: "preview",
    },
    (message) => {
      if (message.type !== "pokemon-crystal-mgba") return;
      party.value = message.snapshot.party;
      clearTimeout(partyExpiry);
      partyExpiry = setTimeout(clearParty, 10000);
    },
    clearParty,
  );
});
async function assignArtwork(number: number) {
  species.value = number;
  url.value = "";
  message.value = "";
  editing.value = true;
  await nextTick();
  artworkEditor.value?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}
function artwork(number: number) {
  return (
    props.config.pokemonCrystalMgbaMedia?.find((item) => item.number === number)?.url ?? fallback
  );
}
const url = ref("");
const message = ref("");
const busy = ref(false);
const results = ref<GiphyChoice[]>([]);
const searching = ref(false);
const dragging = ref(false);
let searchGeneration = 0;
const searchDebouncer = getDebouncer();
let searchOffset = 0;
const hasNextBatch = ref(false);
watch(url, () => {
  searchDebouncer.clear();
  searchGeneration++;
  results.value = [];
  searchOffset = 0;
  hasNextBatch.value = false;
  searching.value = false;
  if (url.value.trim() && !/^https?:\/\//i.test(url.value.trim()))
    searchDebouncer.debounce(() => void search(), 400);
});
onBeforeUnmount(() => {
  partyRelay?.close();
  clearParty();
  searchDebouncer.clear();
  searchGeneration++;
});
async function search(nextBatch = false) {
  searchDebouncer.clear();
  const generation = ++searchGeneration;
  searching.value = true;
  message.value = "";
  const operationId = crypto.randomUUID();
  const log = (event: string, resultCount?: number) => {
    void adminFetch(`${endpoint()}/giphy-diagnostics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        operationId,
        ...(resultCount !== undefined ? { count: resultCount } : {}),
      }),
    }).catch(() => {});
  };
  log("started");
  try {
    const offset = nextBatch ? searchOffset + 18 : 0;
    const found = offset
      ? await searchGiphy(url.value.trim(), "stickers", offset)
      : await searchGiphy(url.value.trim(), "stickers");
    if (generation !== searchGeneration) return;
    results.value = found;
    searchOffset = offset;
    hasNextBatch.value = found.length === 18;
    log("completed", found.length);
    if (!found.length) message.value = "No stickers found. Try another Pokémon name.";
  } catch (error) {
    if (generation !== searchGeneration) return;
    message.value = error instanceof Error ? error.message : "Sticker search failed.";
    log("failed");
  } finally {
    if (generation === searchGeneration) searching.value = false;
  }
}
function submit() {
  if (/^https?:\/\//i.test(url.value.trim()))
    void action(() => replace({ number: species.value, url: url.value.trim() }));
  else void search();
}
function drop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) void uploadFile(file);
  else {
    const value =
      event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain");
    if (value) url.value = value.split("\n").find((line) => line && !line.startsWith("#")) ?? "";
  }
}
const endpoint = () => `/api/accounts/${encodeURIComponent(props.config.streamerDid)}`;
async function replace(item: CrystalMedia) {
  const mappings = [
    ...(props.config.pokemonCrystalMgbaMedia ?? []).filter((old) => old.number !== item.number),
    item,
  ].sort((a, b) => a.number - b.number);
  validateCrystalMedia(mappings);
  if (!(await props.save({ ...props.config, pokemonCrystalMgbaMedia: mappings })))
    throw new Error("Could not save mapping. Check the module's save message.");
  message.value = "Artwork saved to your PDS.";
}
async function action(run: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  message.value = "";
  try {
    await run();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Request failed";
  } finally {
    busy.value = false;
  }
}
async function download() {
  await action(async () => {
    const response = await adminFetch(`${endpoint()}/pokemon-crystal-mgba/script`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Could not create your script. Sign in and retry.");
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "streamface-crystal-mgba.lua";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  });
}
async function revoke() {
  await action(async () => {
    const response = await adminFetch(`${endpoint()}/pokemon-crystal-mgba/script`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Could not revoke the script.");
    message.value = "Source revoked. Download a new script to resume.";
  });
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await uploadFile(file);
  input.value = "";
}
async function uploadFile(file: File) {
  await action(async () => {
    const mime =
      file.type ||
      (
        {
          gif: "image/gif",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          avif: "image/avif",
        } as Record<string, string>
      )[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (
      !mime ||
      !["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(mime) ||
      !file.size ||
      file.size > 10000000
    )
      throw new Error("Choose a PNG, JPEG, GIF, WebP or AVIF image up to 10 MB.");
    if (!Number.isInteger(species.value) || species.value < 1 || species.value > 251)
      throw new Error("Choose a species number between 1 and 251.");
    const number = species.value;
    const response = await uploadMedia(props.config.streamerDid, file, mime);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(
        `${result.message ?? "Upload failed"}${result.requestId ? ` Reference: ${result.requestId}` : ""}`,
      );
    }
    await replace({ number, blob: await response.json() });
  });
}
async function remove(number: number) {
  await action(async () => {
    if (
      !(await props.save({
        ...props.config,
        pokemonCrystalMgbaMedia: props.config.pokemonCrystalMgbaMedia?.filter(
          (item) => item.number !== number,
        ),
      }))
    )
      throw new Error("Could not remove mapping.");
    message.value = "Default artwork restored.";
  });
}
</script>
<template>
  <div
    class="crystal-controls editor-fields"
    :class="{ 'module-settings': !panel, 'tabbed-controls': panel }"
  >
    <section
      v-show="!panel || panel === 'script'"
      :inert="panel === 'artwork' || undefined"
      :class="{ 'module-section': !panel }"
    >
      <h4>Live game source</h4>
      <p>
        English Pokémon Crystal (USA/Europe Rev 1), mGBA 0.10+. Download your script and load it
        through mGBA’s Tools → Scripting. No additional installation.
      </p>
      <p>
        Keep the script private. Its URL permits team updates over unencrypted HTTP. Each download
        replaces the previous script.
      </p>
      <div class="crystal-actions">
        <AppButton type="button" :disabled="busy" @click="download"
          >Download private Lua script</AppButton
        >
        <AppButton type="button" :disabled="busy" @click="revoke">Revoke source</AppButton>
      </div>
    </section>
    <section
      v-show="!panel || panel === 'artwork'"
      :inert="panel === 'script' || undefined"
      :class="{ 'module-section': !panel }"
    >
      <h4>Pokémon artwork</h4>
      <p>Assign artwork to your current party. Mappings apply to every Pokémon of that species.</p>
      <div class="party-artwork">
        <div v-for="pokemon in party" :key="pokemon.id" class="party-artwork-card">
          <img
            :src="artwork(pokemon.nationalDexNumber)"
            :alt="pokemon.name"
            @error="($event.target as HTMLImageElement).src = fallback"
          />
          <span>{{ pokemon.name }}</span>
          <AppButton
            type="button"
            :disabled="busy"
            @click="assignArtwork(pokemon.nationalDexNumber)"
            >Assign artwork</AppButton
          >
        </div>
      </div>
      <p v-if="!party.length">Waiting for live party data from mGBA.</p>
      <AppButton v-if="panel && !editing" type="button" @click="editing = true"
        >Choose another species</AppButton
      >
      <div v-show="!panel || editing" ref="artworkEditor">
        <label
          >National Pokédex number<input
            v-model.number="species"
            type="number"
            min="1"
            max="251"
            :disabled="busy"
        /></label>
        <div
          class="artwork-drop"
          :class="{ dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="drop"
        >
          <p>Drop an image here, or choose a file.</p>
          <label
            >Upload image<input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              :disabled="busy"
              @change="upload"
          /></label>
        </div>
        <form class="crystal-actions" @submit.prevent="submit">
          <label
            >Media URL or GIPHY sticker search<input
              v-model="url"
              placeholder="https://… or pikachu"
              :disabled="busy"
          /></label>
          <AppButton
            v-if="/^https?:\/\//i.test(url.trim())"
            class="primary-button success-button"
            type="submit"
            :disabled="busy || !url.trim()"
            >Apply</AppButton
          >
        </form>
        <p v-if="searching" role="status">Searching stickers…</p>
        <div v-if="results.length" class="sticker-results">
          <div v-for="sticker in results" :key="sticker.id">
            <img :src="sticker.preview" :alt="sticker.title" />
            <AppButton
              class="primary-button success-button"
              :disabled="busy"
              @click="action(() => replace({ number: species, url: sticker.url }))"
              type="submit"
              >Apply</AppButton
            >
          </div>
        </div>
        <img
          v-if="results.length || searching"
          :src="giphyAttribution"
          alt="Powered by GIPHY"
          width="200"
        />
        <AppButton
          v-if="hasNextBatch"
          type="button"
          :disabled="busy || searching"
          @click="search(true)"
          >Next batch</AppButton
        >
      </div>
      <ul class="artwork-mappings">
        <li v-for="item in sortedMappings" :key="item.number">
          <span>#{{ item.number }}</span
          ><img v-if="item.url" :src="item.url" alt="Mapped Pokémon artwork" /><AppButton
            type="button"
            :disabled="busy"
            @click="remove(item.number)"
            >Remove</AppButton
          >
        </li>
      </ul>
    </section>
    <p role="status">{{ message }}</p>
  </div>
</template>
<style scoped>
.party-artwork {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-block: 20px;
}
.party-artwork-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.party-artwork-card img {
  width: 100px;
  height: 100px;
  object-fit: contain;
}
.crystal-controls {
  margin-top: 32px;
}
.crystal-controls.tabbed-controls {
  margin-top: 0;
}
.crystal-controls.tabbed-controls section > h4:first-child {
  margin-top: 0;
}
.crystal-controls.tabbed-controls section + section {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.crystal-controls section + section {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-color, #ffffff30);
}
.artwork-drop {
  margin-block: 16px;
  padding: 20px;
  border: 2px dashed var(--border-color, #ffffff50);
  border-radius: 12px;
}
.artwork-drop.dragging {
  border-color: #62bf73;
}
.sticker-results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 12px;
  margin-block: 16px;
}
.sticker-results > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.sticker-results img {
  width: 100px;
  height: 100px;
  object-fit: contain;
}
.crystal-actions,
li {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.crystal-actions > label {
  flex: 1;
  min-width: 180px;
}
.crystal-controls input[type="number"] {
  max-width: 9ch;
}
form.crystal-actions {
  margin-block: 16px;
}
.crystal-actions > button {
  align-self: end;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  margin-block: 12px;
}
li img {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
.artwork-mappings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 16px;
}
.artwork-mappings li {
  flex-direction: column;
  gap: 4px;
  margin: 0;
}
#app .artwork-mappings button {
  font-size: 0.8em;
  padding: 5px 10px;
  min-height: 0;
}
</style>
