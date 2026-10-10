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
test("chat composer preserves failed messages and offers reauthorization before successful posting", async () => {
  const wrapper = mount(CloudBotControls, { props: { config, save: vi.fn(), avatar: 'https://cdn.example/avatar.png' } });
  await flushPromises();
  expect(wrapper.get('.chat-avatar').attributes('src')).toBe('https://cdn.example/avatar.png');
  expect(wrapper.find('.chat-send').exists()).toBe(false);
  expect(wrapper.text()).not.toContain('Send as your logged-in account');
  const input = wrapper.get('input[placeholder="Type a chat message or !command"]');
  await input.setValue('   ');
  expect(wrapper.find('.chat-send').exists()).toBe(false);
  await input.setValue('!hi');
  expect(wrapper.get('.chat-send').attributes('aria-label')).toBe('Send message');
  expect(wrapper.get('.chat-send img').attributes('src')).toContain('send.png');
  request.mockResolvedValueOnce(Response.json({ error: 'chat-permission-required', message: 'Sign in again to allow chat posting.' }, { status: 403 }));
  await wrapper.get('.bot-chat-composer').trigger('submit'); await flushPromises();
  expect((input.element as HTMLInputElement).value).toBe('!hi');
  expect(wrapper.get('.bot-chat-composer a').attributes('href')).toBe('/oauth/login?handle=did%3Aplc%3Aowner');
  request.mockResolvedValueOnce(Response.json({ sent: true }));
  await wrapper.get('.bot-chat-composer').trigger('submit'); await flushPromises();
  expect(request).toHaveBeenLastCalledWith('/api/accounts/did%3Aplc%3Aowner/chat/message', expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: '!hi' }) }));
  expect((input.element as HTMLInputElement).value).toBe('');
  expect(wrapper.find('.chat-send').exists()).toBe(false);
  await wrapper.get('.chat-avatar').trigger('error');
  expect(wrapper.get('.chat-avatar').attributes('aria-label')).toBe('Profile picture unavailable');
  wrapper.unmount();
});
test("Commands embeds chat and the private listener stays running across tabs while enabled", async () => {
  const wrapper = mount(CloudBotControls, { props: { config, save: vi.fn() } });
  await flushPromises();
  expect(wrapper.get('iframe[title="Your Streamplace chat"]').attributes('src'))
    .toBe('https://stream.place/chat-popout/did%3Aplc%3Aowner');
  expect(wrapper.get('.bot-chat-viewport').find('iframe[title="Your Streamplace chat"]').exists()).toBe(true);
  expect(wrapper.get('.bot-chat-composer').element.closest('.bot-chat-viewport')).toBeNull();
  expect(wrapper.find('iframe[title="Bot chat listener"]').exists()).toBe(false);
  await wrapper.setProps({ config: { ...config, bot: { enabled: true, rules: [] } } });
  expect(wrapper.get('iframe[title="Bot chat listener"]').attributes('src'))
    .toBe('https://example.test/bot/?did=did:plc:owner&token=test');
  expect(wrapper.get('iframe[title="Bot chat listener"]').attributes('hidden')).toBeDefined();
  await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
  expect(wrapper.findAll('iframe')).toHaveLength(1);
  await wrapper.findAll('[role="tab"]')[0]!.trigger('click');
  expect(wrapper.findAll('iframe')).toHaveLength(2);
  wrapper.unmount();
});
test("Moderation reuses the editor but stores restrictions only in Bot settings", async () => {
  const save = vi.fn(async () => true);
  const emoticonRule = { did: "did:plc:other", blocked: true, cooldownSeconds: 0 };
  const wrapper = mount(CloudBotControls, {
    props: { config: { ...config, moderation: [emoticonRule] }, save },
    global: { stubs: { EmoticonModeration: true } },
  });
  await wrapper.findAll('[role="tab"]')[3]!.trigger("click");
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
    "Testing",
    "Commands",
    "Routines",
    "Moderation",
  ]);
  expect((wrapper.get("form.bot-tab-content").element as HTMLFormElement).style.display).toBe("none");
  await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
  expect((wrapper.get("form.bot-tab-content").element as HTMLFormElement).style.display).not.toBe("none");
  expect(wrapper.get("form.bot-tab-content").find("h4").exists()).toBe(false);
  expect(wrapper.get("section.bot-tab-content").find("h4").exists()).toBe(false);
  expect(request).toHaveBeenCalledWith("/api/accounts/did%3Aplc%3Aowner/bot/source");
  const inputs = wrapper.get("form.bot-tab-content").findAll("input");
  await inputs[0].setValue("!discord");
  await inputs[1].setValue("Join our Discord!");
  await wrapper.get("form.bot-tab-content").trigger("submit");
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
  await wrapper.get("form.bot-tab-content").trigger("submit");
  await flushPromises();
  expect((inputs[0].element as HTMLInputElement).value).toBe("");
  await wrapper.get('button[type="button"]:not([role="tab"])').trigger("click");
  expect(wrapper.findAll('[role="tab"]')[1]!.attributes("aria-selected")).toBe("true");
  expect(wrapper.get("form.bot-tab-content").classes()).toContain("editor-fields");
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
  await wrapper.get("form.bot-tab-content").trigger("submit");
  await flushPromises();
  expect(save).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("unique command");
  wrapper.unmount();
});
