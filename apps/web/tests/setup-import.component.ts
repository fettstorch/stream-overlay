import { afterEach, expect, test, vi } from "vitest";
import { mergeSetup, copySetupMedia } from "../src/setup-import.ts";
import type { CloudConfig } from "../src/cloud-admin-types.ts";
import { mount, flushPromises } from "@vue/test-utils";
import SetupImport from "../src/SetupImport.vue";
vi.mock("../src/actor-search.ts", () => ({ resolvePublicActor: vi.fn(async (handle: string) => ({ did: "did:plc:source", handle })), searchPublicActors: vi.fn(async () => []) }));
const command = { id: "old", command: "wave", mode: "effect" as const, durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false };
const target: CloudConfig = { enabled: false, streamerDid: "did:plc:target", revision: "target", preferences: { confirmDeletion: true },
  commands: [command, { ...command, id: "keep", command: "keep" }],
  bot: { enabled: false, rules: [{ command: "keep", response: "Keep", cooldownSeconds: 5 }, { command: "wave", response: "Old", cooldownSeconds: 5 }], routines: [{ id: "same", response: "Old", intervalSeconds: 300, enabled: false }] } };
const source: CloudConfig = { enabled: true, streamerDid: "did:plc:source", revision: "source", preferences: { confirmDeletion: false },
  commands: [{ ...command, id: "source", volume: 0.5 }, { ...command, id: "keep", command: "new" }],
  eventMappings: [{ event: "teleport-arrival", commandId: "source", text: "Hi [teleporter]" }],
  moderation: [{ did: "did:plc:blocked", blocked: true, cooldownSeconds: 0 }],
  bot: { enabled: true, rules: [{ command: "wave", response: "New", cooldownSeconds: 10 }], routines: [{ id: "same", response: "New", intervalSeconds: 300, enabled: true }] } };
afterEach(() => vi.unstubAllGlobals());
test("imports settings, replaces collisions, preserves unrelated commands and destination identity", () => {
  const merged = mergeSetup(target, source);
  expect(merged.streamerDid).toBe(target.streamerDid);
  expect(merged.revision).toBe(target.revision);
  expect(merged.preferences).toEqual(target.preferences);
  expect(merged.enabled).toBe(true);
  expect(merged.commands).toHaveLength(3);
  expect(merged.commands.find(item => item.command === "wave")).toMatchObject({ id: "old", volume: 0.5 });
  expect(new Set(merged.commands.map(item => item.id)).size).toBe(3);
  expect(merged.eventMappings?.[0]).toMatchObject({ commandId: "old", text: "Hi [teleporter]" });
  expect(merged.moderation).toEqual(source.moderation);
  expect(merged.bot?.rules).toEqual([{ command: "keep", response: "Keep", cooldownSeconds: 5 }, { command: "wave", response: "New", cooldownSeconds: 10 }]);
  expect(merged.bot?.routines?.[0].response).toBe("New");
  expect(target.commands[0].volume).toBe(1);
  expect(source.commands[0].id).toBe("source");
});
test("rejects an import exceeding the saved command limit", () => {
  expect(() => mergeSetup({ ...target, commands: Array.from({ length: 100 }, (_, i) => ({ ...command, id: String(i), command: `c${i}` })) }, source)).toThrow("100");
});
test("copies shared uploaded media once and preserves URLs and Giphy IDs", async () => {
  const blob = { $type: "blob" as const, ref: { $link: "sourcecid" }, mimeType: "image/gif", size: 4 };
  const newBlob = { ...blob, ref: { $link: "targetcid" } };
  const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => options?.method === "POST" ? Response.json(newBlob) : new Response("GIF8"));
  vi.stubGlobal("fetch", fetch);
  const config = { ...source, commands: [{ ...command, image: { blob, url: "https://pds.example/blob" } },
    { ...command, id: "second", image: { blob, url: "https://pds.example/blob" }, video: { url: "https://example.test/a.mp4" } },
    { ...command, id: "gif", image: { giphyId: "abc" } }] };
  const copied = await copySetupMedia(config, target.streamerDid);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(copied.commands[0].image).toEqual({ blob: newBlob });
  expect(copied.commands[1].image).toEqual({ blob: newBlob });
  expect(copied.commands[1].video).toEqual(config.commands[1].video);
  expect(copied.commands[2].image).toEqual({ giphyId: "abc" });
  expect(config.commands[0].image?.blob?.ref.$link).toBe("sourcecid");
});
test("failed media copies never return a candidate containing foreign blob references", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
  await expect(copySetupMedia({ ...source, commands: [{ ...command, image: { blob: { $type: "blob", ref: { $link: "abc" }, mimeType: "image/gif", size: 4 }, url: "https://pds.example/blob" } }] }, target.streamerDid)).rejects.toThrow("not been changed");
});
test("the default-base shortcut reviews before saving and cancellation leaves the setup alone", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(source)));
  const save = vi.fn(async () => true);
  const wrapper = mount(SetupImport, { props: { did: target.streamerDid, config: target, save } });
  await wrapper.get('button').trigger('click'); await flushPromises();
  expect(wrapper.text()).toContain("Import @fettstorch.dev");
  expect(save).not.toHaveBeenCalled();
  await wrapper.findAll('button').find(button => button.text() === "Cancel")!.trigger('click');
  expect(wrapper.find('.import-review').exists()).toBe(false);
  expect(save).not.toHaveBeenCalled();
  await wrapper.get('button').trigger('click'); await flushPromises();
  await wrapper.findAll('button').find(button => button.text() === "Confirm import")!.trigger('click'); await flushPromises();
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]?.[0]).toMatchObject({ streamerDid: target.streamerDid, revision: target.revision });
  expect(wrapper.text()).toContain("Setup imported.");
  wrapper.unmount();
});
