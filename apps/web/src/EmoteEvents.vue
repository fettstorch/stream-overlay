<script setup lang="ts">
import { ref, watch } from "vue";
import { emoteEvents, type EmoteEventMapping, type EmoteEventType } from "../../../modules/emoticons/src/events.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
const props = defineProps<{ config: CloudConfig; save: (config: CloudConfig) => Promise<boolean> }>();
const choices = ref<Partial<Record<EmoteEventType, string>>>({});
const busy = ref(false), message = ref("");
watch(() => props.config.eventMappings, mappings => {
  choices.value = Object.fromEntries(emoteEvents.map(event => [event.id, mappings?.find(mapping => mapping.event === event.id)?.commandId ?? ""]));
}, { immediate: true, deep: true });
async function save() {
  busy.value = true; message.value = "";
  try {
    const eventMappings: EmoteEventMapping[] = emoteEvents.flatMap(event => choices.value[event.id]
      ? [{ event: event.id, commandId: choices.value[event.id]! }] : []);
    if (await props.save({ ...props.config, eventMappings })) message.value = "Event mappings saved.";
  } catch { message.value = "Could not save event mappings."; }
  finally { busy.value = false; }
}
</script>
<template>
  <form class="editor-fields emote-events" @submit.prevent="save">
    <p>Choose an Emote command to play when Streamplace sends an event. The Emotes browser source must be connected. Clip cooldowns still apply; chat roles and user restrictions do not apply to these automatic events.</p>
    <label v-for="event in emoteEvents" :key="event.id">
      <strong>{{ event.name }}</strong><small>{{ event.description }}</small>
      <span class="drawn-select">
        <select v-model="choices[event.id]" :aria-label="event.name" :disabled="busy">
          <option value="">No action</option>
          <option v-for="command in config.commands" :key="command.id" :value="command.id">!{{ command.command }}</option>
        </select>
      </span>
    </label>
    <button type="submit" :disabled="busy">{{ busy ? 'Saving…' : 'Save events' }}</button>
    <p v-if="message" role="status">{{ message }}</p>
  </form>
</template>
<style scoped>
.emote-events { display: grid; gap: 18px; }
.emote-events > button { justify-self: start; }
</style>
