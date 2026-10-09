import { expect, test } from "bun:test";
import { CloudPaint } from "../src/cloud-paint.ts";
import { StructuredLogger } from "../src/logger.ts";
import { parseConfig, PdsService, type CloudConfig } from "../src/pds.ts";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";
import { defaultPaintConfiguration } from "../../../modules/overlay-paint/src/config.ts";

const namespace = "invalid.streamoverlay.dev";
const config: CloudConfig = { enabled: true, streamerDid: "did:plc:alice", revision: "1", commands: [], modules: { chat: true, paint: true, pets: false }, chat: { ...defaultChatConfiguration, fontSize: 32, rotationY: 15 }, paint: { color: "#abcdef", decaySeconds: 3.5 } };
test("all module settings roundtrip through PDS records and playable blob URLs survive saves", async () => {
  let writes: any[] = [];
  const agent: any = { com: { atproto: { sync: { getLatestCommit: async () => ({ data: { cid: "head" } }) }, repo: {
    getRecord: async () => ({ data: {} }), listRecords: async () => ({ data: { records: [] } }),
    applyWrites: async (value: any) => { writes = value.writes; return { data: {} }; },
  } } } };
  const service = new PdsService({ restore: async () => ({}) } as any, namespace, 60000, 15000, { agent: () => agent, resolvePds: async () => "https://pds.example" });
  const blob = { $type: "blob" as const, ref: { $link: "bafygif" }, mimeType: "image/gif", size: 4 };
  const candidate = { ...config, commands: [{ id: "wave", command: "wave", mode: "sticker" as const, image: { blob, url: "https://old.example/blob" }, durationSeconds: 8, cooldownSeconds: 0, volume: 1, width: "", height: "", mirrored: false }] };
  const saved = await service.save("did:plc:alice", candidate);
  expect(writes[0].value.paint).toEqual({ color: "#abcdef", decayMilliseconds: 3500 });
  expect(writes[1].value.image).toEqual({ blob });
  expect(saved.commands[0].image?.url).toContain("https://pds.example/xrpc/com.atproto.sync.getBlob");
  expect((await service.publicConfig("did:plc:alice")).commands[0].image?.url).toBe(saved.commands[0].image?.url);
  const parsed = parseConfig(writes[0].value, [writes[1].value], namespace)!;
  expect(parsed.paint).toEqual(config.paint); expect(parsed.chat).toEqual(config.chat); expect(parsed.modules).toEqual(config.modules);
  await service.save("did:plc:alice", { ...saved, enabled: false });
  expect(writes[1].value.image).toEqual({ blob });
});
test("legacy settings retain all commands and receive compatible appearance defaults", () => {
  const parsed = parseConfig({ $type: `${namespace}.settings`, enabled: true, streamerDid: "did:plc:alice" }, [], namespace)!;
  expect(parsed.chat).toEqual(defaultChatConfiguration); expect(parsed.paint).toEqual(defaultPaintConfiguration);
  expect(parsed.modules).toEqual({ chat: true, paint: true, pets: true });
});
test("paint preserves account isolation, color, cursor, enabled state, and inactivity cleanup", async () => {
  let now = 1000;
  const lines: string[] = [];
  const paint = new CloudPaint(new StructuredLogger(undefined, line => lines.push(line)), () => now);
  const a = paint.service("did:plc:a", config), b = paint.service("did:plc:b", config);
  const segment = { x: .5, y: .5, fromX: .1, fromY: .1 };
  const response = await paint.handle(new Request("https://example.test", { method: "POST", body: JSON.stringify({ segments: [segment] }) }), "did:plc:a", "segments", config, "paint-test");
  expect(response.status).toBe(200); expect(a.service.snapshot().segments[0].color).toBe("#abcdef"); expect(b.service.snapshot().segments).toHaveLength(0);
  expect(a.service.snapshot().fadeAt! - Date.now()).toBeGreaterThan(3400);
  const invalid = await paint.handle(new Request("https://example.test", { method: "POST", body: JSON.stringify({ cursor: { x: 2, y: 0 } }) }), "did:plc:a", "cursor", config, "paint-test");
  expect(invalid.status).toBe(400);
  paint.configure("did:plc:a", { ...config, modules: { chat: true, paint: false, pets: false } });
  expect(a.service.snapshot().enabled).toBe(false); expect(a.service.snapshot().segments).toHaveLength(0);
  expect(lines.join("\n")).toContain("cloud.paint.stroke");
  now += 3600001; paint.cleanup();
  expect(paint.service("did:plc:a", config).service).not.toBe(a.service);
  paint.configure("did:plc:a", { ...config, modules: { chat: false, paint: false, pets: false } });
});
