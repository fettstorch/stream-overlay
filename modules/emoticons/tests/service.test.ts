import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmoticonCommand, EmoticonEvent } from "../src/contracts.ts";
import { EmoticonRuntime } from "../src/runtime.ts";
import { EmoticonService } from "../src/service.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("accepts WebM video uploads, including extension-based MIME fallback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "emoticon-webm-"));
  directories.push(directory);
  const service = new EmoticonService(directory);

  const typed = await service.upload(new File(["webm"], "transparent.webm", { type: "video/webm" }), "video", 8.5);
  const fallback = await service.upload(new File(["webm"], "transparent.webm"), "video", 8.5);

  expect(typed).toMatchObject({ filename: `${typed.id}.webm`, contentType: "video/webm", kind: "video", durationSeconds: 8.5 });
  expect(fallback).toMatchObject({ filename: `${fallback.id}.webm`, contentType: "video/webm", kind: "video", durationSeconds: 8.5 });
});

test("configured clip duration truncates longer media and advances the queue", async () => {
  const command = (name: string): EmoticonCommand => ({
    id: name,
    command: name,
    mode: "effect",
    mirrored: false,
    imageAssetId: null,
    audioAssetId: "audio",
    videoAssetId: null,
    durationSeconds: 0.01,
    cooldownSeconds: 0,
    volume: 1,
    width: "",
    height: "",
  });
  const first = command("first");
  const second = command("second");
  const events: EmoticonEvent[] = [];
  const runtime = new EmoticonRuntime({ effect: event => events.push(event) });
  runtime.configure({ enabled: true, commands: [first, second], assets: [] });

  expect(runtime.trigger(first.id)).toBe(true);
  expect(runtime.trigger(second.id)).toBe(true);
  await Bun.sleep(30);

  const effects = events.filter((event): event is Extract<EmoticonEvent, { type: "effect" }> => event.type === "effect");
  expect(effects.map(event => event.command.command)).toEqual(["first", "second"]);
  expect(effects.map(event => event.durationSeconds)).toEqual([0.01, 0.01]);
  runtime.clear();
});
