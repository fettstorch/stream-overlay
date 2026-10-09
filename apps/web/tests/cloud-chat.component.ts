import { afterEach, expect, test, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";
const mocks = vi.hoisted(() => ({ receive: undefined as any, message: undefined as any, close: vi.fn(), streamer: vi.fn(), report: vi.fn() }));
vi.mock("../src/cloud-module-source.ts", () => ({ observeCloudConfig: (receive: any) => { mocks.receive = receive; return Object.assign(mocks.close, { report: mocks.report }); } }));
vi.mock("@stream-overlay/stream-chat", () => ({ DirectStreamChatService: class {
  messages = { subscribe: (receive: any) => { mocks.message = receive; return () => {}; } };
  setStreamerDid = mocks.streamer; stop = vi.fn();
} }));
afterEach(() => { window.dispatchEvent(new Event("pagehide")); vi.useRealTimers(); vi.resetModules(); document.body.replaceChildren(); mocks.close.mockClear(); mocks.streamer.mockClear(); });
test("cloud chat reuses author avatars, appearance and timed decay, then stops when disabled", async () => {
  vi.useFakeTimers(); document.body.innerHTML = '<div id="app"></div>';
  await import("../src/cloud-chat.ts");
  const state = { streamerDid: "did:plc:alice", modules: { chat: true }, chat: { ...defaultChatConfiguration, fontSize: 32 } };
  mocks.receive(state); await flushPromises();
  mocks.message({ id: "msg1", streamerDid: state.streamerDid, text: "Hello", author: { did: "did:plc:bob", handle: "bob.test", avatar: "https://cdn.example/bob.jpg" } });
  await flushPromises();
  expect(document.querySelector<HTMLImageElement>(".chat-avatar")?.src).toBe("https://cdn.example/bob.jpg");
  expect((document.querySelector(".chat-messages") as HTMLElement).style.fontSize).toBe("32px");
  expect((document.querySelector(".chat-message") as HTMLElement).style.animationDelay).toBe("20000ms");
  expect((document.querySelector(".chat-message") as HTMLElement).style.animationDuration).toBe("10000ms");
  await vi.advanceTimersByTimeAsync(30001); await flushPromises();
  expect(document.querySelector(".chat-message:not(.chat-bubble-leave-active)")).toBeNull();
  mocks.receive({ ...state, modules: { chat: false } }); await flushPromises();
  expect(document.querySelector(".chat-plane")).toBeNull(); expect(mocks.streamer).toHaveBeenLastCalledWith("");
});
