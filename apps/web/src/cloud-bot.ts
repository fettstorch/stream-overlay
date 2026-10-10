import { DirectStreamChatService } from "../../../packages/stream-chat/src/direct-service.ts";
import { observeCloudConfig } from "./cloud-module-source.ts";
import type { BotSettings } from "../../../modules/bot/src/config.ts";
const params = new URLSearchParams(location.search);
const did = params.get("did") ?? "",
  token = params.get("token") ?? "";
let settings: BotSettings | undefined;
const chat = new DirectStreamChatService();
const stopConfig = observeCloudConfig((config) => {
  settings = config.bot;
  chat.setStreamerDid(settings?.enabled && token ? did : "");
}, "bot");
const subscription = chat.messages.subscribe((message) => {
  const command = /^!([a-z0-9_-]+)(?:\s|$)/i.exec(message.text)?.[1].toLowerCase();
  if (!settings?.enabled || !settings.rules.some((rule) => rule.command === command)) return;
  const rkey = message.id.slice(message.author.did.length + 1);
  void fetch(`/api/accounts/${encodeURIComponent(did)}/bot/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      uri: `at://${message.author.did}/place.stream.chat.message/${rkey}`,
    }),
  }).catch(() => {
    /* Server logs verification and send failures; do not retry sends blindly. */
  });
});
window.addEventListener(
  "pagehide",
  () => {
    stopConfig();
    chat.stop();
    subscription();
  },
  { once: true },
);
