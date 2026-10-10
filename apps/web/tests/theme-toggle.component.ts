import { afterEach, describe, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ThemeToggle from "../src/ThemeToggle.vue";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Theme toggle", () => {
  test("follows browser preference until an explicit choice and removes the listener", async () => {
    const removeEventListener = vi.fn();
    let notify!: (event: { matches: boolean }) => void;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true,
      addEventListener: vi.fn((_type, callback) => { notify = callback; }), removeEventListener })));
    const wrapper = mount(ThemeToggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("streamface-theme")).toBeNull();
    notify({ matches: false }); await flushPromises();
    expect(document.documentElement.dataset.theme).toBe("light");
    await wrapper.get("input").setValue(true);
    notify({ matches: false }); await flushPromises();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("streamface-theme")).toBe("dark");
    wrapper.unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", notify);
  });

  test("a saved light choice overrides the browser's dark preference", () => {
    localStorage.setItem("streamface-theme", "light");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const wrapper = mount(ThemeToggle);
    expect(document.documentElement.dataset.theme).toBe("light");
    wrapper.unmount();
  });
  test("defaults to light, switches to dark and remembers the choice", async () => {
    const wrapper = mount(ThemeToggle);
    const toggle = wrapper.get('input[role="switch"]');
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(toggle.attributes("aria-checked")).toBe("false");
    expect(wrapper.findAll("img").map(image => image.attributes("alt"))).toEqual(["Light mode", "Dark mode"]);
    await toggle.setValue(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("streamface-theme")).toBe("dark");
    wrapper.unmount();
    const restored = mount(ThemeToggle);
    expect(restored.get('input[role="switch"]').attributes("aria-checked")).toBe("true");
    await restored.get("input").setValue(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("streamface-theme")).toBe("light");
    restored.unmount();
  });

  test("works when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    const wrapper = mount(ThemeToggle);
    await wrapper.get("input").setValue(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    wrapper.unmount();
  });
});
