export const emoteEvents = [
  { id: "teleport-arrival", name: "Teleport arrival", description: "Another streamer teleports their viewers to your stream." },
  { id: "teleport-canceled", name: "Teleport canceled", description: "An incoming teleport is deleted, denied or expires." },
  { id: "stream-started", name: "Stream started", description: "Your stream becomes live while this browser source is connected." },
  { id: "stream-ended", name: "Stream ended", description: "Your live stream ends while this browser source is connected." },
] as const;
export type EmoteEventType = typeof emoteEvents[number]["id"];
export type EmoteEventMapping = { event: EmoteEventType; commandId: string };
export function validateEventMappings(value: unknown): asserts value is EmoteEventMapping[] {
  if (!Array.isArray(value) || value.length > emoteEvents.length) throw new Error("Invalid Emote event mappings.");
  const seen = new Set<string>();
  for (const mapping of value) {
    if (!mapping || !emoteEvents.some(event => event.id === mapping.event) || seen.has(mapping.event)
      || typeof mapping.commandId !== "string" || !mapping.commandId || mapping.commandId.length > 512)
      throw new Error("Invalid Emote event mapping.");
    seen.add(mapping.event);
  }
}
