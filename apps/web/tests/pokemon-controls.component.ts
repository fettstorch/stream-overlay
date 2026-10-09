import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import Controls from "../src/PokemonModuleControls.vue";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("Crystal settings auto-save independently and reset only after confirmation", async () => {
  vi.useFakeTimers();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => init?.method
    ? new Response(null, { status: 204 }) : Response.json({ components: { team: true, badges: true }, thoughtIntervalSeconds: 120 }));
  const wrapper = mount(Controls, { props: { moduleId: "pokemon-crystal" } });
  try {
    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(1);
    await wrapper.get('input[type="number"]').setValue(2);
    await vi.advanceTimersByTimeAsync(350); await flushPromises();
    expect(fetch.mock.calls[1]![0]).toBe("/api/pokemon-crystal/config");
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body)).thoughtIntervalSeconds).toBe(2);
    await wrapper.get("button").trigger("click");
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await wrapper.findAll("button")[0]!.trigger("click"); await flushPromises();
    expect(fetch).toHaveBeenCalledWith("/api/pokemon-crystal/pet-counts", { method: "DELETE" });
    expect(wrapper.text()).toContain("All pet counts reset");
    expect(fetch.mock.calls.some(([url]) => String(url).includes("pokemon-blue"))).toBe(false);
  } finally { wrapper.unmount(); }
});
