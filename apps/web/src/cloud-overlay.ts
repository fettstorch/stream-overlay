import { RelayClient } from "@stream-overlay/browser-runtime";
import { DirectStreamChatService } from "@stream-overlay/stream-chat";
import { EmoticonRuntime } from "@stream-overlay/emoticons/src/runtime.ts";
import type { EmoticonCommand, EmoticonEvent, EmoticonState } from "@stream-overlay/emoticons/src/contracts.ts";
import type { RelaySnapshot } from "@stream-overlay/protocol";

const boardMode = location.pathname.startsWith("/board"); const did = new URLSearchParams(location.search).get("did") ?? ""; const channel = new URLSearchParams(location.search).get("preview") === "1" ? "preview" : "live";
if (!did.startsWith("did:")) document.body.textContent = "Missing ?did= account identifier";
const container = document.querySelector<HTMLElement>(boardMode ? ".board" : ".effect")!; let config: EmoticonState = { enabled: false, commands: [], assets: [] }; let cooldowns: RelaySnapshot["cooldowns"] = {}; let revision = 0; let boardRender = 0;
function media(command: EmoticonCommand) { return command.videoUrl ?? command.imageUrl ?? command.audioUrl; }
function renderBoard() { if (!boardMode) return; const generation = ++boardRender; container.replaceChildren(); for (const command of config.commands) { const row = document.createElement("div"); row.className = "command"; row.append(Object.assign(document.createElement("b"), { textContent: `!${command.command}` })); if (command.mode !== "sticker") { const bar = document.createElement("span"); bar.className = "cooldown"; bar.append(document.createElement("i")); row.append(bar); const update = () => { if (generation !== boardRender || !bar.isConnected) return; const value = cooldowns[command.id]; const remaining = value ? Math.max(0, value.endsAt - Date.now()) : 0; (bar.firstElementChild as HTMLElement).style.width = `${value && value.durationSeconds > 0 ? remaining / (value.durationSeconds * 1000) * 100 : 0}%`; if (remaining) requestAnimationFrame(update); }; update(); } container.append(row); } }
function play(event: Extract<EmoticonEvent, { type: "effect" }>) {
  const command = event.command; const visual = command.videoUrl ? document.createElement("video") : command.imageUrl ? new Image() : undefined; const audio = command.audioUrl ? document.createElement("audio") : undefined;
  if (!visual && !audio) return;
  if (visual) { visual.src = command.videoUrl ?? command.imageUrl!; visual.style.width = command.width || (command.mode === "sticker" ? "5vw" : "auto"); visual.style.height = command.height || (command.mode === "sticker" ? "5vw" : "auto"); visual.style.objectFit = "contain"; visual.style.transform = command.mirrored ? "scaleX(-1)" : "none"; if (visual instanceof HTMLVideoElement) { visual.autoplay = true; visual.loop = command.mode === "sticker"; visual.muted = command.mode === "sticker"; visual.volume = command.volume; } }
  if (audio) { audio.src = command.audioUrl!; audio.autoplay = true; audio.volume = command.volume; }
  const wrapper = document.createElement("div"); if (visual) wrapper.append(visual); if (audio) wrapper.append(audio);
  if (command.mode === "sticker") { wrapper.style.cssText = `position:fixed;left:${5 + Math.random()*90}%;bottom:-10vh;transition:transform ${event.durationSeconds}s linear;`; container.append(wrapper); requestAnimationFrame(() => { wrapper.style.transform = `translate(${(Math.random()-.5)*160}px,-120vh)`; }); }
  else container.replaceChildren(wrapper);
  setTimeout(() => { for (const element of wrapper.querySelectorAll("audio,video")) (element as HTMLMediaElement).pause(); wrapper.remove(); }, event.durationSeconds * 1000);
}
function nextRevision() { revision = Math.max(revision + 1, Date.now()); return revision; }
const runtime = boardMode ? undefined : new EmoticonRuntime({ effect: play, cooldowns: state => { cooldowns = state; relay.send({ type: "cooldowns", revision: nextRevision(), cooldowns: state }); } });
const chat = boardMode ? undefined : new DirectStreamChatService(); chat?.messages.subscribe(message => runtime?.message(message.id, message.text, message.author));
async function refresh(force = false) { const response = await fetch(`/api/accounts/${encodeURIComponent(did)}/config${force ? "?refresh=1" : ""}`, { cache: "no-store" }); if (!response.ok) return; const cloud = await response.json() as any; const commands: EmoticonCommand[] = cloud.commands.map((command:any) => ({ ...command, imageAssetId: null, audioAssetId: null, videoAssetId: null, imageUrl: command.image?.url, audioUrl: command.audio?.url, videoUrl: command.video?.url })); config = { enabled: cloud.enabled, commands, assets: [], cooldowns }; runtime?.configure(config); chat?.setStreamerDid(cloud.streamerDid); renderBoard(); }
const relay = new RelayClient(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/relay`, { type: "hello", did, page: boardMode ? "board" : "effect", channel }, message => {
  if (message.type === "snapshot" && boardMode && message.revision >= revision) { revision = message.revision; cooldowns = message.cooldowns; renderBoard(); }
  if (message.type === "config-changed") void refresh(true);
  // Tests use the same browser-owned runtime and cooldowns as chat commands.
  if (message.type === "test-command" && runtime) {
    const accepted = runtime.trigger(message.commandId);
    console.info("emoticons.test-command", { requestId: message.requestId, commandId: message.commandId, accepted });
  }
}, () => { if (!boardMode) relay.send({ type: "cooldowns", revision: nextRevision(), cooldowns }); });
void refresh(); const poll = setInterval(() => void refresh(true), 60_000); addEventListener("pagehide", () => { clearInterval(poll); relay.close(); chat?.stop(); runtime?.clear(); });
