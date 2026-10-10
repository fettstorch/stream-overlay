import { afterEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CloudBotControls from "../src/CloudBotControls.vue";
import EmoticonModeration from "../src/EmoticonModeration.vue";
const request = vi.hoisted(() =>
  vi.fn(async () =>
    Response.json({
      url: "https://example.test/bot/?did=did:plc:owner&token=test",
      configured: true,
    }),
  ),
);
vi.mock("../src/cloud-admin-fetch.ts", () => ({ adminFetch: request }));
afterEach(() => vi.clearAllMocks());
const config = {
  enabled: true,
  commands: [],
  streamerDid: "did:plc:owner",
  revision: "1",
  bot: { enabled: false, rules: [] },
};
test("Moderation reuses the editor but stores restrictions only in Bot settings", async () => {
  const save = vi.fn(async () => true);
  const emoticonRule = { did: "did:plc:other", blocked: true, cooldownSeconds: 0 };
  const wrapper = mount(CloudBotControls, {
    props: { config: { ...config, moderation: [emoticonRule] }, save },
    global: { stubs: { EmoticonModeration: true } },
  });
  await wrapper.findAll('[role="tab"]')[2]!.trigger("click");
  const editor = wrapper.findComponent(EmoticonModeration);
  expect(editor.props("config").moderation).toEqual([]);
  const botRule = { did: "did:plc:viewer", blocked: false, cooldownSeconds: 30 };
  await editor.props("save")({ ...config, moderation: [botRule] });
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      moderation: [emoticonRule],
      bot: { enabled: false, rules: [], moderation: [botRule] },
    }),
  );
  wrapper.unmount();
});
test("saves rules through existing configuration flow and preserves input on failed save", async () => {
  const save = vi.fn(async () => false);
  const wrapper = mount(CloudBotControls, { props: { config, save } });
  await flushPromises();
  expect(wrapper.findAll('[role="tab"]').map((item) => item.text())).toEqual([
    "Commands",
    "Create new",
    "Moderation",
  ]);
  expect((wrapper.get("form").element as HTMLFormElement).style.display).toBe("none");
  await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
  expect((wrapper.get("form").element as HTMLFormElement).style.display).not.toBe("none");
  expect(request).toHaveBeenCalledWith("/api/accounts/did%3Aplc%3Aowner/bot/source");
  const inputs = wrapper.findAll("input");
  await inputs[0].setValue("!discord");
  await inputs[1].setValue("Join our Discord!");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      bot: {
        enabled: false,
        rules: [{ command: "discord", response: "Join our Discord!", cooldownSeconds: 30 }],
      },
    }),
  );
  expect((inputs[0].element as HTMLInputElement).value).toBe("!discord");
  save.mockResolvedValue(true);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect((inputs[0].element as HTMLInputElement).value).toBe("");
  await wrapper.get('button[type="button"]:not([role="tab"])').trigger("click");
  expect(wrapper.findAll('[role="tab"]')[1]!.attributes("aria-selected")).toBe("true");
  expect(wrapper.get("form").classes()).toContain("editor-fields");
  wrapper.unmount();
});
test("duplicate commands never overwrite existing rules accidentally", async () => {
  const save = vi.fn(async () => true);
  const wrapper = mount(CloudBotControls, {
    props: {
      config: {
        ...config,
        bot: { enabled: true, rules: [{ command: "hi", response: "Hello", cooldownSeconds: 30 }] },
      },
      save,
    },
  });
  await wrapper.get('input[placeholder="!discord"]').setValue("hi");
  await wrapper.get('input[placeholder="Join our Discord…"]').setValue("Changed");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(save).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("unique command");
  wrapper.unmount();
});
