<script setup lang="ts">
import AppButton from "./AppButton.vue";
import { computed, onMounted, onBeforeUnmount, ref, toRaw, watch } from "vue";
import { attachActorCombobox } from "./actor-combobox.ts";
import { resolvePublicActor, searchPublicActors } from "./actor-search.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { mergeSetup, copySetupMedia, setupJavaScriptModules } from "./setup-import.ts";
import { adminFetch } from "./cloud-admin-fetch.ts";
const props = defineProps<{
  did: string;
  config: CloudConfig;
  save: (config: CloudConfig) => Promise<boolean>;
}>();
const handle = ref(""),
  busy = ref(false),
  message = ref("");
const source = ref<CloudConfig>(),
  sourceHandle = ref("");
const trustedSource = ref(false);
const javaScriptModules = computed(() =>
  source.value ? setupJavaScriptModules(source.value) : [],
);
watch(source, () => {
  trustedSource.value = false;
});
const input = ref<HTMLInputElement>(),
  status = ref<HTMLElement>();
let detach: ReturnType<typeof attachActorCombobox> | undefined;
onMounted(() => {
  if (input.value && status.value)
    detach = attachActorCombobox({
      input: input.value,
      status: status.value,
      searcher: searchPublicActors,
      purpose: "moderation",
      onSelect: (actor) => {
        handle.value = actor.handle;
        source.value = undefined;
      },
    });
});
onBeforeUnmount(() => detach?.dispose());
async function load(value = handle.value) {
  busy.value = true;
  source.value = undefined;
  message.value = "Loading setup…";
  try {
    const actor = await resolvePublicActor(value.trim().replace(/^@/, ""));
    if (actor.did === props.did) throw new Error("This is already your own setup.");
    const response = await adminFetch(
      `/api/accounts/${encodeURIComponent(actor.did)}/config?refresh=1`,
    );
    if (!response.ok) throw new Error("No readable Streamface setup was found for this account.");
    const config = (await response.json()) as CloudConfig;
    mergeSetup(toRaw(props.config), config); // Check limits before offering an import.
    source.value = config;
    sourceHandle.value = actor.handle;
    message.value = "";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Could not load this setup.";
  } finally {
    busy.value = false;
  }
}
async function apply() {
  if (!source.value || busy.value || (javaScriptModules.value.length && !trustedSource.value))
    return;
  busy.value = true;
  message.value = "Copying media to your PDS…";
  try {
    const revision = props.config.revision;
    const imported = await copySetupMedia(toRaw(source.value), props.did);
    if (props.config.revision !== revision)
      throw new Error("Your setup changed while copying media. Review the import again.");
    const candidate = mergeSetup(toRaw(props.config), imported);
    if (!(await props.save(candidate)))
      throw new Error("Import was not saved. Your last saved setup remains active.");
    source.value = undefined;
    message.value = "Setup imported.";
  } catch (error) {
    message.value =
      error instanceof Error
        ? error.message
        : "Import failed. Your last saved setup remains active.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="setup-import editor-fields">
    <p>
      Copy another account's public Streamface setup, or start with @fettstorch.dev's setup, and
      make changes to your liking.
    </p>
    <AppButton class="atproto-button" type="button" :disabled="busy" @click="load('fettstorch.dev')"
      >Use @fettstorch.dev as a base</AppButton
    >
    <form @submit.prevent="load()">
      <label class="actor-search-field"
        >Account to copy from
        <input
          ref="input"
          v-model="handle"
          :disabled="busy"
          placeholder="handle.example"
          @input="source = undefined"
        />
      </label>
      <small ref="status" role="status" />
      <AppButton type="submit" :disabled="busy || !handle.trim()">Review setup</AppButton>
    </form>
    <div v-if="source" class="import-review">
      <strong>Import @{{ sourceHandle }}</strong>
      <p>
        {{ source.commands.length }} Emote commands, {{ source.bot?.rules.length ?? 0 }} bot
        commands, {{ source.bot?.routines?.length ?? 0 }} routines.
      </p>
      <p>
        Matching command names and routine IDs will be replaced; unrelated commands and routines
        stay. Module settings, event mappings, roles and restrictions will be replaced with this
        account's settings. Review copied restrictions for your audience. Enabled bot routines may
        start posting immediately if your Bot source is connected.
      </p>
      <p>
        Your account, OBS URLs and deletion-confirmation preference stay unchanged. Uploaded media
        is copied to your PDS; external media links remain links.
      </p>
      <div v-if="javaScriptModules.length" class="javascript-warning" role="alert">
        <p>
          This setup contains custom JavaScript or ZIP apps in: {{ javaScriptModules.join(", ") }}.
          This code will run in your overlay and its previews. Only continue if you trust @{{
            sourceHandle
          }}.
        </p>
        <label
          ><input v-model="trustedSource" type="checkbox" :disabled="busy" /> I trust @{{
            sourceHandle
          }}
          and want to copy their JavaScript.</label
        >
      </div>
      <AppButton
        class="success-button"
        type="button"
        :disabled="busy || (javaScriptModules.length > 0 && !trustedSource)"
        @click="apply"
        >Confirm import</AppButton
      >
      <AppButton class="danger-button" type="button" :disabled="busy" @click="source = undefined"
        >Cancel</AppButton
      >
    </div>
    <p v-if="message" role="status">{{ message }}</p>
  </div>
</template>
<style scoped>
.setup-import,
.setup-import form {
  display: grid;
  gap: 14px;
}
.setup-import button {
  justify-self: start;
}
.actor-search-field {
  position: relative;
}
.import-review {
  display: grid;
  gap: 12px;
}
.import-review p {
  margin: 0;
}
</style>
