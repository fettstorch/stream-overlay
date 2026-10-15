<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { observeStreamChat, type StreamChatMessage } from "@streamface/stream-chat";
import {
  chatBackground,
  chatMask,
  defaultChatConfiguration,
  parseChatConfiguration,
} from "./config";
import {
  freezeLeavingMessage,
  messageDecayStyle,
  messageLifetimeMs,
  restoreLeavingMessage,
} from "./message-transition";

const enabled = ref(false);
const props = defineProps<{
  source?: {
    observe: typeof observeStreamChat;
    subscribe: (
      receive: (state: { enabled: boolean; configuration: unknown; streamerDid: string }) => void,
    ) => () => void;
  };
}>();
const configuration = ref(defaultChatConfiguration);
// Transform the whole chat plane, separately from bubble entrance/move transforms.
// A viewport-relative camera distance keeps perspective usable at different OBS sizes.
// One axis-angle tilt keeps both slider directions in the screen's XY plane.
// Chained Euler rotations would rotate the second slider's axis with the first.
const rotationStyle = computed(() => {
  const { rotationX, rotationY, perspectiveStrength } = configuration.value;
  const angle = Math.hypot(rotationX, rotationY);
  return {
    transform: `perspective(${200 - perspectiveStrength * 1.7}vh) rotate3d(${angle ? rotationX : 1}, ${rotationY}, 0, ${angle}deg)`,
  };
});
const maskStyle = computed(() => ({
  maskImage: chatMask(configuration.value.fadeOut),
  WebkitMaskImage: chatMask(configuration.value.fadeOut),
  fontSize: `${configuration.value.fontSize}px`,
  "--message-background": chatBackground(configuration.value.respectUserChatColor
    ? { ...defaultChatConfiguration, backgroundOpacity: configuration.value.backgroundOpacity } : configuration.value),
}));
function messageStyle(message: StreamChatMessage) {
  const color = message.author.chatColor;
  if (!configuration.value.respectUserChatColor || typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
    return messageDecayStyle;
  // Relative luminance chooses readable black or white text on the user's color.
  const channels = [1, 3, 5].map(offset => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  return { ...messageDecayStyle, backgroundColor: chatBackground({ ...configuration.value, backgroundColor: color }), color: luminance > 0.179 ? "#000000" : "#ffffff" };
}
const failedAvatars = ref(new Set<string>());
function authorName(message: StreamChatMessage) {
  return message.author.displayName || message.author.handle || message.author.did;
}
const messages = ref<StreamChatMessage[]>([]);
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
let status: EventSource | undefined;
let closeChat: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;
let session = 0;
let streamerDid: string | undefined;

function removeMessage(id: string) {
  removalTimers.delete(id);
  messages.value = messages.value.filter((message) => message.id !== id);
}

function clearMessages() {
  for (const timer of removalTimers.values()) clearTimeout(timer);
  removalTimers.clear();
  messages.value = [];
}

function setEnabled(next: boolean) {
  if (enabled.value === next) return;
  enabled.value = next;
  const currentSession = ++session;
  unsubscribe?.();
  closeChat?.();
  unsubscribe = undefined;
  closeChat = undefined;
  clearMessages();
  if (!next) return;
  const chat = props.source ? props.source.observe() : observeStreamChat();
  closeChat = chat.close;
  unsubscribe = chat.messages.subscribe((message) => {
    if (!enabled.value || currentSession !== session) return;
    // Render plain text only, and ignore malformed payloads from the live feed.
    if (
      !message ||
      typeof message.id !== "string" ||
      typeof message.text !== "string" ||
      typeof message.streamerDid !== "string" ||
      typeof message.author?.did !== "string"
    )
      return;
    if (streamerDid !== undefined && message.streamerDid !== streamerDid) return;
    if (messages.value.length && messages.value[0]!.streamerDid !== message.streamerDid)
      clearMessages();
    if (messages.value.some((previous) => previous.id === message.id)) return;
    const nextMessages = [...messages.value, message].slice(-50);
    for (const previous of messages.value) {
      if (!nextMessages.includes(previous)) {
        clearTimeout(removalTimers.get(previous.id));
        removalTimers.delete(previous.id);
      }
    }
    messages.value = nextMessages;
    removalTimers.set(
      message.id,
      setTimeout(() => removeMessage(message.id), messageLifetimeMs),
    );
  });
}

onMounted(() => {
  if (props.source) {
    const dispose = props.source.subscribe((state) => {
      if (state.streamerDid !== streamerDid) {
        streamerDid = state.streamerDid;
        setEnabled(false);
      }
      const settings = parseChatConfiguration(state.configuration);
      if (settings) configuration.value = settings;
      setEnabled(state.enabled);
    });
    status = { close: dispose } as EventSource;
    return;
  }
  status = new EventSource("/api/modules/chat/events");
  status.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data) as {
        enabled?: unknown;
        configuration?: unknown;
        streamerDid?: unknown;
      };
      if (typeof state.streamerDid === "string" && state.streamerDid !== streamerDid) {
        streamerDid = state.streamerDid;
        clearMessages();
      }
      const settings = parseChatConfiguration(state.configuration);
      if (settings) configuration.value = settings;
      if (typeof state.enabled === "boolean") setEnabled(state.enabled);
    } catch {
      /* Wait for the next valid state. */
    }
  };
  status.onerror = () => setEnabled(false);
});

onBeforeUnmount(() => {
  status?.close();
  setEnabled(false);
});
</script>

<template>
  <div v-if="enabled" class="chat-plane" :style="rotationStyle">
    <ol
      class="chat-messages"
      :style="maskStyle"
      aria-label="Stream chat"
      aria-live="polite"
      aria-relevant="additions"
    >
      <TransitionGroup
        name="chat-bubble"
        @before-leave="freezeLeavingMessage"
        @leave-cancelled="restoreLeavingMessage"
      >
        <li
          v-for="message in messages"
          :key="message.id"
          class="chat-message"
          :style="messageStyle(message)"
        >
          <img
            v-if="message.author.avatar && !failedAvatars.has(message.author.avatar)"
            class="chat-avatar"
            :src="message.author.avatar"
            alt=""
            @error="failedAvatars.add(message.author.avatar!)"
          />
          <div v-else class="chat-avatar avatar-fallback" aria-hidden="true">
            {{ authorName(message).slice(0, 1).toUpperCase() }}
          </div>
          <div class="chat-content">
            <strong>{{ authorName(message) }}</strong>
            <span>{{ message.text }}</span>
          </div>
        </li>
      </TransitionGroup>
    </ol>
  </div>
</template>

<style>
/* Keep transparent space outside the rotated plane for perspective expansion. */
.chat-plane {
  position: fixed;
  inset: 25%;
  transform-origin: center center;
}
.chat-messages {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 16px;
  overflow: hidden;
  list-style: none;
  font:
    20px/1.4 system-ui,
    sans-serif;
  color: white;
}
.chat-message {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 0.6em;
  max-width: 100%;
  padding: 0.4em 0.6em;
  background: var(--message-background);
  border-radius: 4px;
  overflow-wrap: anywhere;
  animation-name: chat-message-decay;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
.chat-avatar {
  width: 2.4em;
  height: 2.4em;
  flex: 0 0 2.4em;
  object-fit: cover;
  border-radius: 50%;
}
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.15);
}
.chat-content {
  min-width: 0;
}
.chat-message strong {
  display: block;
  font-size: 0.65em;
  line-height: 1.3;
  margin-bottom: 0.2em;
}
.chat-message .chat-content span {
  display: block;
  white-space: pre-wrap;
}
.chat-bubble-move,
.chat-bubble-enter-active,
.chat-bubble-leave-active {
  transition:
    transform 280ms ease,
    opacity 280ms ease;
}
.chat-bubble-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.chat-bubble-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
.chat-bubble-leave-active {
  position: absolute;
  pointer-events: none;
}
@keyframes chat-message-decay {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chat-bubble-move,
  .chat-bubble-enter-active,
  .chat-bubble-leave-active {
    transition: none;
  }
}
</style>

<style>
.overlay-layer .chat-plane {
  position: absolute;
  inset: 0;
}
</style>
