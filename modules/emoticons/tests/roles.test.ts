import { expect, test } from "bun:test";
import { createRoleAuthorizer, openCommandRoles, validateCommandRoles } from "../src/roles.ts";
import { EmoticonRuntime } from "../src/runtime.ts";
const owner = "did:plc:owner", viewer = "did:plc:viewer";
test("following allows accounts the streamer follows, not accounts that only follow the streamer", async () => {
  for (const [following, followedBy] of [[false, true], [true, false], [true, true], [false, false]]) {
    const authorize = createRoleAuthorizer(Object.assign(async () => Response.json({ actor: owner,
      relationships: [{ did: viewer, ...(followedBy ? { followedBy: "at://follow" } : {}), ...(following ? { following: "at://other" } : {}) }] }),
      { preconnect: fetch.preconnect }));
    expect(await authorize(owner, { did: viewer }, { ...openCommandRoles, following: true })).toBe(following);
  }
  expect(() => validateCommandRoles({ followers: false, mutuals: false, moderators: false, users: [] })).not.toThrow();
  expect(() => validateCommandRoles({ ...openCommandRoles, following: "yes" })).toThrow();
});
test("roles are opt-in and combine with OR; explicit users and moderators need no graph request", async () => {
  const authorize = createRoleAuthorizer(Object.assign(async () => { throw new Error("No request expected"); }, { preconnect: fetch.preconnect }));
  expect(await authorize(owner, undefined)).toBe(true);
  expect(await authorize(owner, { did: viewer }, openCommandRoles)).toBe(true);
  expect(await authorize(owner, undefined, { ...openCommandRoles, followers: true })).toBe(false);
  expect(await authorize(owner, { did: viewer }, { ...openCommandRoles, followers: true, users: [{ did: viewer }] })).toBe(true);
  expect(await authorize(owner, { did: viewer, isModerator: true }, { ...openCommandRoles, moderators: true })).toBe(true);
  expect(await authorize(owner, { did: viewer }, { ...openCommandRoles, moderators: true })).toBe(false);
});
test("followers face the right direction; mutuals require both, lookups dedupe and expire", async () => {
  let calls = 0, now = 0, following = false;
  const authorize = createRoleAuthorizer(Object.assign(async (input: any) => {
    calls++;
    const url = new URL(String(input));
    expect(url.searchParams.get("actor")).toBe(owner);
    expect(url.searchParams.getAll("others")).toEqual([viewer]);
    return Response.json({ actor: owner, relationships: [{ did: viewer, followedBy: "at://follow", ...(following ? { following: "at://other" } : {}) }] });
  }, { preconnect: fetch.preconnect }), () => now);
  const followerRoles = { ...openCommandRoles, followers: true }, mutualRoles = { ...openCommandRoles, mutuals: true };
  expect(await Promise.all([authorize(owner, { did: viewer }, followerRoles), authorize(owner, { did: viewer }, mutualRoles)])).toEqual([true, false]);
  expect(calls).toBe(1);
  following = true; now = 60001;
  expect(await authorize(owner, { did: viewer }, mutualRoles)).toBe(true);
  expect(calls).toBe(2);
});
test("failed lookups are not cached; malformed roles and duplicate accounts reject", async () => {
  let calls = 0;
  const authorize = createRoleAuthorizer(Object.assign(async () => { calls++; return new Response("", { status: 503 }); }, { preconnect: fetch.preconnect }));
  for (let i = 0; i < 2; i++) await expect(authorize(owner, { did: viewer }, { ...openCommandRoles, followers: true })).rejects.toThrow("unavailable");
  expect(calls).toBe(2);
  expect(() => validateCommandRoles({ ...openCommandRoles, users: [{ did: viewer }, { did: viewer }] })).toThrow();
  expect(() => validateCommandRoles({ ...openCommandRoles, followers: "yes" })).toThrow();
});
test("effects deny failed roles, restrictions override permission, and previews stay exempt", async () => {
  const effects: string[] = [], reasons: unknown[] = [];
  const authorize = createRoleAuthorizer();
  const runtime = new EmoticonRuntime({ effect: event => { effects.push(event.command.id); },
    authorize: (author, roles) => authorize(owner, author, roles),
    log: (_event, details) => { if (details?.reason) reasons.push(details.reason); } });
  const state = { enabled: true, assets: [], roles: { ...openCommandRoles, users: [{ did: viewer }] },
    commands: [{ id: "wave", command: "wave", mode: "sticker" as const, imageAssetId: "image", audioAssetId: null, videoAssetId: null, durationSeconds: 1, cooldownSeconds: 0, volume: 1, width: "", height: "" }] };
  runtime.configure(state);
  await runtime.message("1", "!wave", { did: "did:plc:other" });
  await runtime.message("2", "!wave", { did: viewer });
  runtime.configure({ ...state, moderation: [{ did: viewer, blocked: true, cooldownSeconds: 0 }] });
  await runtime.message("3", "!wave", { did: viewer });
  expect(runtime.trigger("wave")).toBe(true);
  expect(effects).toEqual(["wave", "wave"]);
  expect(reasons).toContain("role-not-allowed");
  expect(reasons).toContain("user-blocked");
  runtime.clear();
});
test("config changes while resolving cannot admit a stale role decision", async () => {
  let resolve!: (allowed: boolean) => void;
  const effects: unknown[] = [];
  const runtime = new EmoticonRuntime({ effect: event => { effects.push(event); }, authorize: () => new Promise(done => { resolve = done; }) });
  runtime.configure({ enabled: true, assets: [], commands: [{ id: "wave", command: "wave", mode: "sticker", imageAssetId: "image", audioAssetId: null, videoAssetId: null, durationSeconds: 1, cooldownSeconds: 0, volume: 1, width: "", height: "" }], roles: { ...openCommandRoles, followers: true } });
  const pending = runtime.message("1", "!wave", { did: viewer });
  runtime.configure({ enabled: true, assets: [], commands: [], roles: { ...openCommandRoles, mutuals: true } });
  resolve(true); await pending;
  expect(effects).toHaveLength(0);
  runtime.clear();
});
