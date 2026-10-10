import { afterEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CloudBotControls from "../src/CloudBotControls.vue";
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
test("saves rules through existing configuration flow and preserves input on failed save", async () => {
  const save = vi.fn(async () => false);
  const wrapper = mount(CloudBotControls, { props: { config, save } });
  await flushPromises();
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
