import { cached } from "@fettstorch/jule";

export const botSourceLeaseMs = 60_000;
/** Synchronous acquisition is atomic within our single server process. */
export class BotSourceLeases {
  private entries = new Map<string, { sourceId: string; expiresAt: number }>();
  private state = cached((did: string) => {
    const entry = { sourceId: "", expiresAt: 0 };
    this.entries.set(did, entry);
    return entry;
  });
  constructor(private now = Date.now) {}
  renew(did: string, sourceId: unknown) {
    const now = this.now();
    if (typeof sourceId !== "string" || !/^[a-f0-9-]{36}$/.test(sourceId))
      return { active: false, reason: "invalid-source-id", leaseMs: botSourceLeaseMs };
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) {
      this.entries.delete(key);
      this.state.evict(key);
    }
    if (!this.entries.has(did) && this.entries.size >= 10_000)
      return { active: false, reason: "capacity", leaseMs: botSourceLeaseMs };
    const entry = this.state(did);
    if (entry.sourceId && entry.sourceId !== sourceId)
      return { active: false, reason: "standby", leaseMs: botSourceLeaseMs };
    const acquired = !entry.sourceId;
    entry.sourceId = sourceId;
    entry.expiresAt = now + botSourceLeaseMs;
    return { active: true, acquired, leaseMs: botSourceLeaseMs };
  }
  owns(did: string, sourceId: unknown) {
    const entry = this.entries.get(did);
    return Boolean(entry && entry.expiresAt > this.now() && entry.sourceId === sourceId);
  }
}
