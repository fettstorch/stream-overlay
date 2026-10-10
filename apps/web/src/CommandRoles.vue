<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { attachActorCombobox, type ActorSuggestion } from "./actor-combobox.ts";
import { searchPublicActors, resolvePublicActor, loadPublicActorProfile, type PublicActorProfile } from "./actor-search.ts";
import { openCommandRoles, rolesRestricted, validateCommandRoles, type CommandRoles } from "../../../modules/emoticons/src/roles.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
const props = defineProps<{ config: CloudConfig; save: (config: CloudConfig) => Promise<boolean> }>();
function copyRoles(value?: CommandRoles): CommandRoles {
  const source = value ?? openCommandRoles;
  return { ...source, users: source.users.map(user => ({ ...user })) };
}
const roles = ref<CommandRoles>(copyRoles(props.config.roles));
const query = ref(""), selected = ref<ActorSuggestion>(), input = ref<HTMLInputElement>(), searchStatus = ref<HTMLElement>();
const busy = ref(false), message = ref("");
const profiles = ref<Record<string, PublicActorProfile | null>>({});
let autocomplete: ReturnType<typeof attachActorCombobox> | undefined, disposed = false;
watch(() => props.config.roles, value => { roles.value = copyRoles(value); }, { deep: true });
watch(() => roles.value.users.map(user => user.did), dids => {
  for (const did of dids) if (!(did in profiles.value)) {
    profiles.value[did] = null;
    void loadPublicActorProfile(did).then(profile => { if (!disposed) profiles.value[did] = profile; }).catch(() => {});
  }
}, { immediate: true });
onMounted(() => {
  if (input.value && searchStatus.value) autocomplete = attachActorCombobox({ input: input.value, status: searchStatus.value,
    searcher: searchPublicActors, purpose: "moderation", onSelect: actor => { selected.value = actor; query.value = actor.handle; } });
});
onBeforeUnmount(() => { disposed = true; autocomplete?.dispose(); });
async function addUser() {
  if (busy.value || !query.value.trim()) return;
  busy.value = true; message.value = "";
  try {
    const actor = selected.value ?? await resolvePublicActor(query.value);
    const candidate = copyRoles(roles.value);
    if (!candidate.users.some(user => user.did === actor.did)) candidate.users.push({ did: actor.did, ...(actor.handle ? { handle: actor.handle } : {}) });
    validateCommandRoles(candidate);
    roles.value = candidate;
    query.value = ""; selected.value = undefined; autocomplete?.close();
    if (searchStatus.value) searchStatus.value.textContent = "";
  } catch (error) { message.value = error instanceof Error ? error.message : "Could not resolve this account."; }
  finally { busy.value = false; }
}
async function saveRoles() {
  if (busy.value) return;
  busy.value = true; message.value = "";
  try {
    validateCommandRoles(roles.value);
    const candidate: CommandRoles = { ...roles.value, users: roles.value.users.map(user => ({ ...user })) };
    if (await props.save({ ...props.config, roles: candidate })) message.value = "Command roles saved.";
  } catch (error) { message.value = error instanceof Error ? error.message : "Could not save command roles."; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="command-roles editor-fields">
    <p>Allow users who match any selected role or account. These roles apply to all commands in this module. Restrictions still take priority.</p>
    <label class="role-choice"><input v-model="roles.followers" type="checkbox" :disabled="busy" />Followers <small>People who follow you.</small></label>
    <label class="role-choice"><input v-model="roles.mutuals" type="checkbox" :disabled="busy" />Mutuals <small>You follow each other.</small></label>
    <label class="role-choice"><input v-model="roles.moderators" type="checkbox" :disabled="busy" />Streamplace moderators <small>Recognized by Streamplace's server-controlled chat badge.</small></label>
    <ul v-if="roles.users.length" class="module-section command-list striped-list allowed-users">
      <li v-for="user in roles.users" :key="user.did">
        <img v-if="profiles[user.did]?.avatar" :src="profiles[user.did]!.avatar" alt="" @error="profiles[user.did]!.avatar = ''" />
        <span v-else class="avatar-placeholder" role="img" aria-label="Profile picture unavailable" />
        <strong>{{ profiles[user.did]?.handle ? `@${profiles[user.did]!.handle}` : user.handle ? `@${user.handle}` : user.did }}</strong>
        <button type="button" :disabled="busy" @click="roles.users = roles.users.filter(item => item.did !== user.did)">Remove</button>
      </li>
    </ul>
    <label class="role-search">Specific user
      <input ref="input" v-model="query" placeholder="Add @handle" :disabled="busy" autocomplete="off" @input="selected = undefined" @keydown.enter.prevent="addUser" />
    </label>
    <span ref="searchStatus" role="status" class="settings-hint" />
    <button type="button" :disabled="busy || !query.trim()" @click="addUser">Add user</button>
    <p class="settings-hint">{{ rolesRestricted(roles) ? 'Only matching users will be allowed. If a relationship lookup fails, access is denied.' : 'No roles selected: everyone can use commands, subject to restrictions.' }} Changes take effect after saving.</p>
    <button type="button" :disabled="busy" @click="saveRoles">{{ busy ? 'Saving…' : 'Save roles' }}</button>
    <p v-if="message" role="status">{{ message }}</p>
  </div>
</template>
<style scoped>
.command-roles { display: grid; gap: 12px; min-width: 0; }
#app .role-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.role-choice small { font-weight: 400; }
.role-search { position: relative; }
.allowed-users strong { overflow-wrap: anywhere; min-width: 0; }
.allowed-users img, .allowed-users .avatar-placeholder { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 50%; object-fit: cover; }
.command-roles > button { justify-self: start; }
</style>
