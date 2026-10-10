<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import DrawnTabs from "./DrawnTabs.vue";
import EmoticonModeration from "./EmoticonModeration.vue";
import { adminFetch } from "./cloud-admin-fetch.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { validateBotSettings, type BotRule } from "../../../modules/bot/src/config.ts";
const props = defineProps<{
  config: CloudConfig;
  save: (config: CloudConfig) => Promise<boolean>;
}>();
const sourceUrl = ref(""),
  configured = ref(false),
  busy = ref(false),
  message = ref("");
const command = ref(""),
  response = ref(""),
  cooldown = ref(30),
  editing = ref<string>();
const tab = ref("commands");
const chatUrl = computed(() => `https://stream.place/chat-popout/${encodeURIComponent(props.config.streamerDid)}`);
const tabs = [
  { id: "commands", label: "Commands" },
  { id: "create", label: "Create new" },
  { id: "moderation", label: "Moderation" },
];
const moderationConfig = computed(() => ({
  ...props.config,
  moderation: props.config.bot?.moderation ?? [],
  roles: props.config.bot?.roles,
}));
async function saveModeration(candidate: CloudConfig) {
  return props.save({
    ...props.config,
    bot: {
      enabled: props.config.bot?.enabled ?? false,
      rules: props.config.bot?.rules ?? [],
      moderation: candidate.moderation ?? [],
      ...(candidate.roles !== undefined ? { roles: candidate.roles } : {}),
    },
  });
}
onMounted(async () => {
  try {
    const result = await adminFetch(
      `/api/accounts/${encodeURIComponent(props.config.streamerDid)}/bot/source`,
    );
    if (!result.ok) throw new Error();
    const data = await result.json();
    sourceUrl.value = data.url;
    configured.value = data.configured;
  } catch {
    message.value = "Could not load the private Bot browser source URL.";
  }
});
function reset() {
  command.value = "";
  response.value = "";
  cooldown.value = 30;
  editing.value = undefined;
}
function edit(rule: BotRule) {
  tab.value = "create";
  editing.value = rule.command;
  command.value = rule.command;
  response.value = rule.response;
  cooldown.value = rule.cooldownSeconds;
}
async function persist(rules: BotRule[]) {
  busy.value = true;
  message.value = "";
  try {
    const bot = { ...props.config.bot, enabled: props.config.bot?.enabled ?? false, rules };
    validateBotSettings(bot);
    const saved = await props.save({ ...props.config, bot });
    if (saved) {
      reset();
      message.value = "Bot rules saved.";
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Could not save bot rules.";
  } finally {
    busy.value = false;
  }
}
async function add() {
  const name = command.value.trim().replace(/^!/, "").toLowerCase();
  const rules = [
    ...(props.config.bot?.rules ?? []).filter((rule) => rule.command !== editing.value),
    { command: name, response: response.value.trim(), cooldownSeconds: cooldown.value },
  ];
  await persist(rules);
}
async function copy() {
  try {
    await navigator.clipboard.writeText(sourceUrl.value);
    message.value = "Private OBS URL copied.";
  } catch {
    message.value = "Could not copy the URL.";
  }
}
</script>
<template>
  <section class="module-section">
    <h4>Bot OBS URL</h4>
    <p>
      Keep this transparent browser source running in OBS. Any size works. Disable “Shutdown source
      when not visible” if replies should continue when switching scenes.
    </p>
    <p>
      Keep the URL private — it authorizes this stream's bot source. Rules and reply texts are
      public PDS data.
    </p>
    <p v-if="!configured" role="status">
      The server's Streamface bot account is not configured yet.
    </p>
    <button :disabled="!sourceUrl" @click="copy">Copy private OBS URL</button>
  </section>
  <DrawnTabs v-model="tab" :tabs="tabs" label="Bot commands">
    <section v-show="tab === 'commands'" class="module-section bot-tab-content">
      <div class="bot-commands-layout">
      <div class="bot-chat">
        <iframe v-if="tab === 'commands'" :src="chatUrl" title="Your Streamplace chat" referrerpolicy="no-referrer" />
        <p class="settings-hint">Type commands in your chat to test real bot replies. Normal roles, restrictions and cooldowns apply.</p>
        <p v-if="!config.bot?.enabled" class="settings-hint">Enable the Bot module to respond to commands here.</p>
        <iframe v-if="tab === 'commands' && sourceUrl && configured && config.bot?.enabled"
          :src="sourceUrl" title="Bot chat listener" hidden aria-hidden="true" tabindex="-1" referrerpolicy="no-referrer" />
      </div>
      <div>
      <ul class="command-list striped-list">
        <li v-for="rule in config.bot?.rules ?? []" :key="rule.command" class="bot-rule">
          <div>
            <strong>!{{ rule.command }}</strong>
            <p>{{ rule.response }}</p>
            <small>{{ rule.cooldownSeconds }}s cooldown</small>
          </div>
          <button :disabled="busy" @click="edit(rule)">Edit</button>
          <button
            :disabled="busy"
            @click="
              persist((config.bot?.rules ?? []).filter((item) => item.command !== rule.command))
            "
          >
            Remove
          </button>
        </li>
      </ul>
      <p v-if="!config.bot?.rules.length">No bot commands yet.</p>
      </div>
      </div>
    </section>
    <form v-show="tab === 'create'" class="module-section bot-tab-content editor-fields" @submit.prevent="add">
      <h4 v-if="editing">Edit command</h4>
      <label
        >Command<input
          v-model="command"
          placeholder="!discord"
          maxlength="41"
          required
          :disabled="busy"
      /></label>
      <label
        >Bot reply<input
          v-model="response"
          placeholder="Join our Discord…"
          maxlength="250"
          required
          :disabled="busy"
      /></label>
      <label
        >Cooldown (seconds)<input
          v-model.number="cooldown"
          type="number"
          min="5"
          max="86400"
          step="1"
          required
          :disabled="busy"
      /></label>
      <p>
        The cooldown is shared by everyone using this command. Streamface ignores its own messages.
      </p>
      <button type="submit" :disabled="busy">{{ busy ? "Saving…" : "Save command" }}</button>
      <button type="button" :disabled="busy" @click="reset">Cancel</button>
    </form>
    <EmoticonModeration
      v-if="tab === 'moderation'"
      :config="moderationConfig"
      :save="saveModeration"
      description="Block a chat user from all bot commands, or set one shared per-user cooldown across bot commands."
      hint="Bot moderation rules are public PDS data and are separate from Emoticons moderation. The server enforces them."
    />
  </DrawnTabs>
  <p v-if="message" role="status">{{ message }}</p>
</template>
<style scoped>
.bot-tab-content {
  margin: 0;
  padding: 0;
}
.bot-commands-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
.bot-chat { min-width: 0; }
.bot-chat > iframe:not([hidden]) { width: 100%; height: 480px; border: 0; background: white; }
.bot-chat > iframe[hidden] { display: none; }
.bot-chat .settings-hint { margin-top: 12px; }
@media (min-width: 900px) {
  .bot-commands-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
#app .bot-tab-content::before {
  display: none;
}
.bot-rule {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem;
}
.bot-rule > div {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.bot-rule p {
  margin: 0.3rem 0;
}
</style>
