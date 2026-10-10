import { afterEach, expect, mock, test } from "bun:test";
import type { EmoticonCommand, EmoticonEvent } from "../src/contracts.ts";
import { EmoticonRuntime } from "../src/runtime.ts";

const command = (id: string, overrides: Partial<EmoticonCommand> = {}): EmoticonCommand => ({
  id, command: id, mode: "effect", mirrored: false, imageAssetId: id, audioAssetId: null,
  videoAssetId: null, durationSeconds: 0.01, cooldownSeconds: 1, volume: 1, width: "", height: "", ...overrides,
});
const runtimes: EmoticonRuntime[] = [];
test("event reactions reject stickers and keep text attached to its queued clip", () => {
  const effects: Extract<EmoticonEvent, { type: "effect" }>[] = [];
  const log = mock(() => {});
  const runtime = new EmoticonRuntime({ effect: event => { effects.push(event); }, log });
  runtimes.push(runtime);
  runtime.configure({ enabled: true, commands: [command("clip"), command("sticker", { mode: "sticker" })], assets: [] });
  expect(runtime.trigger("sticker", "stream-event")).toBe(false);
  expect(log).toHaveBeenCalledWith("emoticons.command-rejected", expect.objectContaining({ reason: "event-requires-clip" }));
  expect(runtime.trigger("clip", "stream-event", "event-id", undefined, false, "Welcome!")).toBe(true);
  expect(effects[0].eventText).toBe("Welcome!");
  expect(runtime.trigger("clip", "stream-event")).toBe(false);
});
test("clip queue waits for media readiness before consuming display duration", async () => {
  let ready!: () => void;
  const effects: string[] = [];
  const runtime = new EmoticonRuntime({ effect: event => {
    effects.push(event.command.id);
    if (event.command.id === "first") return new Promise<void>(resolve => { ready = resolve; });
  } });
  runtimes.push(runtime);
  runtime.configure({ enabled: true, commands: [command("first"), command("second")], assets: [] });
  runtime.trigger("first"); runtime.trigger("second");
  await Bun.sleep(30);
  expect(effects).toEqual(["first"]);
  ready();
  await Bun.sleep(20);
  expect(effects).toEqual(["first", "second"]);
});
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.clear(); });

test("moderation blocks by DID across commands but leaves preview tests alone", () => {
  const effects: string[] = [], logs: string[] = [];
  const runtime = new EmoticonRuntime({ effect: event => { effects.push(event.command.id); },
    log: (_event, detail) => { if (detail?.reason) logs.push(String(detail.reason)); } });
  runtimes.push(runtime);
  runtime.configure({ enabled: true, commands: [command("clip"), command("sticker", { mode: "sticker" })], assets: [],
    moderation: [{ did: "did:plc:blocked", handle: "old.handle", blocked: true, cooldownSeconds: 30 }] });
  runtime.message("1", "!clip", { did: "did:plc:blocked", handle: "new.handle" });
  runtime.message("2", "!sticker x3", { did: "did:plc:blocked" });
  expect(effects).toEqual([]);
  expect(logs).toEqual(["user-blocked", "user-blocked"]);
  expect(runtime.trigger("sticker", "preview", undefined, { did: "did:plc:blocked" })).toBe(true);
  runtime.message("3", "!sticker", { did: "did:plc:other", handle: "old.handle" });
  expect(effects).toEqual(["sticker", "sticker"]);
});

test("one personal cooldown covers clips and stickers without extending rejected attempts", () => {
  let now = 1000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const effects: string[] = [], logs: string[] = [];
    const runtime = new EmoticonRuntime({ effect: event => { effects.push(event.command.id); },
      log: (_event, detail) => { if (detail?.reason) logs.push(String(detail.reason)); } });
    runtimes.push(runtime);
    const state = { enabled: true, commands: [command("clip"), command("sticker", { mode: "sticker" })], assets: [],
      moderation: [{ did: "did:plc:viewer", blocked: false, cooldownSeconds: 30 }] };
    runtime.configure(state);
    runtime.message("1", "!sticker", { did: "did:plc:viewer" });
    now = 20_000;
    runtime.message("2", "!clip", { did: "did:plc:viewer" });
    runtime.configure(state); // Polling must not reset cooldowns.
    now = 31_000;
    runtime.message("3", "!clip", { did: "did:plc:viewer" });
    runtime.message("4", "!sticker", { did: "did:plc:viewer" });
    runtime.message("5", "!sticker", { did: "did:plc:other" });
    expect(effects).toEqual(["sticker", "clip", "sticker"]);
    expect(logs).toEqual(["user-cooldown", "user-cooldown"]);
    runtime.configure({ ...state, moderation: [] });
    runtime.message("6", "!sticker", { did: "did:plc:viewer" });
    expect(effects).toHaveLength(4);
  } finally { Date.now = originalNow; }
});

test("accepted sticker repetitions share a single personal cooldown; a new block cancels the rest", async () => {
  const effect = mock(() => {});
  const runtime = new EmoticonRuntime({ effect });
  runtimes.push(runtime);
  const state = { enabled: true, commands: [command("rain", { mode: "sticker" as const })], assets: [],
    moderation: [{ did: "did:plc:viewer", blocked: false, cooldownSeconds: 30 }] };
  runtime.configure(state);
  runtime.message("1", "!rain x30", { did: "did:plc:viewer" });
  await Bun.sleep(110);
  expect(effect.mock.calls.length).toBeGreaterThan(1);
  runtime.configure({ ...state, moderation: [{ ...state.moderation[0], blocked: true }] });
  const count = effect.mock.calls.length;
  await Bun.sleep(120);
  expect(effect.mock.calls.length).toBe(count);
});

test("matches chat, deduplicates reconnect repeats, and owns cooldown decisions", () => {
  const effects: Extract<EmoticonEvent, { type: "effect" }>[] = [];
  const cooldowns: unknown[] = [];
  const runtime = new EmoticonRuntime({ effect: event => effects.push(event), cooldowns: value => cooldowns.push(value) });
  runtimes.push(runtime);
  runtime.configure({ enabled: true, commands: [command("party")], assets: [] });

  runtime.message("message-1", "!party", { did: "did:plc:viewer" });
  runtime.message("message-1", "!party", { did: "did:plc:viewer" });
  runtime.message("message-2", "!party", { did: "did:plc:viewer" });

  expect(effects).toHaveLength(1);
  expect(effects[0]!.command.command).toBe("party");
  expect(cooldowns).toHaveLength(1);
});

test("queues different clips locally and preserves arrival order", async () => {
  const effects: string[] = [];
  const runtime = new EmoticonRuntime({ effect: event => effects.push(event.command.command) });
  runtimes.push(runtime);
  runtime.configure({ enabled: true, commands: [command("first", { cooldownSeconds: 0 }), command("second", { cooldownSeconds: 0 })], assets: [] });

  runtime.message("1", "!first");
  runtime.message("2", "!second");
  expect(effects).toEqual(["first"]);
  await Bun.sleep(20);
  expect(effects).toEqual(["first", "second"]);
});

test("sticker multipliers stay browser-local and are capped", async () => {
  const effect = mock((_event: Extract<EmoticonEvent, { type: "effect" }>) => {});
  const runtime = new EmoticonRuntime({ effect });
  runtimes.push(runtime);
  runtime.configure({ enabled: true, commands: [command("rain", { mode: "sticker", durationSeconds: 1, cooldownSeconds: 0 })], assets: [] });

  const author = { did: "did:plc:alice", avatar: "https://cdn.example/alice.png" };
  runtime.message("1", "!rain x99", author);
  expect(effect).toHaveBeenCalledTimes(1);
  await Bun.sleep(110);
  expect(effect.mock.calls.length).toBeGreaterThan(1);
  expect(effect.mock.calls.length).toBeLessThanOrEqual(30);
  expect(effect.mock.calls.every(([event]) => event.author?.avatar === author.avatar)).toBe(true);
});

test("disabled runtimes ignore commands", () => {
  const effect = mock(() => {});
  const runtime = new EmoticonRuntime({ effect });
  runtimes.push(runtime);
  runtime.configure({ enabled: false, commands: [command("party")], assets: [] });
  runtime.message("1", "!party");
  expect(effect).not.toHaveBeenCalled();
});
