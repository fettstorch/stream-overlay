import { afterEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import EmoticonModeration from "../src/EmoticonModeration.vue";
import type { CloudConfig } from "../src/cloud-admin-types.ts";

const actors = vi.hoisted(() => ({ resolvePublicActor: vi.fn(), searchPublicActors: vi.fn(async () => []) }));
vi.mock("../src/actor-search.ts", () => actors);
afterEach(() => vi.clearAllMocks());
const config = { enabled: true, commands: [], streamerDid: "did:plc:owner", revision: "1" } as unknown as CloudConfig;
test("resolves identity, saves a shared cooldown and clears only after success", async () => {
  actors.resolvePublicActor.mockResolvedValue({ did: "did:plc:viewer", handle: "viewer.example" });
  const save = vi.fn(async () => false);
  const wrapper = mount(EmoticonModeration, { props: { config, save } });
  await wrapper.get('input[placeholder="@handle"]').setValue("viewer.example");
  expect(wrapper.get('input[placeholder="@handle"]').attributes('role')).toBe('combobox');
  await wrapper.get('input[type="number"]').setValue(30.5);
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ moderation: [{ did: "did:plc:viewer", handle: "viewer.example", blocked: false, cooldownSeconds: 30.5 }] }));
  expect((wrapper.get('input[placeholder="@handle"]').element as HTMLInputElement).value).toBe("viewer.example");
  save.mockResolvedValue(true);
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect((wrapper.get('input[placeholder="@handle"]').element as HTMLInputElement).value).toBe("");
  expect(wrapper.text()).toContain("Moderation rule saved.");
  wrapper.unmount();
});
test("edits and removes rules without dropping other restrictions or command configuration", async () => {
  const moderation = [{ did: "did:plc:viewer", handle: "viewer.example", blocked: false, cooldownSeconds: 30 },
    { did: "did:plc:other", blocked: true, cooldownSeconds: 0 }];
  const save = vi.fn(async () => true);
  const wrapper = mount(EmoticonModeration, { props: { config: { ...config, moderation }, save } });
  await wrapper.get('.moderation-list button').trigger('click');
  await wrapper.get('input[role="switch"]').setValue(true);
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ ...config,
    moderation: [moderation[1], { ...moderation[0], blocked: true }] }));
  await wrapper.findAll('.moderation-list button')[1].trigger('click'); await flushPromises();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ moderation: [moderation[1]] }));
  wrapper.unmount();
});
test("resolution and validation failures never write a rule", async () => {
  actors.resolvePublicActor.mockRejectedValueOnce(new Error("Account not found"));
  const save = vi.fn(async () => true);
  const wrapper = mount(EmoticonModeration, { props: { config, save } });
  await wrapper.get('input[placeholder="@handle"]').setValue('missing.example');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(save).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('Account not found');
  actors.resolvePublicActor.mockResolvedValue({ did: "did:plc:viewer", handle: "viewer.example" });
  await wrapper.get('input[type="number"]').setValue(-1);
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(save).not.toHaveBeenCalled();
  wrapper.unmount();
});
