export const mediaKinds = ["image", "audio", "video"] as const;
export type MediaKind = (typeof mediaKinds)[number];

export const mediaTypes: Record<string, { kind: MediaKind; type: string }> = {
  gif: { kind: "image", type: "image/gif" },
  png: { kind: "image", type: "image/png" },
  jpg: { kind: "image", type: "image/jpeg" },
  jpeg: { kind: "image", type: "image/jpeg" },
  webp: { kind: "image", type: "image/webp" },
  mp3: { kind: "audio", type: "audio/mpeg" },
  m4a: { kind: "audio", type: "audio/mp4" },
  wav: { kind: "audio", type: "audio/wav" },
  ogg: { kind: "audio", type: "audio/ogg" },
  opus: { kind: "audio", type: "audio/ogg" },
  mp4: { kind: "video", type: "video/mp4" },
  mov: { kind: "video", type: "video/quicktime" },
  webm: { kind: "video", type: "video/webm" },
};
export function extension(value: string) {
  try {
    return new URL(value, "https://local.invalid").pathname
      .match(/\.([a-z0-9]+)$/i)?.[1]
      .toLowerCase();
  } catch {
    return value.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  }
}
export function fileMedia(file: File) {
  const declared = file.type.split(";", 1)[0].trim().toLowerCase();
  const kind: MediaKind | undefined = declared.startsWith("image/")
    ? "image"
    : declared.startsWith("audio/")
      ? "audio"
      : declared.startsWith("video/")
        ? "video"
        : undefined;
  if (kind) return { kind, type: declared === "image/jpg" ? "image/jpeg" : declared };
  return mediaTypes[extension(file.name) ?? ""];
}
export function unsupportedFile(file: File) {
  return `Unsupported file: ${file.name}. Choose an image, GIF, audio, MP4, MOV, or WebM file.`;
}
export function probe(url: string, kind: MediaKind) {
  return new Promise<boolean>((resolve) => {
    const element = kind === "image" ? new Image() : document.createElement(kind);
    const timer = setTimeout(() => finish(false), 4000);
    const finish = (result: boolean) => {
      clearTimeout(timer);
      element.onload = null;
      element.onerror = null;
      if (element instanceof HTMLMediaElement) {
        element.onloadedmetadata = null;
        element.removeAttribute("src");
        element.load();
      }
      resolve(result);
    };
    element.onerror = () => finish(false);
    if (element instanceof HTMLMediaElement) {
      element.preload = "metadata";
      element.onloadedmetadata = () => finish(true);
    } else element.onload = () => finish(true);
    element.src = url;
  });
}
