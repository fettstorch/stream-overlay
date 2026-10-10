import { afterEach, expect, test, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
const assets = vi.hoisted(() => ({ load: vi.fn(async (source: string) => source), retain: vi.fn(), clear: vi.fn() }));
vi.mock("../../../modules/emoticons/src/asset-cache.ts", () => ({ createStickerAssetCache: () => assets }));
const giphy = vi.hoisted(() => ({ load: vi.fn(async (id: string) => `https://media.giphy.com/${id}/giphy.gif`), retain: vi.fn(), clear: vi.fn() }));
vi.mock("../src/giphy.ts", () => ({ createGiphyPreloader: () => giphy }));

const relay = vi.hoisted(() => ({ receive: undefined as undefined | ((message: any) => void), hello: vi.fn(), send: vi.fn(), close: vi.fn() }));
vi.mock("@streamface/browser-runtime", () => ({ RelayClient: class {
  constructor(_url: string, _hello: unknown, receive: (message: any) => void) { relay.hello(_hello); relay.receive = receive; }
  send = relay.send;
  close = relay.close;
} }));
vi.mock("@streamface/stream-chat", () => ({ DirectStreamChatService: class {
  messages = { subscribe: vi.fn() };
  events = { subscribe: vi.fn((callback) => { liveEvents.receive = callback; }) };
  setStreamerDid = vi.fn();
  stop = vi.fn();
} }));
const liveEvents = vi.hoisted(() => ({ receive: undefined as undefined | ((event: any) => void) }));

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
  document.body.replaceChildren(); relay.send.mockClear(); relay.hello.mockClear();
  assets.load.mockClear(); assets.retain.mockClear(); assets.clear.mockClear();
  giphy.load.mockClear(); giphy.retain.mockClear(); giphy.clear.mockClear();
  liveEvents.receive = undefined;
});
test.each([false, true])("stream events trigger mapped commands only in the live overlay (preview=%s)", async preview => {
  HTMLElement.prototype.getAnimations = vi.fn(() => []);
  history.replaceState({}, "", `/emotes/?did=did:plc:alice${preview ? '&preview=1' : ''}`);
  document.body.innerHTML = '<main class="effect"></main>';
  let eventMappings = [{ event: "teleport-arrival", commandId: "wave", text: "Welcome [teleporter] and [viewers] viewers!" }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice", eventMappings,
    commands: [{ id: "wave", command: "wave", mode: "effect", durationSeconds: 8, cooldownSeconds: 0, volume: 1,
      width: "", height: "", mirrored: false, image: { url: "https://example.test/wave.gif" } }] })));
  await import("../src/cloud-overlay.ts"); await flushPromises();
  liveEvents.receive!({ type: "teleport-arrival", id: "arrival:one", viewerCount: 12, author: { did: "did:plc:source", handle: "source.example", displayName: "<friends>" } });
  await flushPromises();
  expect(document.querySelectorAll('.clip').length).toBe(preview ? 0 : 1);
  expect(document.querySelector('.event-text')?.textContent).toBe(preview ? undefined : 'Welcome <friends> and 12 viewers!');
  expect(document.querySelector('.event-text friends')).toBeNull();
  if (!preview) expect(relay.send).toHaveBeenCalledWith(expect.objectContaining({ event: "event-accepted", commandId: "wave" }));
  eventMappings = [];
  relay.receive!({ type: "config-changed" }); await flushPromises();
  liveEvents.receive!({ type: "teleport-arrival", id: "arrival:two" }); await flushPromises();
  expect(document.querySelectorAll('.clip').length).toBe(preview ? 0 : 1);
});
test("simulated events play the mapped clip and caption in the preview", async () => {
  HTMLElement.prototype.getAnimations = vi.fn(() => []);
  history.replaceState({}, "", "/emotes/?did=did:plc:alice&preview=1");
  document.body.innerHTML = '<main class="effect"></main>';
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice",
    commands: [{ id: "wave", command: "wave", mode: "effect", durationSeconds: 8, cooldownSeconds: 0, volume: 1,
      width: "", height: "", mirrored: false, image: { url: "https://example.test/wave.gif" } }] })));
  await import("../src/cloud-overlay.ts"); await flushPromises();
  relay.receive!({ type: "test-command", commandId: "wave", requestId: "event-test", eventId: "teleport-arrival", eventText: "Welcome [teleporter] and [viewers] viewers!" });
  await flushPromises();
  expect(document.querySelectorAll('.clip')).toHaveLength(1);
  expect(document.querySelector('.event-text')?.textContent).toBe("Welcome Example streamer and 42 viewers!");
  expect(document.querySelector('.event-text friends')).toBeNull();
  expect(relay.send).toHaveBeenCalledWith(expect.objectContaining({ event: "test-accepted", requestId: "event-test" }));
});
test.each(["/emote-listings/", "/board/"])("%s initializes the listing runtime, not effect playback", async path => {
  history.replaceState({}, "", `${path}?did=did:plc:alice`);
  document.body.innerHTML = '<main class="board"></main>';
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice", commands: [] })));
  await import("../src/cloud-overlay.ts"); await flushPromises();
  expect(relay.hello).toHaveBeenCalledWith(expect.objectContaining({ page: "board" }));
  expect(relay.send).not.toHaveBeenCalledWith(expect.objectContaining({ event: "config-loaded" }));
});

test("Giphy IDs preload on startup and updates without entering the blob cache", async () => {
  history.replaceState({}, "", "/emotes/?did=did:plc:alice");
  document.body.innerHTML = '<main class="effect"></main>';
  const command = { id: "gif", command: "gif", mode: "sticker", durationSeconds: 5, cooldownSeconds: 0, volume: 1, width: "", height: "", mirrored: false };
  let commands = [{ ...command, image: { giphyId: "abc" } }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice", commands })));
  await import("../src/cloud-overlay.ts"); await flushPromises();
  expect(giphy.load).toHaveBeenCalledWith("abc");
  expect(assets.load).not.toHaveBeenCalled();
  expect(relay.send).toHaveBeenCalledWith(expect.objectContaining({ event: "media-loaded", reason: "giphy-preload-ready" }));
  commands = [{ ...command, image: { giphyId: "def" } }];
  relay.receive!({ type: "config-changed" }); await flushPromises();
  expect(giphy.load).toHaveBeenCalledWith("def");
  expect(giphy.retain).toHaveBeenLastCalledWith(new Set(["def"]));
  expect(assets.load).not.toHaveBeenCalled();
  relay.receive!({ type: "test-command", commandId: "gif", requestId: "giphy-test" }); await flushPromises();
  expect(document.querySelector<HTMLImageElement>(".sticker-media img")?.src).toBe("https://media.giphy.com/def/giphy.gif");
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
