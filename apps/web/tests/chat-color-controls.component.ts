import { mount, flushPromises } from "@vue/test-utils";
import { expect, test, vi } from "vitest";
import Controls from "../src/CloudModuleControls.vue";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";

test("user colors hide the color picker but retain opacity, preview and save without losing custom settings", async () => {
  const save = vi.fn(async (_config: any) => true);
  const wrapper = mount(Controls, { props: { moduleId: "chat", config: {
    modules: { chat: true, paint: true, pets: true },
    chat: { ...defaultChatConfiguration, backgroundColor: "#123456", backgroundOpacity: 25 },
  } as any, save } });
  try {
    expect(wrapper.find('input[type="color"]').exists()).toBe(true);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await flushPromises();
    expect(wrapper.find('input[type="color"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Background opacity");
    expect(wrapper.get('.switch input').attributes("aria-label")).toBe("Respect user's chat color");
    expect(wrapper.get('.switch span').attributes("aria-hidden")).toBe("true");
    const opacity = wrapper.findAll('.chat-slider').find(slider => slider.text().includes("Background opacity"))!;
    await opacity.get('input').setValue(50);
    await flushPromises();
    expect(save.mock.calls.at(-1)?.[0].chat).toMatchObject({
      respectUserChatColor: true, backgroundColor: "#123456", backgroundOpacity: 50,
    });
    expect(wrapper.emitted("chatPreview")?.at(-1)?.[0]).toMatchObject({ respectUserChatColor: true });
    await wrapper.get('input[type="checkbox"]').setValue(false);
    expect(wrapper.get('input[type="color"]').element.value).toBe("#123456");
    expect(wrapper.text()).toContain("Background opacity");
  } finally { wrapper.unmount(); }
});
