import { createApp } from "vue";
import Chat from "../../../modules/chat/src/App.vue";
import { DirectStreamChatService, SampleChatService } from "@streamface/stream-chat";
import { observeCloudConfig } from "./cloud-module-source.ts";
import { parseChatConfiguration, type ChatConfiguration } from "../../../modules/chat/src/config.ts";

let subscription: ReturnType<typeof observeCloudConfig> | undefined;
const preview = new URLSearchParams(location.search).get("preview") === "1";
let previewConfiguration: ChatConfiguration | undefined;
let latestState: { enabled: boolean; configuration: unknown; streamerDid: string } | undefined;
let receiveState: ((state: NonNullable<typeof latestState>) => void) | undefined;
function previewMessage(event: MessageEvent) {
  if (!preview || event.source !== window.parent || event.origin !== location.origin || event.data?.type !== "chat-preview-configuration") return;
  const configuration = parseChatConfiguration(event.data.configuration);
  if (!configuration) return;
  previewConfiguration = configuration;
  if (latestState) receiveState?.({ ...latestState, configuration });
}
if (preview) addEventListener("message", previewMessage);
const chat = preview ? new SampleChatService() : new DirectStreamChatService(event => {
  if (event === "chat.direct-message-emitted") subscription?.report("playback-started", "chat.message-delivered");
  else if (/connected$/.test(event)) subscription?.report("config-loaded", event);
  else if (/error|failed|timeout/.test(event)) subscription?.report("media-failed", event);
});
const app = createApp(Chat, { source: {
  observe: () => ({ messages: chat.messages, close: () => chat.stop() }),
  subscribe: (receive: (state: { enabled: boolean; configuration: unknown; streamerDid: string }) => void) => {
    receiveState = receive;
    return subscription = observeCloudConfig(config => {
    latestState = { enabled: config.modules.chat, configuration: previewConfiguration ?? config.chat, streamerDid: config.streamerDid };
    receive(latestState);
    chat.setStreamerDid(config.modules.chat ? config.streamerDid : "");
  }, "chat");
  },
} }).mount("#app");
addEventListener("pagehide", () => { removeEventListener("message", previewMessage); app.$.appContext.app.unmount(); chat.stop(); }, { once: true });
