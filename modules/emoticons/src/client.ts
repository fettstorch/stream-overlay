import type { EmoticonEvent } from "./contracts.ts";
const boardMode = location.pathname.includes("/board");
const muted = new URLSearchParams(location.search).get("muted") === "1";
const effect = document.querySelector<HTMLDivElement>("#effect")!;
const board = document.querySelector<HTMLElement>("#board")!;
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
  playing = true; const current = generation; const command = event.command;
  effect.style.width = command.width || "40vw"; effect.style.height = command.height || "35vh";
  if (command.imageAssetId) { const image = new Image(); image.src = `/api/emoticons/assets/${command.imageAssetId}`; image.alt = command.command; effect.append(image); effect.hidden = false; }
  // Each renderer also waits for actual audio completion: loading delays must not
  // truncate the sound or let the following effect overlap it.
  let finishAudio = () => {};
  let finishDuration = () => {};
  const duration = new Promise<void>(resolve => { finishDuration = resolve; timer = setTimeout(resolve, event.durationSeconds * 1000); });
  const sound = new Promise<void>(resolve => {
    finishAudio = resolve;
    if (!command.audioAssetId) { resolve(); return; }
    audio = new Audio(`/api/emoticons/assets/${command.audioAssetId}`); audio.muted = muted; audio.volume = command.volume;
    audio.onended = () => resolve(); audio.onerror = () => resolve();
    void audio.play().catch(error => { console.warn("Emoticon audio could not play. Enable OBS browser-source audio.", error); resolve(); });
  });
  cancelPlayback = () => { finishDuration(); finishAudio(); };
  await Promise.all([duration, sound]);
  if (current !== generation) return;
  audio?.pause(); audio = null; effect.replaceChildren(); effect.hidden = true; playing = false;
  cancelPlayback = () => {}; void next();
}
const events = new EventSource("/api/emoticons/events");
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
  else if (!boardMode) { pending.push(event); void next(); }
};
events.onerror = () => { clear(); board.hidden = true; };
window.addEventListener("pagehide", () => { clear(); events.close(); });
