import { createApp } from "vue";
import Chat from "../../../modules/chat/src/App.vue";
import { DirectStreamChatService, SampleChatService } from "@stream-overlay/stream-chat";
import { observeCloudConfig } from "./cloud-module-source.ts";

let subscription: ReturnType<typeof observeCloudConfig> | undefined;
const preview = new URLSearchParams(location.search).get("preview") === "1";
const chat = preview ? new SampleChatService() : new DirectStreamChatService(event => {
  if (event === "chat.direct-message-emitted") subscription?.report("playback-started", "chat.message-delivered");
  else if (/connected$/.test(event)) subscription?.report("config-loaded", event);
  else if (/error|failed|timeout/.test(event)) subscription?.report("media-failed", event);
});
const app = createApp(Chat, { source: {
  observe: () => ({ messages: chat.messages, close: () => chat.stop() }),
  subscribe: (receive: (state: { enabled: boolean; configuration: unknown; streamerDid: string }) => void) => subscription = observeCloudConfig(config => {
    receive({ enabled: config.modules.chat, configuration: config.chat, streamerDid: config.streamerDid });
    chat.setStreamerDid(config.modules.chat ? config.streamerDid : "");
  }, "chat"),
} }).mount("#app");
addEventListener("pagehide", () => { app.$.appContext.app.unmount(); chat.stop(); }, { once: true });
