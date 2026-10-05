/** Best-effort muting for same-origin previews; remote players need their own mute option. */
export function mutePreview(frame: HTMLIFrameElement): () => void {
  const cleanups: Array<() => void> = [];
  const documents = new Set<Document>();
  const mute = (media: HTMLMediaElement) => {
    media.defaultMuted = true;
    if (!media.muted) media.muted = true;
  };
  const visit = (iframe: HTMLIFrameElement) => {
    try {
      const document = iframe.contentDocument;
      if (!document || documents.has(document)) return;
      documents.add(document);
      document.querySelectorAll<HTMLMediaElement>("audio, video").forEach(mute);
      document.querySelectorAll<HTMLIFrameElement>("iframe").forEach(visit);
      const onMedia = (event: Event) => {
        const target = event.target as HTMLMediaElement | null;
        if (target?.tagName === "VIDEO" || target?.tagName === "AUDIO") mute(target);
      };
      const onLoad = (event: Event) => {
        const target = event.target as HTMLIFrameElement | null;
        if (target?.tagName === "IFRAME") visit(target);
      };
      document.addEventListener("play", onMedia, true);
      document.addEventListener("volumechange", onMedia, true);
      document.addEventListener("load", onLoad, true);
      cleanups.push(() => {
        document.removeEventListener("play", onMedia, true);
        document.removeEventListener("volumechange", onMedia, true);
        document.removeEventListener("load", onLoad, true);
      });
    } catch { /* Browsers prevent access to cross-origin iframe documents. */ }
  };
  visit(frame);
  return () => { cleanups.forEach(cleanup => cleanup()); documents.clear(); };
}
