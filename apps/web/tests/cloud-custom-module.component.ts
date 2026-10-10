import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CloudConfig } from "../src/cloud-admin-types.ts";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";
const source = vi.hoisted(() => ({
  receive: undefined as ((config: CloudConfig) => void) | undefined,
  dispose: Object.assign(vi.fn(), { report: vi.fn() }),
}));
vi.mock("../src/cloud-module-source.ts", () => ({
  observeCloudConfig: vi.fn((receive: (config: CloudConfig) => void) => {
    source.receive = receive;
    return source.dispose;
  }),
}));
beforeEach(() => {
  history.replaceState({}, "", "/custom-module/?module=one");
  vi.resetModules();
  source.dispose.mockClear();
  source.dispose.report.mockClear();
  document.body.innerHTML =
    '<iframe sandbox="" title="Custom Custom Module overlay"></iframe><span id="status"></span>';
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.innerHTML = "";
});
const config = {
  enabled: true,
  streamerDid: "did:plc:alice",
  revision: "new",
  commands: [],
  customModules: [{ ...defaultCustomModuleSettings, enabled: true, id: "one", name: "Score" }],
};
test("the OBS source renders saved changes, avoids unchanged reloads, disables and resumes", async () => {
  await import("../src/cloud-custom-module.ts");
  source.receive!(config);
  const frame = document.querySelector("iframe")!;
  expect(frame.hidden).toBe(false);
  expect(frame.srcdoc).toContain("Welcome to my stream");
  const setter = vi.spyOn(frame, "srcdoc", "set");
  source.receive!({ ...config, revision: "another" });
  expect(setter).not.toHaveBeenCalled();
  source.receive!({
    ...config,
    customModules: [{ ...config.customModules[0], html: "<h1>New room</h1>" }],
  });
  expect(frame.srcdoc).toContain("New room");
  source.receive!({ ...config, customModules: [{ ...config.customModules[0], enabled: false }] });
  expect(frame.hidden).toBe(true);
  expect(frame.srcdoc).toBe("");
  source.receive!(config);
  expect(frame.hidden).toBe(false);
});
test("malformed configuration clears the old source and reports a bounded failure", async () => {
  await import("../src/cloud-custom-module.ts");
  source.receive!(config);
  source.receive!({
    ...config,
    customModules: [{ ...config.customModules[0], css: "x".repeat(50001) }],
  });
  expect(document.querySelector("iframe")!.hidden).toBe(true);
  expect(document.querySelector("iframe")!.srcdoc).toBe("");
  expect(document.querySelector("#status")!.textContent).toContain("could not be rendered");
  expect(source.dispose.report).toHaveBeenCalledWith(
    "config-failed",
    "custom-module.invalid-configuration",
  );
  source.receive!(config);
  expect(document.querySelector("#status")!.textContent).toBe("");
});
