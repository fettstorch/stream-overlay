import type { EmoticonEvent } from "./contracts.ts";
import { captureStickerPreview } from "./sticker-preview.ts";
import { createStickerAssetCache } from "./asset-cache.ts";
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
const stickerPreviews = new Map<string, Promise<string>>();
const stickerAssets = createStickerAssetCache();
const stickerAvatars = createStickerAssetCache();
type StickerSlot = { container: HTMLDivElement; visual: HTMLDivElement; image: HTMLImageElement; video: HTMLVideoElement; avatar: HTMLImageElement };
const stickerPool: StickerSlot[] = [];
function createStickerSlot(): StickerSlot {
  const container = document.createElement("div"); container.className = "sticker";
  const visual = document.createElement("div"); visual.className = "sticker-media";
  const image = new Image(); const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.loop = true;
  const avatar = new Image(); avatar.className = "sender-avatar";
  container.append(avatar, visual);
  return { container, visual, image, video, avatar };
}
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
function appendAvatar(container: HTMLElement, event: Effect) {
  if (!event.author?.avatar && !event.author?.did) return;
  const avatar = new Image(); avatar.className = "sender-avatar";
  avatar.alt = event.author.displayName || event.author.handle || "Chat sender";
  avatar.src = event.author.avatar || `/api/emoticons/avatar/${encodeURIComponent(event.author.did!)}`;
  avatar.onload = () => diagnose("emoticons.avatar-loaded", { effectId: event.id });
  avatar.onerror = () => { diagnose("emoticons.avatar-failed", { effectId: event.id, authorDid: event.author?.did }); avatar.remove(); };
  container.append(avatar);
  if (container === effect && (event.command.imageAssetId || event.command.videoAssetId)) {
    const tail = new Image(); tail.className = "speech-bubble-tail"; tail.alt = "";
    tail.src = "/overlays/emoticons/speech-bubble-tail.png"; container.append(tail);
  }
}
function spawnSticker(event: Effect) {
  const command = event.command;
  const slot = stickerPool.pop() ?? createStickerSlot();
  const { container, visual, image, video, avatar } = slot;
  let active = true;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    if (!active) return; active = false;
    clearTimeout(expiry); container.onanimationend = null;
    image.onload = image.onerror = avatar.onload = avatar.onerror = video.onerror = null;
    video.pause(); video.removeAttribute("src"); video.load();
    image.removeAttribute("src"); avatar.removeAttribute("src");
    visual.replaceChildren(); container.remove(); stickers.delete(container);
    if (stickerPool.length < 32) stickerPool.push(slot);
  };
  stickers.set(container, remove);
  container.style.width = command.width || "80px"; container.style.height = command.height || "80px";
  visual.style.scale = String(0.4 + Math.random() * 0.6);
  container.style.left = `${5 + Math.random() * 90}%`;
  container.style.setProperty("--drift", `${(Math.random() - .5) * 160}px`);
  container.style.animationDuration = `${event.durationSeconds}s`;
  avatar.hidden = true;
  if (event.author?.avatar || event.author?.did) {
    avatar.alt = event.author.displayName || event.author.handle || "Chat sender";
    avatar.onerror = () => { avatar.hidden = true; diagnose("emoticons.avatar-failed", { effectId: event.id }); };
    avatar.onload = () => diagnose("emoticons.avatar-loaded", { effectId: event.id });
    const source = event.author.did ? `/api/emoticons/avatar/${encodeURIComponent(event.author.did)}` : event.author.avatar!;
    void stickerAvatars.load(source).then(url => {
      if (active) { avatar.src = url; avatar.hidden = false; }
    }).catch(error => { if (active) diagnose("emoticons.avatar-failed", { effectId: event.id, error: String(error) }); });
  }
  const assetId = command.imageAssetId || command.videoAssetId;
  if (!assetId) { remove(); return; }
  void stickerAssets.load(`/api/emoticons/assets/${assetId}`).then(url => {
    if (!active) return;
    const element = command.imageAssetId ? image : video;
    element.onerror = () => { diagnose("emoticons.sticker-media-failed", { effectId: event.id }); remove(); };
    if (element === image) image.alt = command.command;
    element.src = url; visual.append(element);
    container.onanimationend = event => { if (event.target === container) remove(); };
    document.body.append(container);
    expiry = setTimeout(remove, event.durationSeconds * 1000 + 100);
    if (element === video) void video.play().catch(error => {
      if (active) { diagnose("emoticons.sticker-media-failed", { effectId: event.id, error: String(error) }); remove(); }
    });
    diagnose("emoticons.sticker-spawned", { effectId: event.id, command: command.command });
  }).catch(error => {
    if (active) { diagnose("emoticons.sticker-media-failed", { effectId: event.id, error: String(error) }); remove(); }
  });
}
async function next() {
  if (playing) return;
  const event = pending.shift(); if (!event) return;
  diagnose("emoticons.effect-started", { effectId: event.id, command: event.command.command });
  playing = true; const current = generation; const command = event.command;
  appendAvatar(effect, event);
  effect.hidden = false;
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
const cooldownRings = new Map<string, { element: SVGSVGElement; progress: SVGCircleElement; endsAt: number; durationSeconds: number }>();
function updateCooldownRings() {
  for (const ring of cooldownRings.values()) {
    const remaining = Math.max(0, ring.endsAt - Date.now());
    const fraction = ring.durationSeconds > 0 ? Math.min(1, remaining / (ring.durationSeconds * 1000)) : 0;
    ring.progress.setAttribute("stroke-dasharray", `${fraction * 100} 100`);
    ring.progress.setAttribute("stroke-dashoffset", String(-(1 - fraction) * 100));
    ring.element.classList.toggle("cooling-down", remaining > 0);
    ring.element.setAttribute("aria-label", remaining > 0 ? `${Math.ceil(remaining / 1000)} seconds cooldown remaining` : "No cooldown remaining");
  }
}
const cooldownTicker = boardMode ? setInterval(updateCooldownRings, 100) : undefined;
const events = observeEmoticonEvents(boardMode ? "board" : "effects", event => {
  if (event.type === "state") {
    stickerAssets.retain(new Set(event.state.assets.map(asset => `/api/emoticons/assets/${asset.id}`)));
    for (const id of stickerPreviews.keys()) if (!event.state.assets.some(asset => asset.id === id)) stickerPreviews.delete(id);
    if (!event.state.enabled) clear();
    board.hidden = !boardMode || !event.state.enabled;
    board.replaceChildren(); cooldownRings.clear();
    for (const [title, sticker] of [["Clips", false], ["Stickers", true]] as const) {
      const section = document.createElement("section");
      const heading = document.createElement("h2"); heading.textContent = title;
      const list = document.createElement("ul"); section.append(heading, list);
      for (const command of event.state.commands.filter(command => (command.mode === "sticker") === sticker)) {
        const item = document.createElement("li"); const name = document.createElement("strong"); name.textContent = `!${command.command}`; item.append(name);
        if (boardMode && sticker) {
          const assetId = command.imageAssetId || command.videoAssetId;
          if (assetId) {
            const preview = new Image(); preview.className = "sticker-preview"; preview.alt = ""; item.append(preview);
            let captured = stickerPreviews.get(assetId);
            if (!captured) {
              captured = stickerAssets.load(`/api/emoticons/assets/${assetId}`).then(url => captureStickerPreview(url, Boolean(command.videoAssetId)));
              stickerPreviews.set(assetId, captured);
              const pending = captured;
              void captured.catch(() => { if (stickerPreviews.get(assetId) === pending) stickerPreviews.delete(assetId); });
            }
            void captured.then(url => { if (preview.isConnected) preview.src = url; }).catch(error => {
              preview.remove(); diagnose("emoticons.sticker-preview-failed", { assetId, error: String(error) });
            });
          }
        }
        if (!sticker && command.cooldownSeconds > 0) {
          const ns = "http://www.w3.org/2000/svg";
          const ring = document.createElementNS(ns, "svg"); ring.classList.add("cooldown-ring"); ring.setAttribute("viewBox", "0 0 24 24"); ring.setAttribute("role", "img");
          const track = document.createElementNS(ns, "circle"); const progress = document.createElementNS(ns, "circle");
          for (const circle of [track, progress]) { circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "9"); circle.setAttribute("pathLength", "100"); }
          progress.classList.add("cooldown-progress"); ring.append(track, progress); item.append(ring);
          const cooldown = event.state.cooldowns?.[command.id];
          cooldownRings.set(command.id, { element: ring, progress, endsAt: cooldown?.endsAt ?? 0, durationSeconds: cooldown?.durationSeconds ?? command.cooldownSeconds });
        }
        list.append(item);
      }
      if (!list.children.length) { const item = document.createElement("li"); item.textContent = "No commands yet"; list.append(item); }
      board.append(section);
    }
    updateCooldownRings();
    if (boardMode) diagnose("emoticons.board-cooldowns-updated", { activeCooldowns: [...cooldownRings.values()].filter(ring => ring.endsAt > Date.now()).length });
  } else if (event.type === "clear") { clear(); for (const ring of cooldownRings.values()) ring.endsAt = 0; updateCooldownRings(); }
  else if (!boardMode) { diagnose("emoticons.effect-received", { effectId: event.id, command: event.command.command }); if (event.command.mode === "sticker") spawnSticker(event); else { pending.push(event); void next(); } }
}, () => diagnose("emoticons.events-connected", { transport: "websocket" }),
() => { diagnose("emoticons.events-disconnected"); clear(); board.hidden = true; }, clientId);
window.addEventListener("pagehide", () => { clear(); clearInterval(cooldownTicker); events.close(); stickerPool.length = 0; stickerAssets.clear(); stickerAvatars.clear(); stickerPreviews.clear(); });
