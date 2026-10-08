import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmoticonEvent } from "../src/contracts.ts";
import { EmoticonService } from "../src/service.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("configured clip duration truncates longer media and advances the queue", async () => {
  const directory = mkdtempSync(join(tmpdir(), "emoticon-duration-"));
  directories.push(directory);
  const service = new EmoticonService(directory);
  const asset = await service.upload(new File(["audio"], "long.mp3", { type: "audio/mpeg" }), "audio", 10);
  const command = (name: string) => service.save({
    command: name,
    mode: "effect",
    mirrored: false,
    imageAssetId: null,
    audioAssetId: asset.id,
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
  service.subscribe(event => events.push(event), crypto.randomUUID(), "test");
  service.setEnabled(true);

  expect(service.trigger(first.id)).toBe(true);
  expect(service.trigger(second.id)).toBe(true);
  await Bun.sleep(30);

  const effects = events.filter((event): event is Extract<EmoticonEvent, { type: "effect" }> => event.type === "effect");
  expect(effects.map(event => event.command.command)).toEqual(["first", "second"]);
  expect(effects.map(event => event.durationSeconds)).toEqual([0.01, 0.01]);
  service.stop();
});
