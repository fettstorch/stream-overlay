import { awaitable } from "@fettstorch/jule";
import type { EffectDiagnostic } from "@streamface/protocol";
import type { EmoticonEvent } from "@streamface/emoticons/src/contracts.ts";
import { effectTop, applyMediaLayout } from "../../../modules/emoticons/src/media-layout.ts";
import { loadPublicActorProfile } from "./actor-search.ts";
import tailUrl from "../../../modules/emoticons/assets/speech-bubble-tail.png";
import type { createStickerAssetCache } from "../../../modules/emoticons/src/asset-cache.ts";
import type { createGiphyPreloader } from "./giphy.ts";

type Diagnostic = (
  event: EffectDiagnostic["event"],
  details?: Omit<EffectDiagnostic, "type" | "event">,
) => void;

/** Own the cloud player's media lifecycle independently of configuration and relay state. */
export function createEmotePlayer(
  container: HTMLElement,
  diagnostic: Diagnostic,
  effectAssets: ReturnType<typeof createStickerAssetCache>,
  giphyAssets: ReturnType<typeof createGiphyPreloader>,
) {
  const abortReadiness = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }
  const muted = new URLSearchParams(location.search).get("muted") === "1";
  const activeMedia = new Set<HTMLMediaElement>(),
    activeWrappers = new Set<HTMLElement>();
  let playbackGeneration = 0;
  let soundButton: HTMLButtonElement | undefined;
  function clearPlayback() {
    playbackGeneration++;
    for (const abort of abortReadiness) abort();
    abortReadiness.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const media of activeMedia) media.pause();
    activeMedia.clear();
    for (const wrapper of activeWrappers) wrapper.remove();
    activeWrappers.clear();
    soundButton?.remove();
    soundButton = undefined;
  }
  const fallbackAvatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#36425d"/><circle cx="32" cy="23" r="12" fill="#bdc8df"/><path d="M10 60v-6a22 22 0 0 1 44 0v6" fill="#bdc8df"/></svg>')}`;
  function offerSound() {
    if (muted || soundButton) return;
    soundButton = Object.assign(document.createElement("button"), {
      type: "button",
      textContent: "Enable sound",
    });
    soundButton.className = "enable-sound";
    soundButton.onclick = () => {
      for (const element of activeMedia) {
        element.muted = false;
        void element
          .play()
          .catch(() => diagnostic("media-failed", { reason: "sound-enable-failed" }));
      }
      soundButton?.remove();
      soundButton = undefined;
    };
    container.append(soundButton);
  }
  async function play(event: Extract<EmoticonEvent, { type: "effect" }>, requestId?: string) {
    const command = { ...event.command };
    const context = { requestId, commandId: command.id };
    const generation = playbackGeneration;
    try {
      if (command.imageGiphyId) command.imageUrl = await giphyAssets.load(command.imageGiphyId);
      await Promise.all(
        (["imageUrl", "videoUrl", "audioUrl"] as const).map(async (key) => {
          if (key === "imageUrl" && command.imageGiphyId) return;
          if (!command[key]) return;
          const cachedUrl = await effectAssets.load(command[key]!);
          // Keep native media on its original URL. In Firefox, some audible
          // MP4s resolve play() on a Blob URL but remain stuck at time zero.
          if (key === "imageUrl") command[key] = cachedUrl;
        }),
      );
    } catch {
      diagnostic("media-failed", { ...context, reason: "asset-download-failed" });
      throw new Error("Asset download failed");
    }
    if (generation !== playbackGeneration) return;
    const visual = command.videoUrl
      ? document.createElement("video")
      : command.imageUrl
        ? new Image()
        : undefined;
    const audio = command.audioUrl ? document.createElement("audio") : undefined;
    if (!visual && !audio) {
      diagnostic("media-missing", context);
      return;
    }
    const startedLoading = performance.now();
    const readiness = [visual, audio]
      .filter((element): element is NonNullable<typeof element> => Boolean(element))
      .map(
        (element) =>
          new Promise<void>((resolve, reject) => {
            const loaded = () => {
              cleanup();
              resolve();
            };
            const failed = () => {
              cleanup();
              reject(new Error("media-load-failed"));
            };
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error("media-load-timeout"));
            }, 60_000);
            const name = element instanceof HTMLMediaElement ? "loadeddata" : "load";
            const abort = () => {
              cleanup();
              reject(new Error("playback-canceled"));
            };
            abortReadiness.add(abort);
            function cleanup() {
              abortReadiness.delete(abort);
              clearTimeout(timeout);
              element.removeEventListener(name, loaded);
              element.removeEventListener("error", failed);
            }
            element.addEventListener(name, loaded, { once: true });
            element.addEventListener("error", failed, { once: true });
          }),
      );
    for (const element of [visual, audio])
      if (element) {
        element.addEventListener(
          "error",
          () =>
            diagnostic("media-failed", {
              ...context,
              reason:
                element instanceof HTMLMediaElement
                  ? `media-error-${element.error?.code ?? 0}`
                  : "image-error",
            }),
          { once: true },
        );
        element.addEventListener(
          element instanceof HTMLMediaElement ? "loadeddata" : "load",
          () => diagnostic("media-loaded", {
            ...context,
            reason: element instanceof HTMLVideoElement ? "video" : element instanceof HTMLAudioElement ? "audio" : "image",
          }),
          { once: true },
        );
      }
    if (visual) {
      visual.src = command.videoUrl ?? command.imageUrl!;
      applyMediaLayout(visual, command, command.mode === "sticker");
      if (visual instanceof HTMLVideoElement) {
        visual.autoplay = false;
        visual.playsInline = true;
        visual.loop = command.mode === "sticker";
        visual.muted = muted || command.mode === "sticker";
        visual.volume = command.volume;
      }
    }
    if (audio) {
      audio.src = command.audioUrl!;
      audio.autoplay = false;
      audio.muted = muted;
      audio.volume = command.volume;
    }
    const wrapper = document.createElement("div");
    wrapper.hidden = true;
    if (visual) wrapper.append(visual);
    if (audio) wrapper.append(audio);
    if (event.author) {
      const avatar = new Image();
      avatar.className = "sender-avatar";
      avatar.alt = event.author.displayName || event.author.handle || "Chat sender";
      avatar.src = event.author.avatar || fallbackAvatar;
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = fallbackAvatar;
        diagnostic("media-failed", { ...context, reason: "avatar-failed" });
      };
      avatar.onload = () => diagnostic("media-loaded", { ...context, reason: "avatar" });
      wrapper.append(avatar);
      if (!event.author.avatar && event.author.did)
        void loadPublicActorProfile(event.author.did)
          .then((profile) => {
            if (wrapper.isConnected && profile.avatar) avatar.src = profile.avatar;
          })
          .catch(() => {});
      if (command.mode !== "sticker" && visual) {
        const tail = new Image();
        tail.className = "speech-bubble-tail";
        tail.src = tailUrl;
        tail.alt = "";
        wrapper.append(tail);
      }
    }
    if (command.mode === "sticker") {
      wrapper.className = "sticker";
      wrapper.style.left = `${5 + Math.random() * 90}%`;
      wrapper.style.setProperty("--drift", `${(Math.random() - 0.5) * 160}px`);
      wrapper.style.animationDuration = `${event.durationSeconds}s`;
      if (visual) {
        const media = document.createElement("div");
        media.className = "sticker-media";
        media.style.transformOrigin = "left center";
        media.style.scale = String(0.4 + Math.random() * 0.6);
        // Scale independently of the media's centered mirror transform.
        visual.replaceWith(media);
        media.append(visual);
      }
      container.append(wrapper);
    } else {
      wrapper.className = "clip";
      wrapper.style.top = effectTop(command.height);
      if (event.eventText) {
        const text = document.createElement("p");
        text.className = "event-text";
        text.textContent = event.eventText;
        wrapper.append(text);
      }
      container.append(wrapper);
    }
    activeWrappers.add(wrapper);
    for (const element of [visual, audio])
      if (element instanceof HTMLMediaElement) {
        element.autoplay = false;
        element.preload = "auto";
        activeMedia.add(element);
      }
    const media = [visual, audio].filter(
      (element): element is HTMLMediaElement => element instanceof HTMLMediaElement,
    );
    try {
      await Promise.all(readiness);
      if (!activeWrappers.has(wrapper)) return;
      // Allow decoding without revealing the first frame or starting animation.
      wrapper.style.visibility = "hidden";
      wrapper.style.animationPlayState = "paused";
      wrapper.hidden = false;
      const started = awaitable();
      const abort = () => started.reject(new Error("playback-canceled"));
      const timeout = setTimeout(() => started.reject(new Error("media-play-timeout")), 60_000);
      abortReadiness.add(abort);
      void Promise.all(
        media.map(async (element) => {
          try {
            await element.play();
          } catch (error) {
            diagnostic("media-failed", {
              ...context,
              reason: error instanceof Error ? error.name : "play-failed",
            });
            if (error instanceof Error && error.name === "NotAllowedError" && !muted) {
              offerSound();
              if (element instanceof HTMLVideoElement) {
                element.muted = true;
                await element.play();
              }
            } else throw error;
          }
        }),
      ).then(() => started.resolve(), started.reject);
      await started.finally(() => {
        clearTimeout(timeout);
        abortReadiness.delete(abort);
      });
    } catch (error) {
      diagnostic("media-failed", {
        ...context,
        reason: error instanceof Error ? error.message : "media-play-failed",
      });
      for (const element of media) {
        element.pause();
        activeMedia.delete(element);
      }
      wrapper.remove();
      activeWrappers.delete(wrapper);
      throw error;
    }
    if (!activeWrappers.has(wrapper)) return;
    wrapper.style.visibility = "";
    wrapper.style.animationPlayState = "";
    diagnostic("playback-started", {
      ...context,
      reason: `playing-after-${Math.round(performance.now() - startedLoading)}ms`,
    });
    for (const element of media) {
      const initialTime = element.currentTime;
      // play() resolving alone does not show whether the media clock advances.
      // Report once per playback, through the same relay as the start event.
      later(() => {
        if (!wrapper.isConnected) return;
        const advanced = element.currentTime > initialTime || element.ended;
        const kind = element instanceof HTMLVideoElement ? "video" : "audio";
        diagnostic(advanced ? "media-loaded" : "media-failed", {
          ...context,
          reason: `${kind}-${advanced ? "progress" : "no-progress"}-ms-${Math.max(0, Math.round(element.currentTime * 1000))}-ready-${element.readyState}-network-${element.networkState}-paused-${Number(element.paused)}-ended-${Number(element.ended)}`,
        });
      }, Math.min(1000, event.durationSeconds * 500));
    }
    if (command.mode === "sticker" && visual)
      later(() => {
        if (!wrapper.isConnected) return;
        const rect = visual.getBoundingClientRect();
        const position =
          rect.bottom < 0 ? "above" : rect.top > innerHeight ? "below" : "in-viewport";
        diagnostic("playback-started", {
          ...context,
          count: Math.min(200, wrapper.getAnimations().length),
          reason: `${position}-top-${Math.round(rect.top)}-height-${Math.round(rect.height)}-viewport-${innerHeight}`,
        });
      }, 250);
    later(() => {
      for (const element of wrapper.querySelectorAll("audio,video")) {
        (element as HTMLMediaElement).pause();
        activeMedia.delete(element as HTMLMediaElement);
      }
      wrapper.remove();
      activeWrappers.delete(wrapper);
    }, event.durationSeconds * 1000);
  }
  return { play, clear: clearPlayback };
}
