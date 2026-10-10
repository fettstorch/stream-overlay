import { expect, test } from "bun:test";
import { BotSourceLeases } from "../src/bot-source-lease.ts";

const a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
test("one owner per stream, renewable expiry and standby takeover", () => {
  let now = 1000;
  const leases = new BotSourceLeases(() => now);
  expect(leases.renew("owner", a).active).toBe(true);
  expect(leases.renew("owner", b).active).toBe(false);
  expect(leases.renew("other", b).active).toBe(true);
  now += 40_000;
  expect(leases.renew("owner", a).active).toBe(true);
  now += 30_000;
  expect(leases.owns("owner", a)).toBe(true);
  expect(leases.renew("owner", b).active).toBe(false);
  now += 30_000;
  expect(leases.owns("owner", a)).toBe(false);
  expect(leases.renew("owner", b).active).toBe(true);
  expect(leases.owns("owner", a)).toBe(false);
  expect(leases.renew("owner", a).active).toBe(false);
});
test("missing or malformed identities cannot acquire a lease", () => {
  const leases = new BotSourceLeases();
  expect(leases.renew("owner", undefined).active).toBe(false);
  expect(leases.renew("owner", "bad").active).toBe(false);
  expect(leases.owns("owner", undefined)).toBe(false);
});
