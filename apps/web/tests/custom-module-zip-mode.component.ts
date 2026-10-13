import { expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CloudCustomModuleControls from "../src/CloudCustomModuleControls.vue";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";

test("dropping a ZIP switches modes immediately, including when the upload fails", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const wrapper = mount(CloudCustomModuleControls, { props: {
    config: { enabled: true, streamerDid: "did:plc:test", revision: "new", commands: [], customModules: [{ ...defaultCustomModuleSettings, id: "one", name: "Test" }] },
    moduleId: "one", save: async () => true,
  } });
  try {
    await wrapper.trigger("drop", { dataTransfer: { types: ["Files"], files: [new File(["zip"], "app.zip", { type: "application/zip" })] } });
    expect((wrapper.get('[aria-label="ZIP app mode"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain("Uploading app.zip");
    finish(Response.json({ message: "Sign in again to grant ZIP upload access." }, { status: 403 }));
    await flushPromises();
    expect((wrapper.get('[aria-label="ZIP app mode"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain("Sign in again to grant ZIP upload access.");
  } finally {
    wrapper.unmount(); vi.unstubAllGlobals();
  }
});
