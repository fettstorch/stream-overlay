import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import type { StreamChatMessage } from "@stream-overlay/stream-chat";
import App from "../src/App.vue";
import { freezeLeavingMessage, restoreLeavingMessage } from "../src/message-transition";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(animated = false) {
  const sources: FakeEvents[] = [];
  class FakeEvents {
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    close = vi.fn();
    listeners = new Set<(event: { data: string }) => void>();
    constructor(public url: string) { sources.push(this); }
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === "message") this.listeners.add(listener);
    }
    emit(value: unknown) { for (const listener of this.listeners) listener({ data: JSON.stringify(value) }); }
  }
  vi.stubGlobal("EventSource", FakeEvents);
  const wrapper = mount(App, { global: { stubs: { ...(animated ? { TransitionGroup: false } : {}) } } });
  const state = async (enabled: boolean, configuration?: unknown) => {
    sources[0]!.onmessage!({ data: JSON.stringify({ enabled, configuration }) });
    await flushPromises();
  };
  const message = async (value: unknown) => {
    sources.at(-1)!.emit(value);
    await flushPromises();
  };
  return { wrapper, sources, state, message };
}

function message(id = "1", text = "Hello stream!"): StreamChatMessage {
  return { id, text, streamerDid: "did:plc:streamer", author: { did: "did:plc:alice", handle: "alice.bsky.social", displayName: "Alice" }, createdAt: "2026-10-02T12:00:00Z" };
}

test("freezes an evicted bubble's position and size without shifting its neighbors", () => {
  const parent = document.createElement("ol");
  const bubble = document.createElement("li");
  parent.append(bubble);
  vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20 } as DOMRect);
  vi.spyOn(bubble, "getBoundingClientRect").mockReturnValue({ left: 26, top: 52, width: 280, height: 72 } as DOMRect);
  freezeLeavingMessage(bubble);
  expect(bubble.style.left).toBe("16px");
  expect(bubble.style.top).toBe("32px");
  expect(bubble.style.width).toBe("280px");
  expect(bubble.style.height).toBe("72px");
  restoreLeavingMessage(bubble);
  expect(bubble.getAttribute("style")).toBe("");
});

test("real TransitionGroup applies entrance and eviction classes, but disabling remains immediate", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const app = setup(true);
  try {
    await app.state(true);
    await app.message(message("0"));
    expect(app.wrapper.get("li").classes()).toContain("chat-bubble-enter-active");
    expect(app.wrapper.get("li").classes()).toContain("chat-bubble-enter-from");
    for (let i = 1; i <= 50; i++) await app.message(message(String(i)));
    expect(app.wrapper.findAll(".chat-bubble-leave-active")).toHaveLength(1);
    while (frames.length) frames.shift()!(0);
    await flushPromises();
    expect(app.wrapper.findAll("li")).toHaveLength(50);
    await app.state(false);
    expect(app.wrapper.find("ol").exists()).toBe(false);
  } finally { app.wrapper.unmount(); }
});

test("fade settings update live without losing chat or reconnecting the feed", async () => {
  const app = setup();
  try {
    await app.state(true, { fadeOut: 0 });
    await app.message(message());
    expect(app.wrapper.get("ol").attributes("style")).toContain("mask-image: none");
    await app.state(true, { fadeOut: 80 });
    expect(app.wrapper.get("ol").attributes("style")).toContain("transparent 80%, black 88%");
    expect(app.wrapper.text()).toContain("Hello stream!");
    expect(app.sources).toHaveLength(2);
    expect(app.sources[1]!.close).not.toHaveBeenCalled();
    await app.state(true, { fadeOut: 100 });
    expect(app.wrapper.get("ol").attributes("style")).toContain("linear-gradient(transparent, transparent)");
    await app.state(true, { fadeOut: -1 });
    expect(app.wrapper.get("ol").attributes("style")).toContain("linear-gradient(transparent, transparent)");
  } finally { app.wrapper.unmount(); }
});

test("shows avatar beside stacked name and message, with live appearance and image fallback", async () => {
  const app = setup();
  try {
    await app.state(true);
    const incoming = message();
    incoming.author.avatar = "https://cdn.example/avatar.png";
    await app.message(incoming);
    const row = app.wrapper.get(".chat-message");
    expect(row.get("img").attributes("src")).toBe(incoming.author.avatar);
    expect(row.get(".chat-content strong").text()).toBe("Alice");
    expect(row.get(".chat-content span").text()).toBe("Hello stream!");
    await app.state(true, { fadeOut: 0, fontSize: 32, backgroundColor: "#123456", backgroundOpacity: 40 });
    expect(app.wrapper.get("ol").attributes("style")).toContain("font-size: 32px");
    expect(app.wrapper.get("ol").attributes("style")).toContain("--message-background: rgba(18, 52, 86, 0.4)");
    expect(app.sources).toHaveLength(2);
    await row.get("img").trigger("error");
    expect(row.find("img").exists()).toBe(false);
    expect(row.get(".avatar-fallback").text()).toBe("A");
    await app.state(true, { fadeOut: 0, fontSize: 32, backgroundColor: "#123456", backgroundOpacity: 0 });
    expect(app.wrapper.get("ol").attributes("style")).toContain("rgba(18, 52, 86, 0)");
    expect(row.get(".chat-content span").text()).toBe("Hello stream!");
  } finally { app.wrapper.unmount(); }
});

test("renders author and text from the shared chat feed, without HTML interpretation", async () => {
  const app = setup();
  try {
    expect(app.wrapper.text()).toBe("");
    await app.state(true);
    expect(app.sources.map(source => source.url)).toEqual(["/api/modules/chat/events", "/api/chat/events"]);
    await app.message(message("1", '<img src=x onerror="alert(1)">'));
    expect(app.wrapper.get("strong").text()).toBe("Alice");
    expect(app.wrapper.get(".chat-message span").text()).toContain("<img src=x");
    expect(app.wrapper.find("img").exists()).toBe(false);
    await app.message({ ...message("2"), author: { did: "did:plc:bob", handle: "bob.bsky.social" } });
    expect(app.wrapper.findAll("strong")[1]!.text()).toBe("bob.bsky.social");
  } finally { app.wrapper.unmount(); }
});

test("bounds recent messages, ignores duplicates and invalid data, and separates streams", async () => {
  const app = setup();
  try {
    await app.state(true);
    for (let i = 0; i < 55; i++) app.sources.at(-1)!.emit(message(String(i), `Message ${i}`));
    await flushPromises();
    const rows = app.wrapper.findAll(".chat-message");
    expect(rows).toHaveLength(50);
    expect(rows[0]!.text()).toContain("Message 5");
    expect(rows.at(-1)!.text()).toContain("Message 54");
    await app.message(message("54", "duplicate"));
    await app.message({ id: "bad", text: "bad" });
    await app.message(null);
    expect(app.wrapper.findAll(".chat-message")).toHaveLength(50);
    expect(app.wrapper.text()).not.toContain("duplicate");
    await app.message({ ...message("new"), streamerDid: "did:plc:other-streamer" });
    expect(app.wrapper.findAll(".chat-message")).toHaveLength(1);
  } finally { app.wrapper.unmount(); }
});

test("live disabling clears messages and stops chat, then resumes without a source reload", async () => {
  const app = setup();
  try {
    await app.state(false);
    expect(app.sources).toHaveLength(1);
    await app.state(true);
    await app.message(message());
    const oldChat = app.sources.at(-1)!;
    await app.state(false);
    expect(app.wrapper.text()).toBe("");
    expect(oldChat.close).toHaveBeenCalled();
    expect(app.sources[0]!.close).not.toHaveBeenCalled();
    await app.state(true);
    oldChat.emit(message("old", "Must not return"));
    await flushPromises();
    expect(app.wrapper.text()).toBe("");
    await app.message(message("fresh", "Fresh chat"));
    expect(app.wrapper.text()).toContain("Fresh chat");
  } finally { app.wrapper.unmount(); }
  expect(app.sources.every(source => source.close.mock.calls.length > 0)).toBe(true);
});

test("status interruption hides the chat until the current state arrives again", async () => {
  const app = setup();
  try {
    await app.state(true);
    await app.message(message());
    app.sources[0]!.onerror!();
    await flushPromises();
    expect(app.wrapper.text()).toBe("");
    await app.state(true);
    await app.message(message("new", "Reconnected"));
    expect(app.wrapper.text()).toContain("Reconnected");
  } finally { app.wrapper.unmount(); }
});
