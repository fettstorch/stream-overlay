<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { observeStreamChat, type StreamChatMessage } from "@stream-overlay/stream-chat";
import { chatBackground, chatMask, defaultChatConfiguration, parseChatConfiguration } from "./config";

const enabled = ref(false);
const configuration = ref(defaultChatConfiguration);
const maskStyle = computed(() => ({
  maskImage: chatMask(configuration.value.fadeOut), WebkitMaskImage: chatMask(configuration.value.fadeOut),
  fontSize: `${configuration.value.fontSize}px`, "--message-background": chatBackground(configuration.value),
}));
const failedAvatars = ref(new Set<string>());
function authorName(message: StreamChatMessage) {
  return message.author.displayName || message.author.handle || message.author.did;
}
const messages = ref<StreamChatMessage[]>([]);
let status: EventSource | undefined;
let closeChat: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;
let session = 0;

function setEnabled(next: boolean) {
  if (enabled.value === next) return;
  enabled.value = next;
  const currentSession = ++session;
  unsubscribe?.();
  closeChat?.();
  unsubscribe = undefined;
  closeChat = undefined;
  messages.value = [];
  if (!next) return;
  const chat = observeStreamChat();
  closeChat = chat.close;
  unsubscribe = chat.messages.subscribe(message => {
    if (!enabled.value || currentSession !== session) return;
    // Render plain text only, and ignore malformed payloads from the live feed.
    if (!message || typeof message.id !== "string" || typeof message.text !== "string"
      || typeof message.streamerDid !== "string" || typeof message.author?.did !== "string") return;
    if (messages.value.length && messages.value[0]!.streamerDid !== message.streamerDid) messages.value = [];
    if (messages.value.some(previous => previous.id === message.id)) return;
    messages.value = [...messages.value, message].slice(-50);
  });
}

onMounted(() => {
  status = new EventSource("/api/modules/chat/events");
  status.onmessage = event => {
    try {
      const state = JSON.parse(event.data) as { enabled?: unknown; configuration?: unknown };
      const settings = parseChatConfiguration(state.configuration);
      if (settings) configuration.value = settings;
      if (typeof state.enabled === "boolean") setEnabled(state.enabled);
    } catch { /* Wait for the next valid state. */ }
  };
  status.onerror = () => setEnabled(false);
});

onBeforeUnmount(() => {
  status?.close();
  setEnabled(false);
});
</script>

<template>
  <ol v-if="enabled" class="chat-messages" :style="maskStyle" aria-label="Stream chat" aria-live="polite" aria-relevant="additions">
    <li v-for="message in messages" :key="message.id" class="chat-message">
      <img v-if="message.author.avatar && !failedAvatars.has(message.author.avatar)" class="chat-avatar" :src="message.author.avatar" alt="" @error="failedAvatars.add(message.author.avatar!)">
      <div v-else class="chat-avatar avatar-fallback" aria-hidden="true">{{ authorName(message).slice(0, 1).toUpperCase() }}</div>
      <div class="chat-content">
        <strong>{{ authorName(message) }}</strong>
        <span>{{ message.text }}</span>
      </div>
    </li>
  </ol>
</template>

<style>
html, body, #app { margin: 0; width: 100%; height: 100%; background: transparent; }
* { box-sizing: border-box; }
.chat-messages { position: fixed; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; gap: 8px; margin: 0; padding: 16px; overflow: hidden; list-style: none; font: 20px/1.4 system-ui, sans-serif; color: white; }
.chat-message { flex: none; display: flex; align-items: flex-start; gap: .6em; max-width: 100%; padding: .4em .6em; background: var(--message-background); border-radius: 4px; overflow-wrap: anywhere; }
.chat-avatar { width: 2.4em; height: 2.4em; flex: 0 0 2.4em; object-fit: cover; border-radius: 50%; }
.avatar-fallback { display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, .15); }
.chat-content { min-width: 0; }
.chat-message strong { display: block; }
.chat-message .chat-content span { display: block; white-space: pre-wrap; }
</style>
