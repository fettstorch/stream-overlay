import { afterEach, expect, test, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
const assets = vi.hoisted(() => ({ load: vi.fn(async (source: string) => source), retain: vi.fn(), clear: vi.fn() }));
vi.mock("../../../modules/emoticons/src/asset-cache.ts", () => ({ createStickerAssetCache: () => assets }));

const relay = vi.hoisted(() => ({ receive: undefined as undefined | ((message: any) => void), send: vi.fn(), close: vi.fn() }));
vi.mock("@streamface/browser-runtime", () => ({ RelayClient: class {
  constructor(_url: string, _hello: unknown, receive: (message: any) => void) { relay.receive = receive; }
  send = relay.send;
  close = relay.close;
} }));
vi.mock("@streamface/stream-chat", () => ({ DirectStreamChatService: class {
  messages = { subscribe: vi.fn() };
  setStreamerDid = vi.fn();
  stop = vi.fn();
} }));

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
  document.body.replaceChildren(); relay.send.mockClear();
  assets.load.mockClear(); assets.retain.mockClear(); assets.clear.mockClear();
});

test("Test playback starts a keyframe sticker animation rather than a first-frame transition", async () => {
  HTMLElement.prototype.getAnimations = vi.fn(() => []);
  vi.useFakeTimers();
  history.replaceState({}, "", "/effect/?did=did:plc:alice");
  document.body.innerHTML = '<main class="effect"></main>';
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice", commands: [{
    id: "wave", command: "wave", mode: "sticker", durationSeconds: 8, cooldownSeconds: 0, volume: 1,
    width: "", height: "", mirrored: false, image: { url: "https://example.test/wave.gif" },
  }] })));
  await import("../src/cloud-overlay.ts");
  await Promise.resolve(); await Promise.resolve();
  relay.receive!({ type: "test-command", commandId: "wave", requestId: "request-test" });
  await flushPromises();
  const sticker = document.querySelector<HTMLElement>(".effect > .sticker")!;
  expect(sticker).not.toBeNull();
  expect(sticker.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sticker.isConnected).toBe(true); // Loading doesn't consume the eight-second duration.
  sticker.querySelector('img')!.dispatchEvent(new Event('load'));
  await Promise.resolve(); await Promise.resolve();
  expect(sticker.hidden).toBe(false);
  expect(sticker.style.animationDuration).toBe("8s");
  expect(sticker.style.getPropertyValue("--drift")).toMatch(/px$/);
  expect(sticker.style.transition).toBe("");
  const media = sticker.querySelector<HTMLElement>(".sticker-media")!;
  expect(media.style.transformOrigin).toBe("left center");
  expect(Number(media.style.scale)).toBeGreaterThanOrEqual(0.4);
  expect(Number(media.style.scale)).toBeLessThanOrEqual(1);
  expect(media.querySelector(".sender-avatar")).toBeNull();
  expect(media.querySelector<HTMLElement>("img")?.style.scale).toBe("");
  expect(sticker.querySelector("img")?.src).toBe("https://example.test/wave.gif");
  expect(sticker.querySelector<HTMLImageElement>(".sender-avatar")?.src).toMatch(/^data:image\/svg\+xml/);
  expect(sticker.querySelector(".sender-avatar")?.getAttribute("alt")).toBe("Test sender");
  expect(relay.send).toHaveBeenCalledWith(expect.objectContaining({ type: "diagnostic", event: "test-accepted", requestId: "request-test" }));
  await vi.advanceTimersByTimeAsync(8_000);
  expect(sticker.isConnected).toBe(false);
});

test("preloads every media kind and immediately preloads newly added assets on config updates", async () => {
  history.replaceState({}, "", "/effect/?did=did:plc:alice");
  document.body.innerHTML = '<main class="effect"></main>';
  const command = { id: "clip", command: "clip", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false };
  let commands: any[] = [{ ...command, image: { url: "https://example.test/one.gif" }, audio: { url: "https://example.test/one.mp3" } }, { ...command, id: "video", video: { url: "https://example.test/one.mp4" } }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice", commands })));
  await import("../src/cloud-overlay.ts"); await flushPromises();
  expect(assets.load).toHaveBeenCalledWith("https://example.test/one.gif");
  expect(assets.load).toHaveBeenCalledWith("https://example.test/one.mp3");
  expect(assets.load).toHaveBeenCalledWith("https://example.test/one.mp4");
  expect(document.querySelector('.clip')).toBeNull();
  commands = [{ ...command, id: "new", image: { url: "https://example.test/new.gif" }, audio: { url: "https://example.test/new.mp3" } }];
  relay.receive!({ type: "config-changed" }); await flushPromises();
  expect(assets.load).toHaveBeenCalledWith("https://example.test/new.gif");
  expect(assets.retain).toHaveBeenLastCalledWith(new Set(["https://example.test/new.gif", "https://example.test/new.mp3"]));
  const count = assets.load.mock.calls.length;
  relay.receive!({ type: "config-changed" }); await flushPromises();
  expect(assets.load).toHaveBeenCalledTimes(count);
});

test("clip Test publishes its cooldown with the test request ID on the preview runtime", async () => {
  vi.useFakeTimers(); history.replaceState({}, "", "/effect/?did=did:plc:alice&preview=1");
  document.body.innerHTML = '<main class="effect"></main>';
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice", commands: [{ id: "clip", command: "clip", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false, image: { url: "https://example.test/clip.gif" } }] })));
  await import("../src/cloud-overlay.ts"); await Promise.resolve(); await Promise.resolve();
  relay.receive!({ type: "test-command", commandId: "clip", requestId: "clip-test" });
  expect(relay.send).toHaveBeenCalledWith(expect.objectContaining({ type: "cooldowns", requestId: "clip-test", cooldowns: { clip: { endsAt: Date.now() + 20_000, durationSeconds: 20 } } }));
});
