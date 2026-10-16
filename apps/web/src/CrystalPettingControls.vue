<script setup lang="ts">
import AppButton from "./AppButton.vue";
import { ref, onMounted, watch } from "vue";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { adminFetch } from "./cloud-admin-fetch.ts";
import DeleteConfirmation from "./DeleteConfirmation.vue";
const props = defineProps<{
  config: CloudConfig;
  save: (config: CloudConfig) => Promise<boolean>;
}>();
const interval = ref(props.config.pokemonCrystalMgbaThoughtIntervalSeconds ?? 120);
watch(
  () => props.config.pokemonCrystalMgbaThoughtIntervalSeconds,
  (value) => {
    interval.value = value ?? 120;
  },
);
const counts = ref<{ pokemonId: string; petterDid: string; count: number }[]>([]);
const deleting = ref<{ item?: (typeof counts.value)[number] }>();
const busy = ref(false),
  status = ref("");
const endpoint = () =>
  `/api/accounts/${encodeURIComponent(props.config.streamerDid)}/pokemon-crystal-mgba/pet-counts`;
async function load() {
  const response = await adminFetch(endpoint());
  if (!response.ok) throw new Error("Could not load pet history.");
  counts.value = await response.json();
}
onMounted(() => {
  void load().catch((error) => {
    status.value = error.message;
  });
});
async function saveInterval() {
  if (!Number.isInteger(interval.value) || interval.value < 1 || interval.value > 86400) {
    status.value = "Enter between 1 and 86400 seconds.";
    return;
  }
  busy.value = true;
  try {
    status.value = (await props.save({
      ...props.config,
      pokemonCrystalMgbaThoughtIntervalSeconds: interval.value,
    }))
      ? "Thought interval saved."
      : "Could not save interval.";
  } finally {
    busy.value = false;
  }
}
async function remove(item?: (typeof counts.value)[number]) {
  if (busy.value) return;
  if (props.config.preferences?.confirmDeletion !== false) {
    deleting.value = { item };
    return;
  }
  await deleteConfirmed(item);
}
async function deleteConfirmed(item?: (typeof counts.value)[number], dontShowAgain = false) {
  busy.value = true;
  status.value = "";
  try {
    if (
      dontShowAgain &&
      !(await props.save({
        ...props.config,
        preferences: { ...props.config.preferences, confirmDeletion: false },
      }))
    )
      throw new Error("Could not save your confirmation preference.");
    const response = await adminFetch(endpoint(), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        item ? { pokemonId: item.pokemonId, petterDid: item.petterDid } : { all: true },
      ),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "Could not remove pet history.");
    deleting.value = undefined;
    await load();
    status.value = "Pet history removed.";
  } catch (error) {
    status.value = error instanceof Error ? error.message : "Could not remove pet history.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="editor-fields">
    <DeleteConfirmation
      v-if="deleting"
      :name="deleting.item ? 'this saved pet count' : 'all saved pet counts'"
      :busy="busy"
      description="This removes the selected pet history from your PDS. It cannot be undone. Artwork mappings are unchanged."
      @cancel="deleting = undefined"
      @confirm="deleteConfirmed(deleting?.item, $event)"
    />
    <form @submit.prevent="saveInterval">
      <label
        >Thought bubble rotation interval (seconds)<input
          v-model.number="interval"
          type="number"
          min="1"
          max="86400"
          :disabled="busy"
      /></label>
      <p>
        Rotates through the party, showing each Pokémon’s favourite petter. Default: 120 seconds.
      </p>
      <AppButton type="submit" class="success-button" :disabled="busy">Save interval</AppButton>
    </form>
    <h4>Saved pet counts</h4>
    <p v-if="!counts.length">No saved pet counts.</p>
    <ul>
      <li v-for="item in counts" :key="`${item.pokemonId}:${item.petterDid}`">
        <span>Pokémon {{ item.pokemonId }} · {{ item.petterDid }} · {{ item.count }} pets</span
        ><AppButton type="button" class="danger-button" :disabled="busy" @click="remove(item)"
          >Remove</AppButton
        >
      </li>
    </ul>
    <AppButton
      v-if="counts.length"
      type="button"
      class="danger-button"
      :disabled="busy"
      @click="remove()"
      >Reset all pet counts</AppButton
    >
    <p role="status">{{ status }}</p>
  </div>
</template>
<style scoped>
form input {
  max-width: 130px;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-block: 12px;
}
li span {
  overflow-wrap: anywhere;
}
</style>
