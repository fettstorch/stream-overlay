import { DirectStreamChatService } from "../../../packages/stream-chat/src/direct-service.ts";
import { observeCloudConfig } from "./cloud-module-source.ts";
import type { BotSettings } from "../../../modules/bot/src/config.ts";
import { RoutineSchedule } from "../../../modules/bot/src/routines.ts";
const params = new URLSearchParams(location.search);
const did = params.get("did") ?? "",
  token = params.get("token") ?? "";
let settings: BotSettings | undefined;
const sourceId = crypto.randomUUID();
let activeUntil = 0, stopped = false, renewing = false;
const isActive = () => !stopped && Date.now() < activeUntil;
const chat = new DirectStreamChatService();
const routines = new RoutineSchedule();
const pendingRoutines: string[] = [];
let sendingRoutine = false, nextRoutineAttempt = 0;
function updateActivity() {
  const enabled = isActive() && settings?.enabled && token;
  chat.setStreamerDid(enabled ? did : "");
  routines.update(enabled ? settings : undefined, Date.now());
  if (!enabled) pendingRoutines.length = 0;
}
async function renewLease() {
  if (stopped || renewing || !token || !settings?.enabled) return;
  renewing = true;
  const startedAt = Date.now();
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(did)}/bot/lease`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000), body: JSON.stringify({ token, sourceId }),
    });
    if (!response.ok) activeUntil = 0;
    else {
      const lease = await response.json();
      activeUntil = lease.active === true ? startedAt + 60_000 : 0;
    }
  } catch { /* Keep an existing lease only until its locally known deadline. */ }
  finally { renewing = false; if (!stopped) updateActivity(); }
}
const leaseTimer = setInterval(() => { updateActivity(); void renewLease(); }, 20_000);
const stopConfig = observeCloudConfig((config) => {
  settings = config.bot;
  updateActivity();
  void renewLease();
  for (let index = pendingRoutines.length - 1; index >= 0; index--)
    if (!settings?.enabled || !settings.routines?.some(item => item.id === pendingRoutines[index] && item.enabled))
      pendingRoutines.splice(index, 1);
}, "bot");
const routineTimer = setInterval(() => {
  if (!isActive()) { updateActivity(); return; }
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
    body: JSON.stringify({ token, sourceId, routineId }),
  }).then(response => { if (response.status === 409) { activeUntil = 0; updateActivity(); } })
    .catch(() => { /* No blind retries: a failed response may follow a successful PDS write. */ })
    .finally(() => { sendingRoutine = false; });
}, 1000);
const subscription = chat.messages.subscribe((message) => {
  const command = /^!([a-z0-9_-]+)(?:\s|$)/i.exec(message.text)?.[1].toLowerCase();
  if (!isActive() || !settings?.enabled || !settings.rules.some((rule) => rule.command === command)) return;
  const rkey = message.id.slice(message.author.did.length + 1);
  void fetch(`/api/accounts/${encodeURIComponent(did)}/bot/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      sourceId,
      uri: `at://${message.author.did}/place.stream.chat.message/${rkey}`,
    }),
  }).then(response => { if (response.status === 409) { activeUntil = 0; updateActivity(); } }).catch(() => {
    /* Server logs verification and send failures; do not retry sends blindly. */
  });
});
window.addEventListener(
  "pagehide",
  () => {
    stopped = true;
    activeUntil = 0;
    stopConfig();
    clearInterval(leaseTimer);
    clearInterval(routineTimer);
    pendingRoutines.length = 0;
    chat.stop();
    subscription();
  },
  { once: true },
);
