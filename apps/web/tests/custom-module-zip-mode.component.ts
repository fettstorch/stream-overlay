import { expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CloudCustomModuleControls from "../src/CloudCustomModuleControls.vue";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";
import CustomModulePreview from "../src/CustomModulePreview.vue";

test("ZIP auto-save preserves unsaved code and reports record-save failures", async () => {
  const blob = { $type: "blob", ref: { $link: "bafyzip" }, mimeType: "application/zip", size: 100 };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(blob)));
  const original = { ...defaultCustomModuleSettings, id: "one", name: "Test" };
  const save = vi.fn(async () => true);
  const wrapper = mount(CloudCustomModuleControls, { props: {
    config: { enabled: true, streamerDid: "did:plc:test", revision: "new", commands: [], customModules: [original] },
    moduleId: "one", save,
  } });
  try {
    wrapper.getComponent(CustomModulePreview).vm.$emit("html", "<h1>Unsaved code</h1>");
    const drop = async () => {
      await wrapper.trigger("drop", { dataTransfer: { types: ["Files"], files: [new File(["zip"], "app.zip", { type: "application/zip" })] } });
      await flushPromises();
    };
    await drop();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customModules: [{ ...original, bundle: { name: "app.zip", blob } }] }));
    expect(wrapper.getComponent(CustomModulePreview).props("settings").html).toBe("<h1>Unsaved code</h1>");
    expect(wrapper.find(".editor-actions").exists()).toBe(false);
    await wrapper.get('[aria-label="ZIP app mode"]').setValue(false);
    expect(wrapper.find(".editor-actions").exists()).toBe(true);
    save.mockResolvedValueOnce(false);
    await drop();
    expect(wrapper.text()).toContain("Could not save the ZIP app");
    expect(wrapper.getComponent(CustomModulePreview).props("settings").bundle).toBeUndefined();
  } finally {
    wrapper.unmount(); vi.unstubAllGlobals();
  }
});

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
