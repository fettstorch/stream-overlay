<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { adminFetch } from "./cloud-admin-fetch.ts";
import sendIcon from "./assets/branding/controls/send.png";
const props = defineProps<{ did: string }>();
const text = ref("");
const busy = ref(false);
const status = ref("");
const permissionRequired = ref(false);
function persistenceFailed(event: MessageEvent) {
  const frame = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Pokémon Crystal mGBA preview"]',
  );
  if (
    event.origin !== location.origin ||
    event.source !== frame?.contentWindow ||
    event.data?.type !== "crystal-pet-save-failed"
  )
    return;
  permissionRequired.value = event.data.permissionRequired === true;
  status.value = permissionRequired.value
    ? "Petting works, but storing pet history needs new PDS permissions. Sign in again to authorize it."
    : "Petting works, but the pet count could not be saved. Check the server logs.";
}
onMounted(() => window.addEventListener("message", persistenceFailed));
onBeforeUnmount(() => window.removeEventListener("message", persistenceFailed));
async function send() {
  if (busy.value || !text.value.trim()) return;
  busy.value = true;
  status.value = "";
  permissionRequired.value = false;
  try {
    const response = await adminFetch(
      `/api/accounts/${encodeURIComponent(props.did)}/chat/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.value }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      permissionRequired.value = result.error === "chat-permission-required";
      throw new Error(result.message ?? "Could not send your message.");
    }
    text.value = "";
    status.value = "Message sent to your stream chat.";
  } catch (error) {
    status.value =
      error instanceof Error
        ? error.message
        : "Could not confirm sending. Check chat before retrying.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <form class="crystal-chat-test editor-fields" @submit.prevent="send">
    <div class="chat-test-row">
      <input
        v-model="text"
        placeholder="!pet <pokemon>"
        aria-label="Test petting in your stream chat"
        maxlength="3000"
        required
        :disabled="busy"
      />
      <button
        class="chat-send"
        type="submit"
        :disabled="busy || !text.trim()"
        :aria-label="busy ? 'Sending message' : 'Send message'"
      >
        <span class="button-press-shade" aria-hidden="true"></span
        ><span class="button-hover-shade" aria-hidden="true"></span><img :src="sendIcon" alt="" />
      </button>
    </div>
    <p class="settings-hint">
      Sends a real stream.place chat message as you. Use your Pokémon’s nickname.
    </p>
    <p v-if="status" role="status">{{ status }}</p>
    <a v-if="permissionRequired" :href="`/oauth/login?handle=${encodeURIComponent(did)}`"
      >Authorize chat and pet history</a
    >
  </form>
</template>
<style scoped>
.crystal-chat-test {
  margin-top: 12px;
}
.chat-test-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.chat-test-row input {
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
</style>
