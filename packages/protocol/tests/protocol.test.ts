import { describe, expect, test } from "bun:test";
import { parseClientMessage } from "../src/index.ts";
describe("relay protocol", () => {
  test("accepts bounded cooldown reports", () => { const now = Date.now(); expect(parseClientMessage(JSON.stringify({ type:"cooldowns", revision:1, cooldowns:{ a:{ endsAt:now+1000, durationSeconds:1 } } }), now)?.type).toBe("cooldowns"); });
  test("rejects stale, oversized, and invalid reports", () => { const now = Date.now(); expect(parseClientMessage(JSON.stringify({ type:"cooldowns", revision:1, cooldowns:{ a:{ endsAt:now-120000, durationSeconds:1 } } }), now)).toBeNull(); expect(parseClientMessage("x".repeat(20000))).toBeNull(); });
});
