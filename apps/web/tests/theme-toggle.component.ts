import { afterEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ThemeToggle from "../src/ThemeToggle.vue";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("Theme toggle", () => {
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
