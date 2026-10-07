import type { EmoticonEvent } from "./contracts.ts";
const boardMode = location.pathname.includes("/board");
const muted = new URLSearchParams(location.search).get("muted") === "1";
const effect = document.querySelector<HTMLDivElement>("#effect")!;
const board = document.querySelector<HTMLElement>("#board")!;
const clientId = crypto.randomUUID();
function diagnose(event: string, details: Record<string, unknown> = {}) {
  void fetch("/api/diagnostics", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, details: { ...details, clientId, overlay: boardMode ? "board" : "effects", muted } }) }).catch(() => {});
}
diagnose("emoticons.overlay-mounted");
type Effect = Extract<EmoticonEvent, { type: "effect" }>;
let audio: HTMLAudioElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Effect[] = [];
let playing = false;
let generation = 0;
let cancelPlayback = () => {};
function clear() {
  generation++; clearTimeout(timer); cancelPlayback(); cancelPlayback = () => {};
  audio?.pause(); audio = null; effect.replaceChildren(); effect.hidden = true; pending = []; playing = false;
}
async function next() {
  if (playing) return;
  const event = pending.shift(); if (!event) return;
  diagnose("emoticons.effect-started", { effectId: event.id, command: event.command.command });
  playing = true; const current = generation; const command = event.command;
  effect.style.width = command.width || "40vw"; effect.style.height = command.height || "35vh";
  if (command.imageAssetId) { const image = new Image(); image.onload = () => diagnose("emoticons.image-loaded", { effectId: event.id, width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => diagnose("emoticons.image-failed", { effectId: event.id, assetId: command.imageAssetId }); image.src = `/api/emoticons/assets/${command.imageAssetId}`; image.alt = command.command; effect.append(image); effect.hidden = false; }
  // Each renderer also waits for actual audio completion: loading delays must not
  // truncate the sound or let the following effect overlap it.
  let finishAudio = () => {};
  let finishDuration = () => {};
  const duration = new Promise<void>(resolve => { finishDuration = resolve; timer = setTimeout(resolve, event.durationSeconds * 1000); });
  const sound = new Promise<void>(resolve => {
    finishAudio = resolve;
    if (!command.audioAssetId) { resolve(); return; }
    audio = new Audio(`/api/emoticons/assets/${command.audioAssetId}`); audio.muted = muted; audio.volume = command.volume;
    audio.onended = () => resolve(); audio.onerror = () => { diagnose("emoticons.audio-failed", { effectId: event.id, code: audio?.error?.code }); resolve(); };
    void audio.play().catch(error => { diagnose("emoticons.audio-play-failed", { effectId: event.id, error: String(error) }); console.warn("Emoticon audio could not play. Enable OBS browser-source audio.", error); resolve(); });
  });
  cancelPlayback = () => { finishDuration(); finishAudio(); };
  await Promise.all([duration, sound]);
  if (current !== generation) return;
  diagnose("emoticons.effect-ended", { effectId: event.id });
  audio?.pause(); audio = null; effect.replaceChildren(); effect.hidden = true; playing = false;
  cancelPlayback = () => {}; void next();
}
const events = new EventSource(`/api/emoticons/events?overlay=${boardMode ? "board" : "effects"}&clientId=${clientId}`);
events.onmessage = message => {
  const event = JSON.parse(message.data) as EmoticonEvent;
  if (event.type === "state") {
    if (!event.state.enabled) clear();
    board.hidden = !boardMode || !event.state.enabled;
    const list = board.querySelector("ul")!; list.replaceChildren();
    for (const command of event.state.commands) {
      const item = document.createElement("li"); const name = document.createElement("strong"); name.textContent = `!${command.command}`; item.append(name);
      list.append(item);
    }
    if (!event.state.commands.length) { const item = document.createElement("li"); item.textContent = "No commands yet"; list.append(item); }
  } else if (event.type === "clear") clear();
  else if (!boardMode) { diagnose("emoticons.effect-received", { effectId: event.id, command: event.command.command }); pending.push(event); void next(); }
};
events.onopen = () => diagnose("emoticons.events-connected");
events.onerror = () => { diagnose("emoticons.events-disconnected"); clear(); board.hidden = true; };
window.addEventListener("pagehide", () => { clear(); events.close(); });
