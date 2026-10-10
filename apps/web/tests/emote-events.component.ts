import { expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import EmoteEvents from "../src/EmoteEvents.vue";
import type { CloudConfig } from "../src/cloud-admin-types.ts";
test("lists event choices and saves command mappings without changing other configuration", async () => {
  const config = { enabled: true, commands: [{ id: "wave", command: "wave" }], eventMappings: [] } as unknown as CloudConfig;
  const save = vi.fn(async () => true);
  const wrapper = mount(EmoteEvents, { props: { config, save } });
  expect(wrapper.findAll('select')).toHaveLength(4);
  await wrapper.get('select[aria-label="Teleport arrival"]').setValue('wave');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(save).toHaveBeenCalledWith({ ...config, eventMappings: [{ event: "teleport-arrival", commandId: "wave" }] });
  await wrapper.get('select[aria-label="Teleport arrival"]').setValue('');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(save).toHaveBeenLastCalledWith(config);
  wrapper.unmount();
});
