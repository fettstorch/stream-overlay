<script setup lang="ts">
import { ref, watch } from "vue";
import CollapsibleSection from "./CollapsibleSection.vue";
import { emoteEvents, type EmoteEventMapping, type EmoteEventType } from "../../../modules/emoticons/src/events.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
const props = defineProps<{ config: CloudConfig; save: (config: CloudConfig) => Promise<boolean> }>();
const choices = ref<Partial<Record<EmoteEventType, string>>>({});
const texts = ref<Partial<Record<EmoteEventType, string>>>({});
const busy = ref(false), message = ref("");
watch(() => props.config.eventMappings, mappings => {
  choices.value = Object.fromEntries(emoteEvents.map(event => [event.id, mappings?.find(mapping => mapping.event === event.id)?.commandId ?? ""]));
  texts.value = Object.fromEntries(emoteEvents.map(event => [event.id, mappings?.find(mapping => mapping.event === event.id)?.text ?? ""]));
}, { immediate: true, deep: true });
async function save() {
  busy.value = true; message.value = "";
  try {
    const eventMappings: EmoteEventMapping[] = emoteEvents.flatMap(event => props.config.commands.some(command => command.id === choices.value[event.id] && command.mode === "effect")
      ? [{ event: event.id, commandId: choices.value[event.id]!, ...(texts.value[event.id]?.trim() ? { text: texts.value[event.id]!.trim() } : {}) }] : []);
    if (await props.save({ ...props.config, eventMappings })) message.value = "Event mappings saved.";
  } catch { message.value = "Could not save event mappings."; }
  finally { busy.value = false; }
}
</script>
<template>
  <form class="editor-fields emote-events" @submit.prevent="save">
    <p>Choose a clip command to play when Streamplace sends an event. The Emotes browser source must be connected. Clip cooldowns still apply; chat roles and user restrictions do not apply to these automatic events.</p>
    <CollapsibleSection v-for="event in emoteEvents" :key="event.id" class="event-reaction" :title="event.name">
      <div class="event-fields">
      <p>{{ event.description }}</p>
      <label>
      Clip command
      <span class="drawn-select">
        <select v-model="choices[event.id]" :aria-label="event.name" :disabled="busy">
          <option value="">No action</option>
          <option v-for="command in config.commands.filter(command => command.mode === 'effect')" :key="command.id" :value="command.id">!{{ command.command }}</option>
        </select>
      </span>
      </label>
      <label>Text beneath the clip (optional)
        <input v-model="texts[event.id]" :aria-label="`${event.name} text`" maxlength="500" :disabled="busy" placeholder="Your event message">
      </label>
      </div>
    </CollapsibleSection>
    <button type="submit" :disabled="busy">{{ busy ? 'Saving…' : 'Save events' }}</button>
    <p v-if="message" role="status">{{ message }}</p>
  </form>
</template>
<style scoped>
.emote-events { display: grid; gap: 28px; }
.emote-events > button { justify-self: start; }
.event-reaction { margin-block: 0; }
.event-fields { display: grid; gap: 18px; padding-top: 6px; }
.event-fields > p { margin: 0; }
:global(#app) .emote-events :deep(.event-reaction .section-heading h4) { font-size: 1.5rem; font-weight: 800; line-height: 1.2; }
</style>
