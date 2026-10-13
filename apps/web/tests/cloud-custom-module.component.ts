import { afterEach, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OverlayCustom from "../src/OverlayCustom.vue";
import { overlayRuntimeKey } from "../src/shared-overlay-runtime.ts";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";
const report = vi.fn();
let wrapper: ReturnType<typeof mount>;
afterEach(() => {
  wrapper?.unmount();
  report.mockClear();
});
const module = { ...defaultCustomModuleSettings, enabled: true, id: "one", name: "Score" };
function start() {
  wrapper = mount(OverlayCustom, {
    props: { module },
    global: { provide: { [overlayRuntimeKey as symbol]: { report } } },
  });
}
test("saved custom content retains its sandbox, avoids unchanged reloads, and updates", async () => {
  start();
  const frame = wrapper.get("iframe");
  expect(frame.attributes("sandbox")).toBe("allow-scripts");
  expect(frame.attributes("srcdoc")).toContain("Welcome to my stream");
  const setter = vi.spyOn(frame.element as HTMLIFrameElement, "srcdoc", "set");
  await wrapper.setProps({ module: { ...module } });
  expect(setter).not.toHaveBeenCalled();
  await wrapper.setProps({ module: { ...module, html: "<h1>New room</h1>" } });
  expect(frame.attributes("srcdoc")).toContain("New room");
});
test("malformed content clears the source and reports a bounded failure", async () => {
  start();
  await wrapper.setProps({ module: { ...module, css: "x".repeat(50001) } });
  expect(wrapper.get("iframe").attributes("srcdoc")).toBe("");
  expect(report).toHaveBeenCalledWith("config-failed", "custom-module.invalid-configuration");
  await wrapper.setProps({ module });
  expect(wrapper.get("iframe").attributes("srcdoc")).toContain("Welcome to my stream");
});
