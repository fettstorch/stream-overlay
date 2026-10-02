import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../src/App.vue";

const moduleResponse = [{
  id: "pokemon-blue",
  name: "Pokémon Blue mGBA",
  streamerQuery: false,
  description: "Shows the live Pokémon team.",
  requirements: ["Pokémon Blue must be running in mGBA."],
  chatCommands: [{ command: "!pet <Pokémon name>", description: "Pet an active team member." }],
  enabled: true,
  status: "running",
  overlayUrl: "/overlays/pokemon-blue/",
  error: null,
}];
const configResponse = {
  components: { team: true, badges: true },
};
const streamConfigResponse = {
  streamerDid: "did:plc:test",
  profile: {
    did: "did:plc:test",
    handle: "streamer.bsky.social",
    displayName: "Streamer",
    avatar: "https://cdn.example/avatar.jpg",
  },
};

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/modules") return Response.json(moduleResponse);
    if (url === "/api/config" && !init?.method) return Response.json(streamConfigResponse);
    if (url === "/api/pokemon-blue/config" && !init?.method) return Response.json(configResponse);
    if (url.startsWith("/api/actors/search")) return Response.json({ actors: [{
      did: "did:plc:alice",
      handle: "alice.bsky.social",
      displayName: "Alice",
      avatar: "https://cdn.example/alice.jpg",
    }] });
    if (url.startsWith("/api/modules/")) {
      const enabled = JSON.parse(String(init?.body)).enabled;
      return Response.json({ ...moduleResponse[0], enabled, status: enabled ? "running" : "stopped" });
    }
    return Response.json(url === "/api/config" ? streamConfigResponse : configResponse);
  });
}

describe("Admin App", () => {
  test("Chat recommends stream height and automatically saves its spatial fade", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch();
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/modules") return Response.json([{
        ...moduleResponse[0], id: "chat", name: "Chat", obsSize: "stream-height", streamerQuery: false,
        overlayUrl: "/overlays/chat/",
      }]);
      if (url === "/api/chat/config") return Response.json({ fadeOut: 0 });
      if (url === "/api/stream/dimensions") return Response.json({ streamerDid: "did:plc:test", dimensions: { width: 1280, height: 720 } });
      return fallback(input, init);
    });
    const wrapper = mount(App);
    try {
      await flushPromises();
      expect(wrapper.get(".obs-dimensions code").text()).toBe("Height: 720 px");
      expect(wrapper.find(".stream-background").exists()).toBe(false);
      const preview = wrapper.get("iframe").element;
      await wrapper.get('input[aria-label="Chat fade-out percentage"]').setValue(80);
      await vi.advanceTimersByTimeAsync(300);
      await flushPromises();
      const write = fetchMock.mock.calls.find(([url, init]) => url === "/api/chat/config" && init?.method === "PATCH");
      expect(JSON.parse(String(write?.[1]?.body))).toEqual({ fadeOut: 80, fontSize: 20, backgroundColor: "#000000", backgroundOpacity: 65, rotationX: 0, rotationY: 0 });
      await wrapper.get('input[aria-label="Chat font size"]').setValue(32);
      await wrapper.get('input[aria-label="Chat message background color"]').setValue("#123456");
      await wrapper.get('input[aria-label="Chat message background opacity"]').setValue(40);
      await wrapper.get('input[aria-label="Chat X rotation"]').setValue(25);
      await wrapper.get('input[aria-label="Chat Y rotation"]').setValue(-35);
      await vi.advanceTimersByTimeAsync(300);
      await flushPromises();
      const lastWrite = fetchMock.mock.calls.filter(([url, init]) => url === "/api/chat/config" && init?.method === "PATCH").at(-1);
      expect(JSON.parse(String(lastWrite?.[1]?.body))).toEqual({ fadeOut: 80, fontSize: 32, backgroundColor: "#123456", backgroundOpacity: 40, rotationX: 25, rotationY: -35 });
      expect(wrapper.get("iframe").element).toBe(preview);
      expect(wrapper.text()).toContain("Saved");
    } finally { wrapper.unmount(); }
  });
  test("shows the Chat module with its preview and DID-free OBS URL", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce(Response.json([{
      ...moduleResponse[0], id: "chat", name: "Chat", description: "Live stream chat", requirements: [], chatCommands: [],
      overlayUrl: "/overlays/chat/", streamerQuery: false,
    }]));
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get("h3").text()).toBe("Chat");
    expect(wrapper.get(".overlay-url code").text()).toContain("/overlays/chat/");
    expect(wrapper.get(".overlay-url code").text()).not.toContain("streamer=");
    expect(wrapper.get('iframe[title="Chat live preview"]').attributes("src")).toContain("/overlays/chat/");
    wrapper.unmount();
  });
  test("disabled modules start collapsed and toggles do not change the chosen expansion state", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce(Response.json([{ ...moduleResponse[0], enabled: false, status: "stopped" }]));
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get(".module-body").attributes("style")).toContain("display: none");
    await wrapper.get('button[aria-label="Show Pokémon Blue mGBA details"]').trigger("click");
    expect(wrapper.find(".module-body").exists()).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/modules/")).length).toBe(0);
    await wrapper.get('input[aria-label="Enable Pokémon Blue mGBA"]').setValue(true);
    await flushPromises();
    expect(wrapper.find(".module-body").exists()).toBe(true);
    await wrapper.get('input[aria-label="Enable Pokémon Blue mGBA"]').setValue(false);
    await flushPromises();
    expect(wrapper.get(".module-body").attributes("style") ?? "").not.toContain("display: none");
    expect(wrapper.get('button[aria-label="Hide Pokémon Blue mGBA details"]').attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });

  test("enabled modules can fold independently without host writes or reloading their preview", async () => {
    const fetchMock = mockFetch();
    const wrapper = mount(App);
    try {
      await flushPromises();
      const preview = wrapper.get("iframe").element;
      await wrapper.get('button[aria-label="Hide Pokémon Blue mGBA details"]').trigger("click");
      expect(wrapper.get(".module-body").attributes("style")).toContain("display: none");
      expect(wrapper.get('input[aria-label="Enable Pokémon Blue mGBA"]').element).toHaveProperty("checked", true);
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
      await wrapper.get('input[aria-label="Enable Pokémon Blue mGBA"]').setValue(false);
      await flushPromises();
      await wrapper.get('input[aria-label="Enable Pokémon Blue mGBA"]').setValue(true);
      await flushPromises();
      expect(wrapper.get(".module-body").attributes("style")).toContain("display: none");
      await wrapper.get('button[aria-label="Show Pokémon Blue mGBA details"]').trigger("click");
      expect(wrapper.get(".module-body").attributes("style") ?? "").not.toContain("display: none");
      expect(wrapper.get("iframe").element).toBe(preview);
    } finally { wrapper.unmount(); }
  });

  test("pins reorder modules and persist across admin reloads without host writes", async () => {
    const fetchMock = mockFetch();
    const pets = { ...moduleResponse[0], id: "streamplace-pets", name: "Streamplace Pets", description: "Interactive pets", chatCommands: [] };
    const respond = () => fetchMock.mockResolvedValueOnce(Response.json([...moduleResponse, pets]));
    respond();
    const wrapper = mount(App);
    await flushPromises();
    const petsPreview = wrapper.get('iframe[title="Streamplace Pets live preview"]').element;
    await wrapper.get('button[aria-label="Pin Streamplace Pets"]').trigger("click");
    expect(wrapper.findAll(".module-card")[0]!.get("h3").text()).toBe("Streamplace Pets");
    expect(wrapper.get('button[aria-label="Unpin Streamplace Pets"]').attributes("aria-pressed")).toBe("true");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    expect(wrapper.get('iframe[title="Streamplace Pets live preview"]').element).toBe(petsPreview);
    wrapper.unmount();
    respond();
    const reloaded = mount(App);
    await flushPromises();
    expect(reloaded.findAll(".module-card")[0]!.get("h3").text()).toBe("Streamplace Pets");
    await reloaded.get('button[aria-label="Unpin Streamplace Pets"]').trigger("click");
    expect(reloaded.findAll(".module-card")[0]!.get("h3").text()).toBe("Pokémon Blue mGBA");
    reloaded.unmount();
  });

  test("search is trimmed, case insensitive, includes descriptions and never toggles modules", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce(Response.json([...moduleResponse, {
      ...moduleResponse[0], id: "streamplace-pets", name: "Streamplace Pets", description: "Interactive animals", chatCommands: [],
    }]));
    const wrapper = mount(App);
    await flushPromises();
    const calls = fetchMock.mock.calls.length;
    const previews = wrapper.findAll("iframe").map(frame => frame.element);
    const search = wrapper.get('input[aria-label="Search modules"]');
    await search.setValue("  ANIMALS  ");
    expect(wrapper.findAll(".module-card").filter(card => card.isVisible()).map(card => card.get("h3").text())).toEqual(["Streamplace Pets"]);
    await search.setValue("no such module");
    expect(wrapper.get(".no-modules").text()).toContain("No modules match");
    await search.setValue("");
    expect(wrapper.findAll(".module-card").every(card => (card.element as HTMLElement).style.display !== "none")).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(wrapper.findAll("iframe").map(frame => frame.element)).toEqual(previews);
    wrapper.unmount();
  });

  test("malformed pin storage does not prevent the admin from loading", async () => {
    localStorage.setItem("stream-overlay.admin.pinned-modules", "not json");
    mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get('button[aria-label="Pin Pokémon Blue mGBA"]').attributes("aria-pressed")).toBe("false");
    wrapper.unmount();
  });
  test("displays module state and its configured OBS URL", async () => {
    mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.text()).toContain("Pokémon Blue mGBA");
    expect(wrapper.text()).toContain("running");
    expect(wrapper.get('[role="tooltip"]').text()).toContain("Add a Browser Source and paste the URL shown below");
    expect(wrapper.get('[role="tooltip"]').text()).toContain("Pokémon Blue must be running in mGBA");
    expect(wrapper.get(".chat-command code").text()).toBe("!pet <Pokémon name>");
    expect(wrapper.get(".chat-command").text()).toContain("Pet an active team member");
    expect(wrapper.get('button[aria-label="About Pokémon Blue mGBA"]')).toBeTruthy();
    expect(wrapper.get('input[aria-label="Enable Pokémon Blue mGBA"]').attributes("aria-describedby")).toBeUndefined();
    expect(wrapper.get("code").text()).not.toContain("streamer=");
    expect(wrapper.get("iframe").attributes("src")).toContain("/overlays/pokemon-blue/");
    expect(wrapper.get("iframe").attributes("src")).not.toContain("streamer=");
  });

  test("enables and disables a module through the host API", async () => {
    const fetchMock = mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('input[aria-label="Enable Pokémon Blue mGBA"]').setValue(false);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/modules/pokemon-blue", expect.objectContaining({
      method: "PATCH",
    }));
    expect(wrapper.text()).toContain("stopped");
  });

  test("copies the complete OBS URL", async () => {
    mockFetch();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('button[aria-label="Copy Pokémon Blue mGBA OBS URL"]').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(
      "/overlays/pokemon-blue/",
    ));
    expect(writeText.mock.calls[0]![0]).not.toContain("streamer=");
    expect(wrapper.get('button[aria-label="Pokémon Blue mGBA OBS URL copied"]')).toBeTruthy();
  });

  test("saves a pasted DID independently of modules", async () => {
    const fetchMock = mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('.stream-settings input').setValue("did:plc:updated");
    await wrapper.get('.stream-settings input').trigger("keydown.enter");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/config", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ streamerDid: "did:plc:updated" }),
    }));
  });

  test("searches for a profile and saves only its DID when selected", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('.stream-settings input').setValue("Alice");
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(wrapper.text()).toContain("@alice.bsky.social");
    await wrapper.get('[role="option"]').trigger("click");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/config", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ streamerDid: "did:plc:alice" }),
    }));
  });

  test("saves Pokémon Blue component settings", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    const checkboxes = wrapper.findAll('.module-settings input[type="checkbox"]');
    await checkboxes[1]!.setValue(false);
    await vi.advanceTimersByTimeAsync(350);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/pokemon-blue/config", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        components: { team: true, badges: false },
      }),
    }));
    expect(wrapper.text()).toContain("Saved");
  });

  test("layers the interactive paint preview over the stream without changing the OBS URL", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch();
    fetchMock.mockImplementation(async input => {
      const url = String(input);
      if (url === "/api/modules") return Response.json([{
        ...moduleResponse[0], id: "overlay-paint", name: "Overlay Paint",
        overlayUrl: "/overlays/overlay-paint/", preview: { streamBackground: true, interactive: true },
        streamerQuery: false,
      }]);
      if (url === "/api/config") return Response.json(streamConfigResponse);
      if (url === "/api/overlay-paint/config") return Response.json({ color: "#ff5cbe", decaySeconds: 4 });
      if (url === "/api/stream/dimensions") return Response.json({ streamerDid: "did:plc:test", dimensions: { width: 1080, height: 1920 } });
      return Response.json(configResponse);
    });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get(".stream-background").attributes("src")).toBe("https://stream.place/embed/streamer.bsky.social");
    expect(wrapper.get(".paint-foreground").attributes("src")).toContain("interactive=1");
    expect(wrapper.get(".overlay-url code").text()).not.toContain("interactive");
    expect(wrapper.get(".overlay-url code").text()).not.toContain("streamer");
    expect(wrapper.get(".module-preview").attributes("style")).toContain("1080 / 1920");
    expect(wrapper.get(".obs-dimensions code").text()).toContain("Width: 1080 px");
    expect(wrapper.get(".obs-dimensions code").text()).toContain("Height: 1920 px");
    expect(wrapper.text()).not.toContain("Draw in preview");
    await wrapper.get('input[aria-label="Paint brush color"]').setValue("#123456");
    await wrapper.get('input[aria-label="Paint fade delay in seconds"]').setValue("8");
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/overlay-paint/config", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ color: "#123456", decaySeconds: 8 }),
    }));
    expect(wrapper.text()).toContain("Saved");
    wrapper.unmount();
  });
});
