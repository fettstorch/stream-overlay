import type { CloudCommand, CloudMedia } from "./cloud-contracts.ts";

export const commandNamePattern = /^[a-z0-9_-]{1,40}$/;
export const commandNameHint = "Use 1–40 letters, numbers, underscores or hyphens";
const dimensionPattern = /^(?:|auto|(?:\d+(?:\.\d+)?)(?:px|%|vw|vh|vmin|vmax|em|rem))$/;
export function validDimension(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && dimensionPattern.test(value.trim());
}
export function validateMediaUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
  } catch {
    /* Invalid URLs are validation failures, not runtime errors. */
  }
}
function validateMedia(value: CloudMedia | undefined) {
  if (!value) return;
  if (value.url && !value.blob) {
    if (!validateMediaUrl(value.url)) throw new Error("Media URLs must use HTTPS");
    return;
  }
  const blob = value.blob;
  if (
    !blob ||
    blob.$type !== "blob" ||
    typeof blob.ref?.$link !== "string" ||
    !/^[a-z0-9]+$/i.test(blob.ref.$link) ||
    typeof blob.mimeType !== "string" ||
    !/^(image|audio|video)\/[A-Za-z0-9.+-]+$/.test(blob.mimeType) ||
    !Number.isSafeInteger(blob.size) ||
    blob.size < 0 ||
    blob.size > 10_000_000
  )
    throw new Error("Invalid media blob");
}
/** Same validation in the admin and server. Reading legacy records may allow absent media. */
export function validateCloudCommand(value: CloudCommand, requireMedia = true) {
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.command !== "string" ||
    !/^[A-Za-z0-9._~:@!$&'()*+,;=-]{1,128}$/.test(value.id) ||
    !commandNamePattern.test(value.command) ||
    !["effect", "sticker"].includes(value.mode)
  )
    throw new Error("Invalid command");
  if (
    !Number.isFinite(value.durationSeconds) ||
    !Number.isFinite(value.cooldownSeconds) ||
    !Number.isFinite(value.volume) ||
    !(value.durationSeconds > 0 && value.durationSeconds <= 3600) ||
    !(value.cooldownSeconds >= 0 && value.cooldownSeconds <= 86400) ||
    !(value.volume >= 0 && value.volume <= 1)
  )
    throw new Error("Invalid playback settings");
  if (
    !validDimension(value.width) ||
    !validDimension(value.height) ||
    typeof value.mirrored !== "boolean"
  )
    throw new Error("Use CSS sizes such as 300px, 40vw, 25vh, 50%, or auto");
  for (const media of [value.image, value.audio, value.video]) validateMedia(media);
  if (value.mode === "sticker" && value.audio) throw new Error("Stickers cannot include audio");
  if (value.image && value.video) throw new Error("Choose an image or video for the visual");
  if (requireMedia && !value.image && !value.video && !value.audio)
    throw new Error("Add an image, audio, or video before saving");
}
