import { DirectStreamChatService } from "../../../packages/stream-chat/src/direct-service.ts";
import { observeCloudConfig } from "./cloud-module-source.ts";
import type { BotSettings } from "../../../modules/bot/src/config.ts";
import { RoutineSchedule } from "../../../modules/bot/src/routines.ts";
const params = new URLSearchParams(location.search);
const did = params.get("did") ?? "",
  token = params.get("token") ?? "";
let settings: BotSettings | undefined;
const chat = new DirectStreamChatService();
const routines = new RoutineSchedule();
const pendingRoutines: string[] = [];
let sendingRoutine = false, nextRoutineAttempt = 0;
const stopConfig = observeCloudConfig((config) => {
  settings = config.bot;
  chat.setStreamerDid(settings?.enabled && token ? did : "");
  routines.update(token ? settings : undefined, Date.now());
  for (let index = pendingRoutines.length - 1; index >= 0; index--)
    if (!settings?.enabled || !settings.routines?.some(item => item.id === pendingRoutines[index] && item.enabled))
      pendingRoutines.splice(index, 1);
}, "bot");
const routineTimer = setInterval(() => {
  const now = Date.now();
  for (const id of routines.due(now)) if (!pendingRoutines.includes(id)) pendingRoutines.push(id);
  if (sendingRoutine || now < nextRoutineAttempt || !pendingRoutines.length) return;
  const routineId = pendingRoutines.shift()!;
  if (!settings?.enabled || !settings.routines?.some(item => item.id === routineId && item.enabled)) return;
  sendingRoutine = true;
  nextRoutineAttempt = now + 2500;
  void fetch(`/api/accounts/${encodeURIComponent(did)}/bot/routine`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ token, routineId }),
  }).catch(() => { /* No blind retries: a failed response may follow a successful PDS write. */ })
    .finally(() => { sendingRoutine = false; });
}, 1000);
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
    clearInterval(routineTimer);
    pendingRoutines.length = 0;
    chat.stop();
    subscription();
  },
  { once: true },
);
