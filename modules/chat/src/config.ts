export interface ChatConfiguration { fadeOut: number }
export const defaultChatConfiguration: ChatConfiguration = { fadeOut: 0 };

export function parseChatConfiguration(value: unknown): ChatConfiguration | null {
  if (!value || typeof value !== "object" || !("fadeOut" in value)
    || typeof value.fadeOut !== "number" || !Number.isFinite(value.fadeOut)
    || value.fadeOut < 0 || value.fadeOut > 100) return null;
  return { fadeOut: value.fadeOut };
}

/** Hide the upper portion of the source, then softly reveal the chat below it. */
export function chatMask(fadeOut: number): string {
  if (fadeOut === 0) return "none";
  if (fadeOut === 100) return "linear-gradient(transparent, transparent)";
  const end = fadeOut + Math.min(8, (100 - fadeOut) / 2);
  return `linear-gradient(to bottom, transparent ${fadeOut}%, black ${end}%)`;
}
