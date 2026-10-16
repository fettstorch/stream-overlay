export function effectTop(height: string) {
  return /^100(?:\.0+)?vh$/i.test(height.trim()) ? "0" : "5vh";
}

export function mediaObjectFit(width: string, height: string) {
  return width.trim() && height.trim() ? "fill" : "contain";
}

/** Shared visual sizing; callers retain positioning and playback ownership. */
export function applyMediaLayout(
  element: HTMLImageElement | HTMLVideoElement,
  command: { width: string; height: string; mirrored?: boolean },
  sticker: boolean,
) {
  const custom = Boolean(command.width || command.height);
  element.style.transform = command.mirrored ? "scaleX(-1)" : "none";
  element.style.width = custom ? command.width || "auto" : sticker ? "5vw" : "auto";
  element.style.height = custom ? command.height || "auto" : sticker ? "5vw" : "auto";
  element.style.objectFit = mediaObjectFit(command.width, command.height);
  element.style.maxWidth = custom || sticker ? "none" : "40vw";
  element.style.maxHeight = custom || sticker ? "none" : "35vh";
}
