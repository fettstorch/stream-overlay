/** Capture a still at load time; the board never displays an animated media element. */
export async function captureStickerPreview(url: string, video: boolean): Promise<string> {
  const media = video ? document.createElement("video") : new Image();
  if (media instanceof HTMLVideoElement) { media.muted = true; media.preload = "auto"; media.playsInline = true; }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Sticker preview timed out")), 15_000);
    function finish(error?: Error) {
      clearTimeout(timeout); media.onload = media.onerror = null;
      if (media instanceof HTMLVideoElement) { media.onloadeddata = null; media.pause(); media.removeAttribute("src"); media.load(); }
      else media.removeAttribute("src");
      if (error) reject(error);
    }
    const draw = () => {
      try {
        const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
        const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
        if (!width || !height) throw new Error("Sticker preview has no dimensions");
        const scale = Math.min(1, 96 / Math.max(width, height));
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d"); if (!context) throw new Error("Sticker preview canvas unavailable");
        context.drawImage(media, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL("image/png"); finish(); resolve(result);
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    media.onerror = () => finish(new Error("Sticker preview media failed"));
    if (media instanceof HTMLVideoElement) media.onloadeddata = draw; else media.onload = draw;
    media.src = url;
  });
}
