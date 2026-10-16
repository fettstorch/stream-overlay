import { afterEach, expect, test, vi } from "vitest";
import { shallowRef } from "vue";
import { overlayRuntimeKey } from "../src/shared-overlay-runtime.ts";
import OverlayChat from "../src/OverlayChat.vue";
import { SampleChatService } from "@streamface/stream-chat";
import { mount, flushPromises } from "@vue/test-utils";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";
const mocks = vi.hoisted(() => ({
  receive: undefined as any,
  message: undefined as any,
  close: vi.fn(),
  streamer: vi.fn(),
  report: vi.fn(),
  directCreated: vi.fn(),
}));
vi.mock("@streamface/stream-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@streamface/stream-chat")>()),
  DirectStreamChatService: class {
    constructor() {
      mocks.directCreated();
    }
    messages = {
      subscribe: (receive: any) => {
        mocks.message = receive;
        return () => {};
      },
    };
    setStreamerDid = mocks.streamer;
    stop = vi.fn();
  },
}));
let wrapper: ReturnType<typeof mount> | undefined;
async function start(preview = false) {
  const config = shallowRef<any>();
  let receive: (() => void) | undefined;
  const host: any = {
    did: "did:plc:alice",
    preview,
    config,
    report: mocks.report,
    samples: preview ? new SampleChatService() : undefined,
    chat: {
      messages: {
        subscribe: (callback: any) => {
          mocks.message = callback;
          return () => {};
        },
      },
    },
    subscribe: (callback: any) => {
      receive = callback;
      return () => {};
    },
    acquireChat: () => {
      mocks.streamer("did:plc:alice");
      return () => mocks.streamer("");
    },
  };
  mocks.receive = (value: any) => {
    config.value = { ...value, modules: { paint: true, pets: true, ...value.modules } };
    receive?.();
  };
  wrapper = mount(OverlayChat, {
    attachTo: document.querySelector("#app")!,
    global: { provide: { [overlayRuntimeKey as symbol]: host } },
  });
}
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  vi.resetModules();
  document.body.replaceChildren();
  mocks.close.mockClear();
  mocks.streamer.mockClear();
  mocks.directCreated.mockClear();
  history.replaceState({}, "", "/");
});
test("cloud chat reuses author avatars, appearance and timed decay, then stops when disabled", async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="app"></div>';
  await start();
  const state = {
    streamerDid: "did:plc:alice",
    modules: { chat: true },
    chat: { ...defaultChatConfiguration, fontSize: 32 },
  };
  mocks.receive(state);
  await flushPromises();
  mocks.message({
    id: "msg1",
    streamerDid: state.streamerDid,
    text: "Hello",
    author: { did: "did:plc:bob", handle: "bob.test", avatar: "https://cdn.example/bob.jpg" },
  });
  await flushPromises();
  expect(document.querySelector<HTMLImageElement>(".chat-avatar")?.src).toBe(
    "https://cdn.example/bob.jpg",
  );
  expect((document.querySelector(".chat-messages") as HTMLElement).style.fontSize).toBe("32px");
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      origin: location.origin,
      data: {
        type: "chat-preview-configuration",
        configuration: { ...defaultChatConfiguration, fontSize: 50 },
      },
    }),
  );
  await flushPromises();
  expect((document.querySelector(".chat-messages") as HTMLElement).style.fontSize).toBe("32px");
  expect((document.querySelector(".chat-message") as HTMLElement).style.animationDelay).toBe(
    "20000ms",
  );
  expect((document.querySelector(".chat-message") as HTMLElement).style.animationDuration).toBe(
    "10000ms",
  );
  await vi.advanceTimersByTimeAsync(30001);
  await flushPromises();
  expect(document.querySelector(".chat-message:not(.chat-bubble-leave-active)")).toBeNull();
  mocks.receive({ ...state, modules: { chat: false } });
  await flushPromises();
  expect(document.querySelector(".chat-plane")).toBeNull();
  expect(mocks.streamer).toHaveBeenLastCalledWith("");
});
test("admin preview generates sample avatars and messages without observing live chat", async () => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/chat/?did=did:plc:alice&preview=1");
  document.body.innerHTML = '<div id="app"></div>';
  await start(true);
  mocks.receive({
    streamerDid: "did:plc:alice",
    modules: { chat: true },
    chat: { ...defaultChatConfiguration, fontSize: 28 },
  });
  await flushPromises();
  expect(mocks.directCreated).not.toHaveBeenCalled();
  expect(mocks.streamer).not.toHaveBeenCalled();
  expect(document.querySelectorAll(".chat-message")).toHaveLength(4);
  expect(document.body.textContent).toContain("Hey everyone!");
  expect(document.querySelector<HTMLImageElement>(".chat-avatar")?.src).toMatch(
    /^data:image\/svg\+xml/,
  );
  expect((document.querySelector(".chat-messages") as HTMLElement).style.fontSize).toBe("28px");
  const update = {
    type: "chat-preview-configuration",
    configuration: { ...defaultChatConfiguration, fontSize: 36, rotationY: 25 },
  };
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      origin: "https://untrusted.example",
      data: update,
    }),
  );
  await flushPromises();
  expect((document.querySelector(".chat-messages") as HTMLElement).style.fontSize).toBe("28px");
  window.dispatchEvent(
    new MessageEvent("message", { source: window.parent, origin: location.origin, data: update }),
  );
  await flushPromises();
  expect((document.querySelector(".chat-messages") as HTMLElement).style.fontSize).toBe("36px");
  expect((document.querySelector(".chat-plane") as HTMLElement).style.transform).toContain(
    "rotate3d(0, 25, 0, 25deg)",
  );
  await vi.advanceTimersByTimeAsync(35_000);
  await flushPromises();
  expect(document.querySelector(".chat-message:not(.chat-bubble-leave-active)")).not.toBeNull();
  mocks.receive({
    streamerDid: "did:plc:alice",
    modules: { chat: false },
    chat: defaultChatConfiguration,
  });
  await flushPromises();
  expect(document.querySelector(".chat-plane")).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  await flushPromises();
  expect(vi.getTimerCount()).toBe(0);
});

test("Stream.place preview observes live chat and releases it when disabled", async () => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/overlay/?preview=1&only=chat&chatSource=streamplace");
  document.body.innerHTML = '<div id="app"></div>';
  await start(true);
  const state = {
    streamerDid: "did:plc:alice",
    modules: { chat: true },
    chat: defaultChatConfiguration,
  };
  mocks.receive(state);
  await flushPromises();
  expect(mocks.streamer).toHaveBeenLastCalledWith(state.streamerDid);
  expect(document.querySelectorAll(".chat-message")).toHaveLength(0);
  mocks.message({
    id: "live-preview",
    streamerDid: state.streamerDid,
    text: "Live fixture message",
    author: { did: "did:plc:bob", displayName: "Bob", avatar: "https://cdn.example/bob.jpg" },
  });
  await flushPromises();
  expect(document.body.textContent).toContain("Live fixture message");
  expect(document.querySelector<HTMLImageElement>(".chat-avatar")?.src).toBe(
    "https://cdn.example/bob.jpg",
  );
  expect(document.body.textContent).not.toContain("Hey everyone!");
  mocks.receive({ ...state, modules: { chat: false } });
  await flushPromises();
  expect(mocks.streamer).toHaveBeenLastCalledWith("");
  expect(vi.getTimerCount()).toBe(0);
});
