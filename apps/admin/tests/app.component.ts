import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../src/App.vue";

const moduleResponse = [{
  id: "pokemon-blue",
  name: "Pokémon Blue mGBA",
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
      return Response.json({ ...moduleResponse[0], enabled: false, status: "stopped" });
    }
    return Response.json(url === "/api/config" ? streamConfigResponse : configResponse);
  });
}

describe("Admin App", () => {
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
    expect(wrapper.get("code").text()).toContain("streamer=did%3Aplc%3Atest");
    expect(wrapper.get("iframe").attributes("src")).toContain("/overlays/pokemon-blue/?streamer=did%3Aplc%3Atest");
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
      "/overlays/pokemon-blue/?streamer=did%3Aplc%3Atest",
    ));
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
