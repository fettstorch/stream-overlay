import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../src/App.vue";

const moduleResponse = [{
  id: "pokemon-blue",
  name: "Pokémon Blue",
  enabled: true,
  status: "running",
  overlayUrl: "/overlays/pokemon-blue/",
  error: null,
}];
const configResponse = {
  streamerDid: "did:plc:test",
  components: { team: true, badges: true },
};

afterEach(() => vi.restoreAllMocks());

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/modules") return Response.json(moduleResponse);
    if (url === "/api/pokemon-blue/config" && !init?.method) return Response.json(configResponse);
    if (url.startsWith("/api/modules/")) {
      return Response.json({ ...moduleResponse[0], enabled: false, status: "stopped" });
    }
    return Response.json(configResponse);
  });
}

describe("Admin App", () => {
  test("displays module state and its configured OBS URL", async () => {
    mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.text()).toContain("Pokémon Blue");
    expect(wrapper.text()).toContain("running");
    expect(wrapper.get("code").text()).toContain("streamer=did%3Aplc%3Atest");
  });

  test("enables and disables a module through the host API", async () => {
    const fetchMock = mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('input[aria-label="Enable Pokémon Blue"]').setValue(false);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/modules/pokemon-blue", expect.objectContaining({
      method: "PATCH",
    }));
    expect(wrapper.text()).toContain("stopped");
  });

  test("saves Pokémon Blue component settings", async () => {
    const fetchMock = mockFetch();
    const wrapper = mount(App);
    await flushPromises();
    const checkboxes = wrapper.findAll('.settings input[type="checkbox"]');
    await checkboxes[1]!.setValue(false);
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/pokemon-blue/config", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        streamerDid: "did:plc:test",
        components: { team: true, badges: false },
      }),
    }));
    expect(wrapper.text()).toContain("Saved");
  });
});
