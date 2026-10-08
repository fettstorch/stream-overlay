import type { EmoticonEvent } from "./contracts.ts";
import { observeEmoticonEvents } from "./events-client.ts";
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
let media: HTMLMediaElement[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Effect[] = [];
let playing = false;
let generation = 0;
let cancelPlayback = () => {};
const stickers = new Map<HTMLElement, () => void>();
let soundButton: HTMLButtonElement | undefined;
function offerSound() {
  if (muted || soundButton) return;
  soundButton = document.createElement("button"); soundButton.type = "button";
  soundButton.textContent = "Enable sound";
  soundButton.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 16px;border:1px solid #7794e8;border-radius:8px;background:#101828;color:white;font:16px system-ui;cursor:pointer;z-index:10";
  soundButton.onclick = () => {
    // This handler runs within the browser gesture required for audible playback.
    for (const element of media) {
      element.muted = false;
      void element.play().catch(error => diagnose("emoticons.sound-enable-failed", { error: String(error) }));
    }
    soundButton?.remove(); soundButton = undefined;
    diagnose("emoticons.sound-enabled");
  };
  document.body.append(soundButton);
}
function clear() {
  for (const remove of [...stickers.values()]) remove();
  generation++; clearTimeout(timer); cancelPlayback(); cancelPlayback = () => {};
  soundButton?.remove(); soundButton = undefined;
  for (const element of media) element.pause(); media = []; effect.replaceChildren(); effect.hidden = true; pending = []; playing = false;
}
function spawnSticker(event: Effect) {
  const command = event.command;
  const container = document.createElement("div"); container.className = "sticker";
  container.style.width = command.width || "80px"; container.style.height = command.height || "80px";
  container.style.scale = String(0.7 + Math.random() * 0.3);
  container.style.left = `${5 + Math.random() * 90}%`;
  container.style.setProperty("--drift", `${(Math.random() - .5) * 160}px`);
  container.style.animationDuration = `${event.durationSeconds}s`;
  let video: HTMLVideoElement | undefined;
  let expiry: ReturnType<typeof setTimeout>;
  const remove = () => { clearTimeout(expiry); video?.pause(); container.remove(); stickers.delete(container); };
  stickers.set(container, remove); container.onanimationend = remove;
  expiry = setTimeout(remove, event.durationSeconds * 1000 + 100);
  if (command.imageAssetId) {
    const image = new Image(); image.alt = command.command;
    image.onerror = () => { diagnose("emoticons.sticker-media-failed", { effectId: event.id }); remove(); };
    image.src = `/api/emoticons/assets/${command.imageAssetId}`; container.append(image);
  } else if (command.videoAssetId) {
    video = document.createElement("video"); video.muted = true; video.playsInline = true; video.loop = true;
    video.src = `/api/emoticons/assets/${command.videoAssetId}`; container.append(video);
    void video.play().catch(error => { diagnose("emoticons.sticker-media-failed", { effectId: event.id, error: String(error) }); remove(); });
  }
  document.body.append(container);
  diagnose("emoticons.sticker-spawned", { effectId: event.id, command: command.command });
}
async function next() {
  if (playing) return;
  const event = pending.shift(); if (!event) return;
  diagnose("emoticons.effect-started", { effectId: event.id, command: event.command.command });
  playing = true; const current = generation; const command = event.command;
  effect.style.width = command.width || "40vw"; effect.style.height = command.height || "35vh";
  if (command.imageAssetId) { const image = new Image(); image.onload = () => diagnose("emoticons.image-loaded", { effectId: event.id, width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => diagnose("emoticons.image-failed", { effectId: event.id, assetId: command.imageAssetId }); image.src = `/api/emoticons/assets/${command.imageAssetId}`; image.alt = command.command; effect.append(image); effect.hidden = false; }
  // Each renderer also waits for actual media completion: loading delays must not
  // truncate the sound or let the following effect overlap it.
  const finishMedia: Array<() => void> = [];
  let finishDuration = () => {};
  const duration = new Promise<void>(resolve => { finishDuration = resolve; timer = setTimeout(resolve, event.durationSeconds * 1000); });
  const play = (element: HTMLMediaElement, assetId: string, kind: "audio" | "video") => new Promise<void>(resolve => {
    finishMedia.push(resolve); media.push(element);
    element.muted = muted; element.volume = command.volume;
    element.onplaying = () => diagnose(`emoticons.${kind}-playing`, { effectId: event.id, currentTime: element.currentTime, actualMuted: element.muted });
    element.onended = () => resolve(); element.onerror = () => { diagnose(`emoticons.${kind}-failed`, { effectId: event.id, code: element.error?.code }); resolve(); };
    element.src = `/api/emoticons/assets/${assetId}`;
    void element.play().catch(async error => {
      if (current !== generation) { resolve(); return; }
      diagnose(`emoticons.${kind}-play-failed`, { effectId: event.id, error: String(error) });
      if (error instanceof Error && error.name === "NotAllowedError" && !muted) {
        offerSound();
        if (kind === "video") {
          element.muted = true;
          try {
            await element.play();
            if (current !== generation) element.pause();
            return;
          } catch (retryError) { diagnose("emoticons.video-muted-play-failed", { effectId: event.id, error: String(retryError) }); }
        }
      }
      resolve();
    });
  });
  const playback: Promise<void>[] = [];
  if (command.videoAssetId) {
    const video = document.createElement("video"); video.playsInline = true;
    video.onloadeddata = () => diagnose("emoticons.video-loaded", { effectId: event.id, width: video.videoWidth, height: video.videoHeight });
    effect.append(video); effect.hidden = false;
    playback.push(play(video, command.videoAssetId, "video"));
  }
  if (command.audioAssetId) playback.push(play(new Audio(), command.audioAssetId, "audio"));
  cancelPlayback = () => { finishDuration(); for (const finish of finishMedia) finish(); };
  await Promise.all([duration, ...playback]);
  if (current !== generation) return;
  diagnose("emoticons.effect-ended", { effectId: event.id });
  for (const element of media) element.pause(); media = []; effect.replaceChildren(); effect.hidden = true; playing = false;
  cancelPlayback = () => {}; void next();
}
const events = observeEmoticonEvents(boardMode ? "board" : "effects", event => {
  if (event.type === "state") {
    if (!event.state.enabled) clear();
    board.hidden = !boardMode || !event.state.enabled;
    board.replaceChildren();
    for (const [title, sticker] of [["Clips", false], ["Emoticons (stickers)", true]] as const) {
      const section = document.createElement("section");
      const heading = document.createElement("h2"); heading.textContent = title;
      const list = document.createElement("ul"); section.append(heading, list);
      for (const command of event.state.commands.filter(command => (command.mode === "sticker") === sticker)) {
        const item = document.createElement("li"); const name = document.createElement("strong"); name.textContent = `!${command.command}`; item.append(name);
        list.append(item);
      }
      if (!list.children.length) { const item = document.createElement("li"); item.textContent = "No commands yet"; list.append(item); }
      board.append(section);
    }
  } else if (event.type === "clear") clear();
  else if (!boardMode) { diagnose("emoticons.effect-received", { effectId: event.id, command: event.command.command }); if (event.command.mode === "sticker") spawnSticker(event); else { pending.push(event); void next(); } }
}, () => diagnose("emoticons.events-connected", { transport: "websocket" }),
() => { diagnose("emoticons.events-disconnected"); clear(); board.hidden = true; }, clientId);
window.addEventListener("pagehide", () => { clear(); events.close(); });
