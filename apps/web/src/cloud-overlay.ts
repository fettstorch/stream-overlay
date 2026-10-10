import { RelayClient } from "@streamface/browser-runtime";
import { DirectStreamChatService } from "@streamface/stream-chat";
import { EmoticonRuntime } from "@streamface/emoticons/src/runtime.ts";
import { createRoleAuthorizer } from "../../../modules/emoticons/src/roles.ts";
import type { EmoticonCommand, EmoticonEvent, EmoticonState } from "@streamface/emoticons/src/contracts.ts";
import type { RelaySnapshot, EffectDiagnostic } from "@streamface/protocol";
import { createCloudBoard } from "./cloud-board.ts";
import { effectTop, mediaObjectFit } from "../../../modules/emoticons/src/media-layout.ts";
import { loadPublicActorProfile } from "./actor-search.ts";
import tailUrl from "../../../modules/emoticons/assets/speech-bubble-tail.png";
import { createStickerAssetCache } from "../../../modules/emoticons/src/asset-cache.ts";
import { createGiphyPreloader } from "./giphy.ts";

const boardMode = location.pathname.startsWith("/board"); const did = new URLSearchParams(location.search).get("did") ?? ""; const channel = new URLSearchParams(location.search).get("preview") === "1" ? "preview" : "live";
if (!did.startsWith("did:")) document.body.textContent = "Missing ?did= account identifier";
const container = document.querySelector<HTMLElement>(boardMode ? ".board" : ".effect")!; let config: EmoticonState = { enabled: false, commands: [], assets: [] }; let cooldowns: RelaySnapshot["cooldowns"] = {}; let revision = 0;
const testRequests = new Map<string, string>();
let configLoaded = false, relayRegistered = false;
function markPreviewReady() { document.documentElement.dataset.overlayReady = String(configLoaded && relayRegistered); }
let cooldownRequestId: string | undefined;
const board = boardMode ? createCloudBoard(container) : undefined;
const muted = new URLSearchParams(location.search).get("muted") === "1";
const activeMedia = new Set<HTMLMediaElement>(), activeWrappers = new Set<HTMLElement>();
const effectAssets = createStickerAssetCache();
const giphyAssets = createGiphyPreloader();
let preloadedGiphyIds = new Set<string>();
let preloadedSources = new Set<string>();
let playbackGeneration = 0;
let soundButton: HTMLButtonElement | undefined;
function clearPlayback() { playbackGeneration++; for (const media of activeMedia) media.pause(); activeMedia.clear(); for (const wrapper of activeWrappers) wrapper.remove(); activeWrappers.clear(); soundButton?.remove(); soundButton = undefined; }
const fallbackAvatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#36425d"/><circle cx="32" cy="23" r="12" fill="#bdc8df"/><path d="M10 60v-6a22 22 0 0 1 44 0v6" fill="#bdc8df"/></svg>')}`;
function offerSound() {
  if (muted || soundButton) return;
  soundButton = Object.assign(document.createElement("button"), { type: "button", textContent: "Enable sound" }); soundButton.className = "enable-sound";
  soundButton.onclick = () => { for (const element of activeMedia) { element.muted = false; void element.play().catch(() => diagnostic("media-failed", { reason: "sound-enable-failed" })); } soundButton?.remove(); soundButton = undefined; };
  document.body.append(soundButton);
}
let rejectionReason: string | undefined;
const moderationLogTimes = new Map<string, number>();
function moderationDiagnostic(event: "moderation-accepted" | "moderation-rejected", details: Omit<EffectDiagnostic, "type" | "event">) {
  const key = `${event}:${details.reason ?? "accepted"}`;
  const now = Date.now();
  // Chat spam must not itself flood the relay or the log sink.
  if (now - (moderationLogTimes.get(key) ?? -Infinity) < 5000) return;
  moderationLogTimes.set(key, now);
  diagnostic(event, details);
}
function diagnostic(event: EffectDiagnostic["event"], details: Omit<EffectDiagnostic, "type" | "event"> = {}) { relay.send({ type: "diagnostic", event, ...details }); }
function renderBoard() { board?.render({ ...config, cooldowns }); }
async function play(event: Extract<EmoticonEvent, { type: "effect" }>) {
  const command = { ...event.command };
  const requestId = testRequests.get(command.id); testRequests.delete(command.id);
  const context = { requestId, commandId: command.id };
  const generation = playbackGeneration;
  try {
    if (command.imageGiphyId) command.imageUrl = await giphyAssets.load(command.imageGiphyId);
    await Promise.all((["imageUrl", "videoUrl", "audioUrl"] as const).map(async key => {
      if (key === "imageUrl" && command.imageGiphyId) return;
      if (command[key]) command[key] = await effectAssets.load(command[key]!);
    }));
  } catch {
    diagnostic("media-failed", { ...context, reason: "asset-download-failed" });
    throw new Error("Asset download failed");
  }
  if (generation !== playbackGeneration) return;
  const visual = command.videoUrl ? document.createElement("video") : command.imageUrl ? new Image() : undefined; const audio = command.audioUrl ? document.createElement("audio") : undefined;
  if (!visual && !audio) { diagnostic("media-missing", context); return; }
  const startedLoading = performance.now();
  const readiness = [visual, audio].filter((element): element is NonNullable<typeof element> => Boolean(element)).map(element => new Promise<void>((resolve, reject) => {
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("media-load-failed")); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("media-load-timeout")); }, 60_000);
    const name = element instanceof HTMLMediaElement ? "loadeddata" : "load";
    function cleanup() { clearTimeout(timeout); element.removeEventListener(name, loaded); element.removeEventListener("error", failed); }
    element.addEventListener(name, loaded, { once: true });
    element.addEventListener("error", failed, { once: true });
  }));
  for (const element of [visual, audio]) if (element) {
    element.addEventListener("error", () => diagnostic("media-failed", { ...context, reason: element instanceof HTMLMediaElement ? `media-error-${element.error?.code ?? 0}` : "image-error" }), { once: true });
    element.addEventListener(element instanceof HTMLMediaElement ? "loadeddata" : "load", () => diagnostic("media-loaded", context), { once: true });
  }
  if (visual) { visual.src = command.videoUrl ?? command.imageUrl!; const custom = Boolean(command.width || command.height); visual.style.width = command.width || (custom ? "auto" : command.mode === "sticker" ? "5vw" : "auto"); visual.style.height = command.height || (custom ? "auto" : command.mode === "sticker" ? "5vw" : "auto"); visual.style.maxWidth = custom || command.mode === "sticker" ? "none" : "40vw"; visual.style.maxHeight = custom || command.mode === "sticker" ? "none" : "35vh"; visual.style.objectFit = mediaObjectFit(command.width, command.height); visual.style.transform = command.mirrored ? "scaleX(-1)" : "none"; if (visual instanceof HTMLVideoElement) { visual.autoplay = true; visual.playsInline = true; visual.loop = command.mode === "sticker"; visual.muted = muted || command.mode === "sticker"; visual.volume = command.volume; } }
  if (audio) { audio.src = command.audioUrl!; audio.autoplay = true; audio.muted = muted; audio.volume = command.volume; }
  const wrapper = document.createElement("div"); wrapper.hidden = true; if (visual) wrapper.append(visual); if (audio) wrapper.append(audio);
  if (event.author) {
    const avatar = new Image(); avatar.className = "sender-avatar"; avatar.alt = event.author.displayName || event.author.handle || "Chat sender"; avatar.src = event.author.avatar || fallbackAvatar;
    avatar.onerror = () => { avatar.onerror = null; avatar.src = fallbackAvatar; diagnostic("media-failed", { ...context, reason: "avatar-failed" }); };
    avatar.onload = () => diagnostic("media-loaded", { ...context, reason: "avatar" });
    wrapper.append(avatar);
    if (!event.author.avatar && event.author.did) void loadPublicActorProfile(event.author.did).then(profile => { if (wrapper.isConnected && profile.avatar) avatar.src = profile.avatar; }).catch(() => {});
    if (command.mode !== "sticker" && visual) { const tail = new Image(); tail.className = "speech-bubble-tail"; tail.src = tailUrl; tail.alt = ""; wrapper.append(tail); }
  }
  if (command.mode === "sticker") {
    wrapper.className = "sticker";
    wrapper.style.left = `${5 + Math.random()*90}%`;
    wrapper.style.setProperty("--drift", `${(Math.random()-.5)*160}px`);
    wrapper.style.animationDuration = `${event.durationSeconds}s`;
    if (visual) {
      const media = document.createElement("div");
      media.className = "sticker-media";
      media.style.transformOrigin = "left center";
      media.style.scale = String(.4 + Math.random() * .6);
      // Scale independently of the media's centered mirror transform.
      visual.replaceWith(media);
      media.append(visual);
    }
    container.append(wrapper);
  }
  else { wrapper.className = "clip"; wrapper.style.top = effectTop(command.height); container.append(wrapper); }
  activeWrappers.add(wrapper);
  for (const element of [visual, audio]) if (element instanceof HTMLMediaElement) {
    element.autoplay = false; element.preload = "auto"; activeMedia.add(element);
  }
  try { await Promise.all(readiness); }
  catch (error) {
    diagnostic("media-failed", { ...context, reason: error instanceof Error ? error.message : "media-load-failed" });
    for (const element of [visual, audio]) if (element instanceof HTMLMediaElement) { element.pause(); activeMedia.delete(element); }
    wrapper.remove(); activeWrappers.delete(wrapper);
    throw error;
  }
  if (!activeWrappers.has(wrapper)) return;
  wrapper.hidden = false;
  diagnostic("playback-started", { ...context, reason: `ready-after-${Math.round(performance.now() - startedLoading)}ms` });
  for (const element of [visual, audio]) if (element instanceof HTMLMediaElement) { activeMedia.add(element); void element.play().catch(error => { diagnostic("media-failed", { ...context, reason: error instanceof Error ? error.name : "play-failed" }); if (error instanceof Error && error.name === "NotAllowedError" && !muted) { offerSound(); if (element instanceof HTMLVideoElement) { element.muted = true; void element.play().catch(() => {}); } } }); }
  if (command.mode === "sticker" && visual) setTimeout(() => {
    if (!wrapper.isConnected) return;
    const rect = visual.getBoundingClientRect();
    const position = rect.bottom < 0 ? "above" : rect.top > innerHeight ? "below" : "in-viewport";
    diagnostic("playback-started", { ...context, count: Math.min(200, wrapper.getAnimations().length), reason: `${position}-top-${Math.round(rect.top)}-height-${Math.round(rect.height)}-viewport-${innerHeight}` });
  }, 250);
  setTimeout(() => { for (const element of wrapper.querySelectorAll("audio,video")) { (element as HTMLMediaElement).pause(); activeMedia.delete(element as HTMLMediaElement); } wrapper.remove(); activeWrappers.delete(wrapper); }, event.durationSeconds * 1000);
}
function nextRevision() { revision = Math.max(revision + 1, Date.now()); return revision; }
const authorize = createRoleAuthorizer();
const runtime = boardMode ? undefined : new EmoticonRuntime({ effect: play, authorize: (author, roles) => authorize(did, author, roles), log: (event, details) => {
  if (event === "emoticons.command-rejected") {
    rejectionReason = String(details?.reason ?? "unknown");
    if (["user-blocked", "user-cooldown", "role-not-allowed", "role-lookup-failed"].includes(rejectionReason))
      moderationDiagnostic("moderation-rejected", { commandId: String(details?.commandId), reason: rejectionReason });
  }
  if (event === "emoticons.moderation-accepted") moderationDiagnostic("moderation-accepted", { commandId: String(details?.commandId) });
}, cooldowns: state => { cooldowns = state; relay.send({ type: "cooldowns", revision: nextRevision(), cooldowns: state, requestId: cooldownRequestId }); } });
const chat = boardMode ? undefined : new DirectStreamChatService(); chat?.messages.subscribe(message => runtime?.message(message.id, message.text, message.author));
async function refresh(force = false) {
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(did)}/config${force ? "?refresh=1" : ""}`, { cache: "no-store" });
    if (!response.ok) { if (!boardMode) diagnostic("config-failed", { requestId: response.headers.get("x-request-id") ?? undefined, reason: `http-${response.status}` }); return; }
    const cloud = await response.json() as import("./cloud-admin-types.ts").CloudConfig;
    const commands: EmoticonCommand[] = cloud.commands.map(command => ({ ...command, imageAssetId: null, audioAssetId: null, videoAssetId: null, imageUrl: command.image?.url, imageGiphyId: command.image?.giphyId, audioUrl: command.audio?.url, videoUrl: command.video?.url }));
    const giphyIds = new Set(commands.flatMap(command => command.imageGiphyId ? [command.imageGiphyId] : []));
    giphyAssets.retain(giphyIds);
    preloadedGiphyIds = new Set([...preloadedGiphyIds].filter(id => giphyIds.has(id)));
    for (const command of commands) if (command.imageGiphyId) {
      const id = command.imageGiphyId;
      void giphyAssets.load(command.imageGiphyId).then(url => {
        command.imageUrl = url;
        if (!boardMode && !preloadedGiphyIds.has(id)) {
          preloadedGiphyIds.add(id);
          diagnostic("media-loaded", { commandId: command.id, reason: "giphy-preload-ready" });
        }
        if (config.commands === commands) renderBoard();
      }).catch(() => {
        if (!boardMode) diagnostic("media-failed", { commandId: command.id, reason: "giphy-preload-failed" });
      });
    }
    if (!boardMode) {
      const sources = new Set(commands.flatMap(command => [command.imageGiphyId ? undefined : command.imageUrl, command.videoUrl, command.audioUrl].filter((source): source is string => Boolean(source))));
      effectAssets.retain(sources);
      for (const source of sources) if (!preloadedSources.has(source)) {
        preloadedSources.add(source);
        const started = performance.now();
        void effectAssets.load(source).then(() => {
          diagnostic("media-loaded", { reason: `preload-ready-${Math.round(performance.now() - started)}ms` });
        }).catch(() => {
          preloadedSources.delete(source);
          diagnostic("media-failed", { reason: "preload-download-failed" });
        });
      }
      preloadedSources = new Set([...preloadedSources].filter(source => sources.has(source)));
    }
    config = { enabled: cloud.enabled, commands, assets: [], cooldowns, moderation: cloud.moderation, roles: cloud.roles };
    runtime?.configure(config);
    configLoaded = true; markPreviewReady();
    if (!cloud.enabled) clearPlayback();
    chat?.setStreamerDid(cloud.enabled ? cloud.streamerDid : ""); renderBoard();
    if (!boardMode) diagnostic("config-loaded", { count: commands.length, reason: cloud.enabled ? "enabled" : "disabled" });
  } catch { if (!boardMode) diagnostic("config-failed", { reason: "fetch-or-parse-error" }); }
}
const relay = new RelayClient(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/relay`, { type: "hello", did, page: boardMode ? "board" : "effect", channel }, message => {
  if (message.type === "snapshot") { relayRegistered = true; markPreviewReady(); }
  if (message.type === "snapshot" && boardMode && message.revision >= revision) { revision = message.revision; cooldowns = message.cooldowns; renderBoard(); diagnostic("cooldowns-received", { requestId: message.requestId, count: Object.keys(cooldowns).length }); }
  if (message.type === "config-changed") void refresh(true);
  // Tests use the same browser-owned runtime and cooldowns as chat commands.
  if (message.type === "test-command" && runtime) {
    diagnostic("test-received", { requestId: message.requestId, commandId: message.commandId });
    testRequests.set(message.commandId, message.requestId); rejectionReason = undefined;
    cooldownRequestId = message.requestId;
    const accepted = runtime.trigger(message.commandId);
    cooldownRequestId = undefined;
    diagnostic(accepted ? "test-accepted" : "test-rejected", { requestId: message.requestId, commandId: message.commandId, reason: accepted ? undefined : rejectionReason });
    if (!accepted) testRequests.delete(message.commandId);
  }
}, () => { if (!boardMode) relay.send({ type: "cooldowns", revision: nextRevision(), cooldowns }); });
void refresh(); const poll = setInterval(() => void refresh(true), 60_000); addEventListener("pagehide", () => { clearInterval(poll); relay.close(); chat?.stop(); runtime?.clear(); clearPlayback(); effectAssets.clear(); giphyAssets.clear(); board?.close(); });
