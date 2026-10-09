import { afterEach, expect, mock, test } from "bun:test";
import type { EmoticonCommand, EmoticonEvent } from "../src/contracts.ts";
import { EmoticonRuntime } from "../src/runtime.ts";

const command = (id: string, overrides: Partial<EmoticonCommand> = {}): EmoticonCommand => ({
  id, command: id, mode: "effect", mirrored: false, imageAssetId: id, audioAssetId: null,
  videoAssetId: null, durationSeconds: 0.01, cooldownSeconds: 1, volume: 1, width: "", height: "", ...overrides,
});
const runtimes: EmoticonRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.clear(); });

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
  const effect = mock(() => {});
  const runtime = new EmoticonRuntime({ effect });
  runtimes.push(runtime);
  runtime.configure({ enabled: true, commands: [command("rain", { mode: "sticker", durationSeconds: 1, cooldownSeconds: 0 })], assets: [] });

  runtime.message("1", "!rain x99");
  expect(effect).toHaveBeenCalledTimes(1);
  await Bun.sleep(110);
  expect(effect.mock.calls.length).toBeGreaterThan(1);
  expect(effect.mock.calls.length).toBeLessThanOrEqual(30);
});

test("disabled runtimes ignore commands", () => {
  const effect = mock(() => {});
  const runtime = new EmoticonRuntime({ effect });
  runtimes.push(runtime);
  runtime.configure({ enabled: false, commands: [command("party")], assets: [] });
  runtime.message("1", "!party");
  expect(effect).not.toHaveBeenCalled();
});
