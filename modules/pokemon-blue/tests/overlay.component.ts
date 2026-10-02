import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import App from "../src/App.vue";

const chat = vi.hoisted(() => ({
  listeners: new Set<(message: { id: string; text: string; author: { did: string } }) => void>(),
  close: vi.fn(),
}));
vi.mock("@stream-overlay/stream-chat", () => ({ observeStreamChat: () => ({
  close: chat.close,
  messages: { subscribe: (listener: Parameters<typeof chat.listeners.add>[0]) => {
    chat.listeners.add(listener);
    return () => chat.listeners.delete(listener);
  } },
}) }));

afterEach(() => {
  chat.listeners.clear();
  chat.close.mockClear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  vi.useFakeTimers();
  const sources: Array<{ onmessage?: (event: { data: string }) => void; onerror?: () => void; close: () => void }> = [];
  vi.stubGlobal("EventSource", class {
    close = vi.fn();
    constructor(public url: string) { sources.push(this); }
  });
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/snapshot")) return Response.json({ party: [{ id: "kleo", name: "Kleo", dexNumber: 25 }], badges: null, capturedAt: "" });
    if (url.endsWith("/config")) return Response.json({ components: { team: true, badges: true } });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(App, { global: { stubs: {
    PokemonTeam: { props: ["party", "activePets"], template: '<div data-team>{{ party[0]?.name }}<span v-if="activePets.kleo" data-pet>pet</span></div>' },
    BadgeStrip: { template: '<div data-badges>badges</div>' },
  } } });
  const state = async (enabled: boolean) => {
    sources[0]!.onmessage!({ data: JSON.stringify({ enabled }) });
    await flushPromises();
  };
  const pet = async () => {
    for (const listener of chat.listeners) listener({ id: "pet", text: "!pet Kleo", author: { did: "did:plc:viewer" } });
    await flushPromises();
  };
  return { wrapper, state, sources, fetch, pet };
}

test("an initially disabled OBS document enables and disables repeatedly without reloading", async () => {
  const app = setup();
  try {
    await app.state(false);
    expect(app.wrapper.find("[data-team]").exists()).toBe(false);
    expect(chat.listeners.size).toBe(0);
    await app.state(true);
    expect(app.wrapper.text()).toContain("Kleo");
    expect(app.wrapper.find("[data-badges]").exists()).toBe(true);
    await app.pet();
    expect(app.wrapper.find("[data-pet]").exists()).toBe(true);
    await app.state(false);
    expect(app.wrapper.text()).toBe("");
    expect(chat.listeners.size).toBe(0);
    const calls = app.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(app.fetch.mock.calls.length).toBe(calls);
    await app.pet();
    await app.state(true);
    expect(app.wrapper.find("[data-pet]").exists()).toBe(false);
    expect(app.sources).toHaveLength(1);
    await app.pet();
    expect(app.wrapper.find("[data-pet]").exists()).toBe(true);
    await app.state(false);
    expect(app.wrapper.text()).toBe("");
  } finally { app.wrapper.unmount(); }
  expect(app.sources[0]!.close).toHaveBeenCalled();
});

test("disconnect hides the overlay and reconnect restores the current state", async () => {
  const app = setup();
  try {
    await app.state(true);
    app.sources[0]!.onerror!();
    await flushPromises();
    expect(app.wrapper.text()).toBe("");
    expect(chat.listeners.size).toBe(0);
    await app.state(true);
    expect(app.wrapper.text()).toContain("Kleo");
    expect(chat.listeners.size).toBe(1);
  } finally { app.wrapper.unmount(); }
});

test("switching off during initial data loading cannot restart chat after the response arrives", async () => {
  const app = setup();
  let resolve!: (response: Response) => void;
  app.fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  try {
    app.sources[0]!.onmessage!({ data: JSON.stringify({ enabled: true }) });
    await app.state(false);
    resolve(Response.json({ party: [{ id: "kleo", name: "Kleo" }], badges: null, capturedAt: "" }));
    await flushPromises();
    expect(app.wrapper.text()).toBe("");
    expect(chat.listeners.size).toBe(0);
  } finally { app.wrapper.unmount(); }
});
