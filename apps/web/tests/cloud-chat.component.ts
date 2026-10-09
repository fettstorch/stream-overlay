import { afterEach, expect, test, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";
const mocks = vi.hoisted(() => ({ receive: undefined as any, message: undefined as any, close: vi.fn(), streamer: vi.fn(), report: vi.fn(), directCreated: vi.fn() }));
vi.mock("../src/cloud-module-source.ts", () => ({ observeCloudConfig: (receive: any) => { mocks.receive = receive; return Object.assign(mocks.close, { report: mocks.report }); } }));
vi.mock("@stream-overlay/stream-chat", async importOriginal => ({ ...await importOriginal<typeof import('@stream-overlay/stream-chat')>(), DirectStreamChatService: class {
  constructor() { mocks.directCreated(); }
  messages = { subscribe: (receive: any) => { mocks.message = receive; return () => {}; } };
  setStreamerDid = mocks.streamer; stop = vi.fn();
} }));
afterEach(() => { window.dispatchEvent(new Event("pagehide")); vi.useRealTimers(); vi.resetModules(); document.body.replaceChildren(); mocks.close.mockClear(); mocks.streamer.mockClear(); mocks.directCreated.mockClear(); history.replaceState({}, '', '/'); });
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
test("admin preview generates sample avatars and messages without observing live chat", async () => {
  vi.useFakeTimers(); history.replaceState({}, '', '/chat/?did=did:plc:alice&preview=1');
  document.body.innerHTML = '<div id="app"></div>';
  await import('../src/cloud-chat.ts');
  mocks.receive({ streamerDid: 'did:plc:alice', modules: { chat: true }, chat: { ...defaultChatConfiguration, fontSize: 28 } });
  await flushPromises();
  expect(mocks.directCreated).not.toHaveBeenCalled();
  expect(mocks.streamer).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.chat-message')).toHaveLength(4);
  expect(document.body.textContent).toContain('Hey everyone!');
  expect(document.querySelector<HTMLImageElement>('.chat-avatar')?.src).toMatch(/^data:image\/svg\+xml/);
  expect((document.querySelector('.chat-messages') as HTMLElement).style.fontSize).toBe('28px');
  await vi.advanceTimersByTimeAsync(35_000); await flushPromises();
  expect(document.querySelector('.chat-message:not(.chat-bubble-leave-active)')).not.toBeNull();
  mocks.receive({ streamerDid: 'did:plc:alice', modules: { chat: false }, chat: defaultChatConfiguration }); await flushPromises();
  expect(document.querySelector('.chat-plane')).toBeNull();
  await vi.advanceTimersByTimeAsync(1000); await flushPromises();
  expect(vi.getTimerCount()).toBe(0);
});
