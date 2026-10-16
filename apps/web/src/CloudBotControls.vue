<script setup lang="ts">
import { normalizeCommandName } from "../../../modules/emoticons/src/validation.ts";
import AppButton from "./AppButton.vue";
import { computed, nextTick, ref, watch } from "vue";
import sendIcon from "./assets/branding/controls/send.png";
import DrawnTabs from "./DrawnTabs.vue";
import BotRoutines from "./BotRoutines.vue";
import EmoticonModeration from "./EmoticonModeration.vue";
import { adminFetch } from "./cloud-admin-fetch.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { validateBotSettings, type BotRule } from "../../../modules/bot/src/config.ts";
const props = defineProps<{
  config: CloudConfig;
  save: (config: CloudConfig) => Promise<boolean>;
  avatar?: string;
}>();
const avatarFailed = ref(false);
watch(
  () => props.avatar,
  () => {
    avatarFailed.value = false;
  },
);
const busy = ref(false),
  message = ref("");
const command = ref(""),
  response = ref(""),
  cooldown = ref(30),
  editing = ref<string>();
const commandInput = ref<HTMLInputElement>();
const tab = ref("commands");
const chatText = ref(""),
  chatSending = ref(false),
  chatStatus = ref(""),
  chatPermissionRequired = ref(false);
async function sendChat() {
  if (chatSending.value || !chatText.value.trim()) return;
  chatSending.value = true;
  chatStatus.value = "";
  chatPermissionRequired.value = false;
  try {
    const result = await adminFetch(
      `/api/accounts/${encodeURIComponent(props.config.streamerDid)}/chat/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chatText.value }),
      },
    );
    const data = await result.json();
    if (!result.ok) {
      chatPermissionRequired.value = data.error === "chat-permission-required";
      throw new Error(data.message ?? "Could not send your message.");
    }
    chatText.value = "";
    chatStatus.value = "Message sent to your stream chat.";
  } catch (error) {
    chatStatus.value =
      error instanceof Error
        ? error.message
        : "Could not confirm sending. Check chat before retrying.";
  } finally {
    chatSending.value = false;
  }
}
const chatUrl = computed(
  () => `https://stream.place/chat-popout/${encodeURIComponent(props.config.streamerDid)}`,
);
const tabs = [
  { id: "commands", label: "Testing" },
  { id: "create", label: "Commands" },
  { id: "routines", label: "Routines" },
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
      ...props.config.bot,
      enabled: props.config.bot?.enabled ?? false,
      rules: props.config.bot?.rules ?? [],
      moderation: candidate.moderation ?? [],
      ...(candidate.roles !== undefined ? { roles: candidate.roles } : {}),
    },
  });
}
function reset() {
  command.value = "";
  response.value = "";
  cooldown.value = 30;
  editing.value = undefined;
}
async function edit(rule: BotRule) {
  tab.value = "create";
  editing.value = rule.command;
  command.value = rule.command;
  response.value = rule.response;
  cooldown.value = rule.cooldownSeconds;
  await nextTick();
  commandInput.value?.focus();
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
  const name = normalizeCommandName(command.value);
  const rules = [
    ...(props.config.bot?.rules ?? []).filter((rule) => rule.command !== editing.value),
    { command: name, response: response.value.trim(), cooldownSeconds: cooldown.value },
  ];
  await persist(rules);
}
</script>
<template>
  <p>The bot runs while your shared OBS overlay is open. Use the overlay URL above.</p>
  <DrawnTabs v-model="tab" :tabs="tabs" label="Bot commands">
    <section
      v-show="tab === 'commands'"
      :inert="tab !== 'commands' || undefined"
      class="module-section bot-tab-content"
    >
      <div class="bot-commands-layout">
        <div class="bot-chat">
          <div v-if="tab === 'commands'" class="bot-chat-viewport">
            <iframe :src="chatUrl" title="Your Streamplace chat" referrerpolicy="no-referrer" />
          </div>
          <form class="bot-chat-composer editor-fields" @submit.prevent="sendChat">
            <div class="bot-chat-input-row">
              <img
                v-if="avatar && !avatarFailed"
                class="chat-avatar"
                :src="avatar"
                alt="Your profile picture"
                @error="avatarFailed = true"
              />
              <span
                v-else
                class="chat-avatar avatar-placeholder"
                role="img"
                aria-label="Profile picture unavailable"
              />
              <input
                v-model="chatText"
                aria-label="Chat message"
                placeholder="Type a chat message or !command"
                maxlength="3000"
                required
                :disabled="chatSending"
              />
              <button
                v-if="chatText.trim()"
                class="chat-send"
                type="submit"
                :disabled="chatSending"
                :aria-label="chatSending ? 'Sending message' : 'Send message'"
              >
                <span class="button-press-shade" aria-hidden="true"></span
                ><span class="button-hover-shade" aria-hidden="true"></span
                ><img :src="sendIcon" alt="" />
              </button>
            </div>
            <p v-if="chatStatus" role="status">{{ chatStatus }}</p>
            <a
              v-if="chatPermissionRequired"
              :href="`/oauth/login?handle=${encodeURIComponent(config.streamerDid)}`"
              >Authorize chat posting</a
            >
          </form>
          <p v-if="!config.bot?.enabled" class="settings-hint">
            Enable the Bot module to respond to commands here.
          </p>
        </div>
        <div>
          <h4>Commands</h4>
          <ul class="command-list striped-list" aria-label="Commands overview">
            <li v-for="rule in config.bot?.rules ?? []" :key="rule.command" class="bot-rule">
              <div>
                <strong>!{{ rule.command }}</strong>
                <p>{{ rule.response }}</p>
                <small>{{ rule.cooldownSeconds }}s cooldown</small>
              </div>
            </li>
          </ul>
          <p v-if="!config.bot?.rules.length">No bot commands yet.</p>
          <h4 class="routine-overview-heading">Routines</h4>
          <ul class="command-list striped-list" aria-label="Routines overview">
            <li v-for="routine in config.bot?.routines ?? []" :key="routine.id" class="bot-rule">
              <div>
                <strong
                  >Every {{ routine.intervalSeconds / 60 }}
                  {{ routine.intervalSeconds === 60 ? "minute" : "minutes" }}</strong
                >
                <p>{{ routine.response }}</p>
                <small>{{ routine.enabled ? "Enabled" : "Paused" }}</small>
              </div>
            </li>
          </ul>
          <p v-if="!config.bot?.routines?.length">No routines yet.</p>
        </div>
      </div>
    </section>
    <section
      v-show="tab === 'create'"
      :inert="tab !== 'create' || undefined"
      class="module-section bot-tab-content command-management"
    >
      <ul class="command-list striped-list" aria-label="Manage commands">
        <li v-for="rule in config.bot?.rules ?? []" :key="rule.command" class="bot-rule">
          <div>
            <strong>!{{ rule.command }}</strong>
            <p>{{ rule.response }}</p>
            <small>{{ rule.cooldownSeconds }}s cooldown</small>
          </div>
          <AppButton :disabled="busy" @click="edit(rule)" type="submit">Edit</AppButton>
          <AppButton
            class="danger-button"
            :disabled="busy"
            @click="
              persist((config.bot?.rules ?? []).filter((item) => item.command !== rule.command))
            "
            type="submit"
          >
            Remove
          </AppButton>
        </li>
      </ul>
      <p v-if="!config.bot?.rules.length">No bot commands yet.</p>
    </section>
    <form
      v-show="tab === 'create'"
      :inert="tab !== 'create' || undefined"
      class="module-section bot-tab-content editor-fields"
      @submit.prevent="add"
    >
      <h4 v-if="editing">Edit command</h4>
      <label
        >Command<input
          ref="commandInput"
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
      <AppButton class="success-button" type="submit" :disabled="busy">{{
        busy ? "Saving…" : "Save command"
      }}</AppButton>
      <AppButton class="danger-button" type="button" :disabled="busy" @click="reset"
        >Cancel</AppButton
      >
    </form>
    <EmoticonModeration
      v-if="tab === 'moderation'"
      :config="moderationConfig"
      :save="saveModeration"
      description="Block a chat user from all bot commands, or set one shared per-user cooldown across bot commands."
      hint="Bot moderation rules are public PDS data and are separate from Emotes moderation. The server enforces them."
    />
    <BotRoutines v-if="tab === 'routines'" :config="config" :save="save" />
  </DrawnTabs>

  <p v-if="message" role="status">{{ message }}</p>
</template>
<style scoped>
.bot-tab-content {
  margin: 0;
  padding: 0;
}
.command-management {
  margin-bottom: 24px;
}
.routine-overview-heading {
  margin-top: 24px;
}
.bot-commands-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
}
.bot-chat {
  min-width: 0;
}
.bot-chat-viewport {
  height: 480px;
  overflow: hidden;
}
/* Keep Streamplace's bottom sign-in/composer area outside our visible viewport. */
.bot-chat-viewport > iframe {
  display: block;
  width: 100%;
  height: calc(100% + 64px);
  border: 0;
  background: white;
}
.bot-chat > iframe[hidden] {
  display: none;
}
.bot-chat .settings-hint {
  margin-top: 12px;
}
.bot-chat-composer {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
.bot-chat-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.chat-avatar {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-radius: 50%;
  object-fit: cover;
}
.bot-chat-input-row > input {
  flex: 1;
  min-width: 0;
}
#app .chat-send {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 9px;
}
.chat-send img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
@media (min-width: 900px) {
  .bot-commands-layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
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
