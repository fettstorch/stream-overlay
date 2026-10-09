export const MAX_MESSAGE_BYTES = 16_384;
export const MAX_COOLDOWNS = 200;
export type RelayChannel = "live" | "preview";
export type Cooldown = { endsAt: number; durationSeconds: number };
export type RelaySnapshot = { type: "snapshot"; did: string; channel: RelayChannel; revision: number; cooldowns: Record<string, Cooldown>; configRevision?: string };
export type RelayClientMessage =
  | { type: "hello"; did: string; page: "effect" | "board" | "admin"; channel: RelayChannel }
  | { type: "cooldowns"; revision: number; cooldowns: Record<string, Cooldown> }
  | { type: "ping" };
export type RelayServerMessage = RelaySnapshot | { type: "config-changed"; revision: string } | { type: "test-command"; commandId: string; requestId: string } | { type: "pong" } | { type: "error"; code: string };

export function parseClientMessage(raw: string, now = Date.now()): RelayClientMessage | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.type === "ping") return { type: "ping" };
  if (item.type === "hello" && typeof item.did === "string" && /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(item.did)
    && ["effect", "board", "admin"].includes(String(item.page)) && ["live", "preview"].includes(String(item.channel))) {
    return item as RelayClientMessage;
  }
  if (item.type !== "cooldowns" || !Number.isSafeInteger(item.revision) || Number(item.revision) < 0 || !item.cooldowns || typeof item.cooldowns !== "object") return null;
  const entries = Object.entries(item.cooldowns as Record<string, unknown>);
  if (entries.length > MAX_COOLDOWNS) return null;
  const cooldowns: Record<string, Cooldown> = {};
  for (const [id, candidate] of entries) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id) || !candidate || typeof candidate !== "object") return null;
    const c = candidate as Record<string, unknown>;
    if (typeof c.endsAt !== "number" || !Number.isFinite(c.endsAt) || c.endsAt < now - 60_000 || c.endsAt > now + 86_400_000
      || typeof c.durationSeconds !== "number" || c.durationSeconds < 0 || c.durationSeconds > 86_400) return null;
    cooldowns[id] = { endsAt: c.endsAt, durationSeconds: c.durationSeconds };
  }
  return { type: "cooldowns", revision: Number(item.revision), cooldowns };
}
