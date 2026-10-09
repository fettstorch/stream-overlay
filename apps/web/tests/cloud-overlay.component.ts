import { afterEach, expect, test, vi } from "vitest";

const relay = vi.hoisted(() => ({ receive: undefined as undefined | ((message: any) => void), send: vi.fn(), close: vi.fn() }));
vi.mock("@stream-overlay/browser-runtime", () => ({ RelayClient: class {
  constructor(_url: string, _hello: unknown, receive: (message: any) => void) { relay.receive = receive; }
  send = relay.send;
  close = relay.close;
} }));
vi.mock("@stream-overlay/stream-chat", () => ({ DirectStreamChatService: class {
  messages = { subscribe: vi.fn() };
  setStreamerDid = vi.fn();
  stop = vi.fn();
} }));

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
  document.body.replaceChildren(); relay.send.mockClear();
});

test("Test playback starts a keyframe sticker animation rather than a first-frame transition", async () => {
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
  const sticker = document.querySelector<HTMLElement>(".effect > .sticker")!;
  expect(sticker).not.toBeNull();
  expect(sticker.style.animationDuration).toBe("8s");
  expect(sticker.style.getPropertyValue("--drift")).toMatch(/px$/);
  expect(sticker.style.transition).toBe("");
  expect(sticker.querySelector("img")?.src).toBe("https://example.test/wave.gif");
  expect(sticker.querySelector<HTMLImageElement>(".sender-avatar")?.src).toMatch(/^data:image\/svg\+xml/);
  expect(sticker.querySelector(".sender-avatar")?.getAttribute("alt")).toBe("Test sender");
  expect(relay.send).toHaveBeenCalledWith(expect.objectContaining({ type: "diagnostic", event: "test-accepted", requestId: "request-test" }));
});

test("clip Test publishes its cooldown with the test request ID on the preview runtime", async () => {
  vi.useFakeTimers(); history.replaceState({}, "", "/effect/?did=did:plc:alice&preview=1");
  document.body.innerHTML = '<main class="effect"></main>';
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, streamerDid: "did:plc:alice", commands: [{ id: "clip", command: "clip", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false, image: { url: "https://example.test/clip.gif" } }] })));
  await import("../src/cloud-overlay.ts"); await Promise.resolve(); await Promise.resolve();
  relay.receive!({ type: "test-command", commandId: "clip", requestId: "clip-test" });
  expect(relay.send).toHaveBeenCalledWith(expect.objectContaining({ type: "cooldowns", requestId: "clip-test", cooldowns: { clip: { endsAt: Date.now() + 20_000, durationSeconds: 20 } } }));
});
