import type { EmoticonModerationRule } from "./cloud-contracts.ts";

/** Rules are bounded and keyed by stable identity, never by a mutable handle. */
export function validateModeration(value: unknown): asserts value is EmoticonModerationRule[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("Use at most 200 moderation rules.");
  const seen = new Set<string>();
  for (const rule of value) {
    if (!rule || typeof rule !== "object" || typeof rule.did !== "string"
      || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(rule.did) || rule.did.length > 2048
      || seen.has(rule.did) || typeof rule.blocked !== "boolean"
      || !Number.isFinite(rule.cooldownSeconds) || rule.cooldownSeconds < 0 || rule.cooldownSeconds > 86400
      || (rule.handle !== undefined && (typeof rule.handle !== "string" || rule.handle.length > 253)))
      throw new Error("Invalid moderation rule. Use a unique account and a cooldown from 0 to 86400 seconds.");
    seen.add(rule.did);
  }
}
