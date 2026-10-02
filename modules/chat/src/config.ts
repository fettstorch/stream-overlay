export interface ChatConfiguration {
  fadeOut: number;
  fontSize: number;
  backgroundColor: string;
  backgroundOpacity: number;
  rotationX: number;
  rotationY: number;
}
export const defaultChatConfiguration: ChatConfiguration = {
  fadeOut: 0, fontSize: 20, backgroundColor: "#000000", backgroundOpacity: 65,
  rotationX: 0, rotationY: 0,
};

export function parseChatConfiguration(value: unknown): ChatConfiguration | null {
  if (!value || typeof value !== "object" || !("fadeOut" in value)
    || typeof value.fadeOut !== "number" || !Number.isFinite(value.fadeOut)
    || value.fadeOut < 0 || value.fadeOut > 100) return null;
  // Existing installations only have fadeOut; missing appearance fields use the old appearance.
  const settings = { ...defaultChatConfiguration, ...value };
  if (typeof settings.fontSize !== "number" || !Number.isFinite(settings.fontSize)
    || settings.fontSize < 8 || settings.fontSize > 72
    || typeof settings.backgroundColor !== "string" || !/^#[0-9a-f]{6}$/i.test(settings.backgroundColor)
    || typeof settings.backgroundOpacity !== "number" || !Number.isFinite(settings.backgroundOpacity)
    || settings.backgroundOpacity < 0 || settings.backgroundOpacity > 100
    || [settings.rotationX, settings.rotationY].some(angle => typeof angle !== "number"
      || !Number.isFinite(angle) || angle < -180 || angle > 180)) return null;
  return { fadeOut: value.fadeOut, fontSize: settings.fontSize,
    backgroundColor: settings.backgroundColor, backgroundOpacity: settings.backgroundOpacity,
    rotationX: settings.rotationX, rotationY: settings.rotationY };
}

export function chatBackground(configuration: ChatConfiguration): string {
  const hex = configuration.backgroundColor.slice(1);
  const rgb = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${rgb.join(", ")}, ${configuration.backgroundOpacity / 100})`;
}

/** Hide the upper portion of the source, then softly reveal the chat below it. */
export function chatMask(fadeOut: number): string {
  if (fadeOut === 0) return "none";
  if (fadeOut === 100) return "linear-gradient(transparent, transparent)";
  const end = fadeOut + Math.min(8, (100 - fadeOut) / 2);
  return `linear-gradient(to bottom, transparent ${fadeOut}%, black ${end}%)`;
}
