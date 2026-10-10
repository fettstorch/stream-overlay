<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { attachActorCombobox, type ActorSuggestion } from "./actor-combobox.ts";
import { searchPublicActors, resolvePublicActor } from "./actor-search.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
import type { EmoticonModerationRule } from "../../../modules/emoticons/src/cloud-contracts.ts";
import { validateModeration } from "../../../modules/emoticons/src/moderation.ts";

const props = defineProps<{ config: CloudConfig; save: (config: CloudConfig) => Promise<boolean> }>();
const input = ref<HTMLInputElement>(), searchStatus = ref<HTMLElement>();
const query = ref(""), selected = ref<ActorSuggestion>(), blocked = ref(false), cooldown = ref(30);
const busy = ref(false), message = ref("");
let autocomplete: ReturnType<typeof attachActorCombobox> | undefined;
onMounted(() => {
  if (input.value && searchStatus.value) autocomplete = attachActorCombobox({
    input: input.value, status: searchStatus.value, searcher: searchPublicActors, purpose: "moderation",
    onSelect: actor => { selected.value = actor; query.value = actor.handle; },
  });
});
onBeforeUnmount(() => autocomplete?.dispose());
function reset() {
  query.value = ""; selected.value = undefined; blocked.value = false; cooldown.value = 30;
  autocomplete?.close();
  if (searchStatus.value) searchStatus.value.textContent = "";
}
function edit(rule: EmoticonModerationRule) {
  query.value = rule.handle || rule.did;
  selected.value = { did: rule.did, handle: rule.handle ?? "", displayName: "", avatar: "" };
  blocked.value = rule.blocked; cooldown.value = rule.cooldownSeconds; message.value = "";
}
async function saveRule() {
  if (busy.value) return;
  busy.value = true; message.value = "";
  try {
    const actor = selected.value ?? await resolvePublicActor(query.value);
    const rule: EmoticonModerationRule = { did: actor.did, blocked: blocked.value, cooldownSeconds: cooldown.value,
      ...(actor.handle ? { handle: actor.handle } : {}) };
    const moderation = [...(props.config.moderation ?? []).filter(item => item.did !== actor.did), rule];
    validateModeration(moderation);
    if (await props.save({ ...props.config, moderation })) { reset(); message.value = "Moderation rule saved."; }
  } catch (error) { message.value = error instanceof Error ? error.message : "Could not resolve this account."; }
  finally { busy.value = false; }
}
async function remove(rule: EmoticonModerationRule) {
  if (busy.value) return;
  busy.value = true; message.value = "";
  try {
    if (await props.save({ ...props.config, moderation: (props.config.moderation ?? []).filter(item => item.did !== rule.did) })) {
      if (selected.value?.did === rule.did) reset();
      message.value = "Moderation rule removed. This user can use commands normally again.";
    }
  } finally { busy.value = false; }
}
</script>
<template>
  <div class="emoticon-moderation">
    <h4>Moderation</h4>
    <p>Block a chat user from all commands, or give them one shared cooldown across clips and stickers. Admin tests are unaffected.</p>
    <p class="settings-hint">These rules are stored on your PDS and are public, like your other overlay settings.</p>
    <ul v-if="config.moderation?.length" class="module-section command-list striped-list moderation-list">
      <li v-for="rule in config.moderation" :key="rule.did">
        <div><strong>{{ rule.handle ? `@${rule.handle}` : rule.did }}</strong>
          <small>{{ rule.blocked ? 'Blocked from all commands' : `${rule.cooldownSeconds}s shared cooldown` }}</small></div>
        <button type="button" :disabled="busy" @click="edit(rule)">Edit</button>
        <button type="button" :disabled="busy" @click="remove(rule)">Remove</button>
      </li>
    </ul>
    <p v-else>No user-specific restrictions yet.</p>
    <form class="module-section moderation-editor" @submit.prevent="saveRule">
      <h4>{{ selected && config.moderation?.some(rule => rule.did === selected?.did) ? 'Edit user rule' : 'Add user rule' }}</h4>
      <label class="moderation-search">Chat user's handle
        <input ref="input" v-model="query" placeholder="@handle" required :disabled="busy" autocomplete="off"
          @input="selected = undefined" />
      </label>
      <span ref="searchStatus" role="status" class="settings-hint" />
      <div class="moderation-block"><strong>Block all commands</strong><label class="switch">
        <input v-model="blocked" type="checkbox" role="switch" aria-label="Block all commands" :disabled="busy" /><span aria-hidden="true" />
      </label></div>
      <label v-if="!blocked">Shared cooldown (seconds)
        <input v-model.number="cooldown" type="number" min="0" max="86400" step="0.1" required :disabled="busy" />
      </label>
      <p v-if="!blocked" class="settings-hint">After an accepted command, this user must wait before triggering any other command. Rejected attempts don't restart the timer.</p>
      <div class="form-actions"><button type="submit" :disabled="busy || !query.trim()">{{ busy ? 'Saving…' : 'Save rule' }}</button>
        <button type="button" :disabled="busy" @click="reset">Reset</button></div>
    </form>
    <p v-if="message" role="status">{{ message }}</p>
  </div>
</template>
<style scoped>
.emoticon-moderation { min-width: 0; }
.moderation-list li { display: flex; align-items: center; gap: 8px; }
.moderation-list li > div { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.moderation-list small { display: block; }
.moderation-editor { display: grid; gap: 12px; margin-top: 24px; }
.moderation-editor label { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.moderation-search { position: relative; }
.moderation-search input { flex: 1; min-width: 150px; }
.moderation-editor input:not([type="checkbox"]) { min-width: 0; padding: 11px 12px; border: 1px solid #777; border-radius: 8px; font: inherit; }
.moderation-editor input[type="number"] { width: 7ch; }
.moderation-editor label { font-weight: 700; }
.moderation-block { display: flex; align-items: center; gap: 12px; }
.moderation-list button { font-size: .9em; }
</style>
