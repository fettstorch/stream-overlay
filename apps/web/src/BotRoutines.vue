<script setup lang="ts">
import { ref } from "vue";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { validateBotSettings, type BotRoutine } from "../../../modules/bot/src/config.ts";
const props = defineProps<{ config: CloudConfig; save: (config: CloudConfig) => Promise<boolean> }>();
const text = ref(""), minutes = ref(5), editing = ref<string>(), busy = ref(false), status = ref("");
function reset() { text.value = ""; minutes.value = 5; editing.value = undefined; }
function edit(item: BotRoutine) { editing.value = item.id; text.value = item.response; minutes.value = item.intervalSeconds / 60; }
async function persist(routines: BotRoutine[], resetEditor = false) {
  busy.value = true; status.value = "";
  try {
    const bot = { ...props.config.bot, enabled: props.config.bot?.enabled ?? false, rules: props.config.bot?.rules ?? [], routines };
    validateBotSettings(bot);
    if (await props.save({ ...props.config, bot })) {
      status.value = "Routines saved.";
      if (resetEditor) reset();
    }
  } catch (error) { status.value = error instanceof Error ? error.message : "Could not save routines."; }
  finally { busy.value = false; }
}
async function add() {
  const existing = props.config.bot?.routines?.find(item => item.id === editing.value);
  await persist([...(props.config.bot?.routines ?? []).filter(item => item.id !== editing.value), {
    id: editing.value ?? crypto.randomUUID(), response: text.value.trim(), intervalSeconds: minutes.value * 60,
    enabled: existing?.enabled ?? true,
  }], true);
}
</script>
<template>
  <section class="module-section routines">
    <p>Post recurring messages while your Bot browser source is running. The first post happens after one full interval; missed posts are not replayed.</p>
    <ul class="command-list striped-list">
      <li v-for="item in config.bot?.routines ?? []" :key="item.id" class="routine-row">
        <div class="routine-copy"><strong>Every {{ item.intervalSeconds / 60 }} {{ item.intervalSeconds === 60 ? 'minute' : 'minutes' }}</strong><p>{{ item.response }}</p></div>
        <label class="switch">
          <input type="checkbox" role="switch" :aria-label="`Enable routine: ${item.response}`" :checked="item.enabled" :disabled="busy"
            @change="persist((config.bot?.routines ?? []).map(rule => rule.id === item.id ? { ...rule, enabled: ($event.target as HTMLInputElement).checked } : rule))" />
          <span aria-hidden="true" />
        </label>
        <button :disabled="busy" @click="edit(item)">Edit</button>
        <button :disabled="busy" @click="persist((config.bot?.routines ?? []).filter(rule => rule.id !== item.id))">Remove</button>
      </li>
    </ul>
    <p v-if="!config.bot?.routines?.length">No routines yet.</p>
    <form class="editor-fields routine-editor" @submit.prevent="add">
      <h4>{{ editing ? 'Edit routine' : 'New routine' }}</h4>
      <label>Bot message<textarea v-model="text" maxlength="250" required :disabled="busy" placeholder="Remember to follow the stream…" /></label>
      <label>Every (minutes)<input v-model.number="minutes" type="number" min="0.5" max="1440" step="any" required :disabled="busy" /></label>
      <div><button type="submit" :disabled="busy">{{ busy ? 'Saving…' : 'Save routine' }}</button> <button type="button" :disabled="busy" @click="reset">Cancel</button></div>
    </form>
    <p v-if="status" role="status">{{ status }}</p>
  </section>
</template>
<style scoped>
#app .routines { margin: 0; padding: 0; }
#app .routines::before { display: none; }
.routine-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.routine-copy { flex: 1; min-width: 160px; }
.routine-copy p { margin: 0.3rem 0; overflow-wrap: anywhere; }
.routine-row .switch { flex: 0 0 auto; }
.routine-editor { display: grid; gap: 12px; margin-top: 24px; }
.routine-editor textarea { width: 100%; min-height: 90px; padding: 11px 12px; border: 1px solid #777; border-radius: 8px; color: #171717; background: #fff; font: inherit; resize: vertical; }
.routine-editor textarea:focus-visible { outline: 2px solid #526baf; outline-offset: 2px; }
</style>
