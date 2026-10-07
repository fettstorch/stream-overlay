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

function setup(moduleId = "pokemon-blue") {
  vi.useFakeTimers();
  const sources: Array<{ onmessage?: (event: { data: string }) => void; onerror?: () => void; close: () => void }> = [];
  vi.stubGlobal("EventSource", class {
    close = vi.fn();
    constructor(public url: string) { sources.push(this); }
  });
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/snapshot")) return Response.json({ party: [{ id: "kleo", name: "Kleo", dexNumber: 25 }], badges: null, capturedAt: "" });
    if (url.endsWith("/config")) return Response.json({ components: { team: true, badges: true } });
    if (url.includes("/pet-favourite/")) return Response.json({ avatar: "/favourite.png", authorDid: "did:plc:viewer", count: 3 });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetch);
  const wrapper = mount(App, { props: { moduleId }, global: { stubs: {
    PokemonTeam: { props: ["party", "activePets", "thought"], template: '<div data-team>{{ party[0]?.name }}<span v-if="activePets.kleo" data-pet>pet</span><span v-if="thought" data-thought>{{ thought.pokemonId }}</span></div>' },
    BadgeStrip: { template: '<div data-badges>badges</div>' },
  } } });
  const state = async (enabled: boolean, streamerDid?: string) => {
    sources[0]!.onmessage!({ data: JSON.stringify({ enabled, streamerDid }) });
    await flushPromises();
  };
  const pet = async () => {
    for (const listener of chat.listeners) listener({ id: "pet", text: "!pet Kleo", author: { did: "did:plc:viewer" } });
    await flushPromises();
  };
  return { wrapper, state, sources, fetch, pet };
}

test("Crystal uses its own API and control stream while retaining live toggles and petting", async () => {
  const app = setup("pokemon-crystal");
  try {
    await app.state(true);
    expect(app.fetch).toHaveBeenCalledWith("/api/pokemon-crystal/snapshot", { cache: "no-store" });
    expect(app.fetch).toHaveBeenCalledWith("/api/pokemon-crystal/config", { cache: "no-store" });
    expect((app.sources[0] as unknown as { url: string }).url).toBe("/api/modules/pokemon-crystal/events");
    expect(app.wrapper.get(".pokemon-overlay").classes()).toContain("pokemon-overlay--crystal");
    await app.pet(); expect(app.wrapper.find("[data-pet]").exists()).toBe(true);
    await app.state(false); expect(app.wrapper.text()).toBe("");
    await app.state(true); expect(app.wrapper.find("[data-team]").exists()).toBe(true);
    expect(app.fetch.mock.calls.some(([url]) => url.includes("/api/pokemon-blue/"))).toBe(false);
  } finally { app.wrapper.unmount(); }
});

test("streamer changes clear pets and invalidate pending thoughts while remaining enabled", async () => {
  const app = setup();
  const originalFetch = app.fetch.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  app.fetch.mockImplementation(async url => url.includes("/pet-favourite/")
    ? new Promise<Response>(done => { resolve = done; }) : originalFetch(url));
  try {
    await app.state(true, "did:plc:first");
    const oldListener = [...chat.listeners][0]!;
    await app.pet();
    await app.pet();
    expect(app.wrapper.find("[data-pet]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    await app.pet();
    await app.pet();
    await app.state(true, "did:plc:second");
    expect(app.wrapper.find("[data-pet]").exists()).toBe(false);
    expect(chat.listeners.size).toBe(1);
    resolve(Response.json({ avatar: "/old.png", authorDid: "old", count: 1 }));
    oldListener({ id: "late", text: "!pet Kleo", author: { did: "old" } });
    await flushPromises();
    expect(app.wrapper.find("[data-thought]").exists()).toBe(false);
    expect(app.wrapper.find("[data-pet]").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.wrapper.find("[data-pet]").exists()).toBe(false);
    await app.pet();
    expect(app.wrapper.find("[data-pet]").exists()).toBe(true);
  } finally { app.wrapper.unmount(); }
});

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

test("thoughts start after two minutes, last ten seconds, and stop when disabled", async () => {
  const app = setup();
  try {
    await app.state(true);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.wrapper.get("[data-thought]").text()).toBe("kleo");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(110_000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(true);
    await app.state(false);
    expect(app.wrapper.text()).toBe("");
    const calls = app.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.fetch.mock.calls.length).toBe(calls);
  } finally { app.wrapper.unmount(); }
});

test("pet animations pause the thought visible-time countdown", async () => {
  const app = setup();
  try {
    await app.state(true);
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(3000);
    await app.pet();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(6999);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(false);
  } finally { app.wrapper.unmount(); }
});

test("short intervals do not replace an active ten-second thought", async () => {
  const app = setup();
  const originalFetch = app.fetch.getMockImplementation()!;
  app.fetch.mockImplementation(async url => url.endsWith("/config")
    ? Response.json({ components: { team: true, badges: true }, thoughtIntervalSeconds: 1 })
    : originalFetch(url));
  try {
    await app.state(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(9000);
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(2);
  } finally { app.wrapper.unmount(); }
});

test("slow thought lookups cannot overlap and skip positional slots", async () => {
  const app = setup();
  const originalFetch = app.fetch.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  app.fetch.mockImplementation(async url => {
    if (url.endsWith("/config")) return Response.json({ components: { team: true, badges: true }, thoughtIntervalSeconds: 1 });
    if (url.includes("/pet-favourite/")) return new Promise<Response>(done => { resolve = done; });
    return originalFetch(url);
  });
  try {
    await app.state(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(1);
    resolve(Response.json({ avatar: "/favourite.png", authorDid: "viewer", count: 1 }));
    await flushPromises();
    expect(app.wrapper.find("[data-thought]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(9000);
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(1);
  } finally { app.wrapper.unmount(); }
});

test("a thought tick skips members without a displayable favourite and bounds empty searches", async () => {
  const app = setup();
  const originalFetch = app.fetch.getMockImplementation()!;
  let allEmpty = false;
  app.fetch.mockImplementation(async url => {
    if (url.endsWith("/snapshot")) return Response.json({ party: [{ id: "empty", name: "Empty" }, { id: "no-avatar", name: "No avatar" }, { id: "kleo", name: "Kleo" }], badges: null, capturedAt: "" });
    if (url.endsWith("/pet-favourite/empty") || (allEmpty && url.includes("/pet-favourite/"))) return Response.json(null);
    if (url.endsWith("/pet-favourite/no-avatar")) return Response.json({ authorDid: "viewer", count: 1 });
    return originalFetch(url);
  });
  try {
    await app.state(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.wrapper.get("[data-thought]").text()).toBe("kleo");
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(3);
    allEmpty = true;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(false);
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(6);
  } finally { app.wrapper.unmount(); }
});

test("thoughts rotate by current team position and discard a late lookup after disabling", async () => {
  const app = setup();
  const originalFetch = app.fetch.getMockImplementation()!;
  let party = [{ id: "kleo", name: "Kleo" }, { id: "other", name: "Other" }];
  let delayed = false;
  let resolve!: (response: Response) => void;
  app.fetch.mockImplementation(async url => {
    if (url.endsWith("/snapshot")) return Response.json({ party, badges: null, capturedAt: "" });
    if (delayed && url.includes("/pet-favourite/")) return new Promise<Response>(done => { resolve = done; });
    return originalFetch(url);
  });
  try {
    await app.state(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.wrapper.get("[data-thought]").text()).toBe("kleo");
    // Swap positions: the next positional slot is now Kleo again, not a cached ID.
    party = [party[1]!, party[0]!];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.wrapper.get("[data-thought]").text()).toBe("kleo");
    party = [party[0]!];
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(false);
    delayed = true;
    await vi.advanceTimersByTimeAsync(119_000);
    await app.state(false);
    resolve(Response.json({ avatar: "/avatar.png", authorDid: "viewer", count: 1 }));
    await flushPromises();
    expect(app.wrapper.text()).toBe("");
  } finally { app.wrapper.unmount(); }
});

test("thought interval changes reschedule an open overlay without reloading or resetting chat", async () => {
  const app = setup();
  const originalFetch = app.fetch.getMockImplementation()!;
  let seconds = 120;
  app.fetch.mockImplementation(async url => url.endsWith("/config")
    ? Response.json({ components: { team: true, badges: true }, thoughtIntervalSeconds: seconds })
    : originalFetch(url));
  try {
    await app.state(true);
    seconds = 2;
    await vi.advanceTimersByTimeAsync(1000); // Existing config refresh sees the change.
    await vi.advanceTimersByTimeAsync(2000);
    expect(app.wrapper.find("[data-thought]").exists()).toBe(true);
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(1);
    seconds = 60;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.fetch.mock.calls.filter(([url]) => url.includes("/pet-favourite/"))).toHaveLength(1);
    expect(chat.listeners.size).toBe(1);
    expect(app.sources).toHaveLength(1);
    await app.state(false);
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
