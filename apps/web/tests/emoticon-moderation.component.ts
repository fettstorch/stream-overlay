import { afterEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import EmoticonModeration from "../src/EmoticonModeration.vue";
import type { CloudConfig } from "../src/cloud-admin-types.ts";

const actors = vi.hoisted(() => ({ resolvePublicActor: vi.fn(), searchPublicActors: vi.fn(async () => []),
  loadPublicActorProfile: vi.fn(async (did: string) => ({ did, handle: "viewer.example", displayName: "Viewer", avatar: "https://cdn.example/viewer.png" })) }));
vi.mock("../src/actor-search.ts", () => actors);
afterEach(() => vi.clearAllMocks());
const config = { enabled: true, commands: [], streamerDid: "did:plc:owner", revision: "1" } as unknown as CloudConfig;
test("nested roles and restrictions tabs save an inclusive allowlist without dropping restrictions", async () => {
  actors.resolvePublicActor.mockResolvedValue({ did: "did:plc:friend", handle: "friend.example" });
  const moderation = [{ did: "did:plc:blocked", blocked: true, cooldownSeconds: 0 }];
  const save = vi.fn(async () => true);
  const wrapper = mount(EmoticonModeration, { props: { config: { ...config, moderation }, save } });
  expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toEqual(["Roles", "Restrictions"]);
  expect(wrapper.text()).toContain("No roles selected: everyone");
  expect(wrapper.findAll('.role-choice .switch input[role="switch"]').map(input => input.attributes('aria-label')))
    .toEqual(['Following', 'Followers', 'Mutuals', 'Streamplace moderators']);
  await wrapper.findAll('.role-choice input')[0]!.setValue(true);
  await wrapper.get('input[aria-label="Followers"]').setValue(true);
  await wrapper.get('input[aria-label="Streamplace moderators"]').setValue(true);
  await wrapper.get('input[placeholder="Add @handle"]').setValue('friend.example');
  await wrapper.findAll('button').find(button => button.text() === 'Add user')!.trigger('click');
  await flushPromises();
  await wrapper.findAll('button').find(button => button.text() === 'Save roles')!.trigger('click');
  await flushPromises();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ moderation,
    roles: { following: true, followers: true, mutuals: false, moderators: true, users: [{ did: 'did:plc:friend', handle: 'friend.example' }] } }));
  await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
  expect(wrapper.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true');
  wrapper.unmount();
});
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
  await flushPromises();
  expect(wrapper.findAll('.moderation-avatar')).toHaveLength(2);
  expect(wrapper.get('img.moderation-avatar').attributes('src')).toBe('https://cdn.example/viewer.png');
  expect(wrapper.get('form').classes()).toContain('editor-fields');
  await wrapper.get('.moderation-list button').trigger('click');
  await wrapper.get('input[role="switch"][aria-label="Block all commands"]').setValue(true);
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ ...config,
    moderation: [moderation[1], { ...moderation[0], blocked: true }] }));
  await wrapper.findAll('.moderation-list button')[1].trigger('click'); await flushPromises();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ moderation: [moderation[1]] }));
  wrapper.unmount();
});
test("unavailable profiles show an accessible placeholder without losing the rule", async () => {
  actors.loadPublicActorProfile.mockRejectedValueOnce(new Error('Unavailable'));
  const wrapper = mount(EmoticonModeration, { props: { config: { ...config,
    moderation: [{ did: 'did:plc:missing', handle: 'missing.example', blocked: true, cooldownSeconds: 0 }] }, save: vi.fn() } });
  await flushPromises();
  expect(wrapper.get('[aria-label="Profile picture unavailable"]').exists()).toBe(true);
  expect(wrapper.text()).toContain('@missing.example');
  expect(wrapper.text()).toContain('Blocked from all commands');
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
