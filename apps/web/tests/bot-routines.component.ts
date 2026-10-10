import { expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import BotRoutines from "../src/BotRoutines.vue";
test("routine editor saves intervals, preserves bot commands, and keeps drafts after a failed save", async () => {
  const save = vi.fn(async () => false);
  const config = { streamerDid: "did:plc:owner", enabled: true, commands: [], revision: "1",
    bot: { enabled: true, rules: [{ command: "hi", response: "Hello", cooldownSeconds: 30 }] } };
  const wrapper = mount(BotRoutines, { props: { config, save } });
  await wrapper.get("textarea").setValue("Follow me!");
  await wrapper.get('input[type="number"]').setValue("2.5");
  await wrapper.get("form").trigger("submit");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ bot: expect.objectContaining({
    rules: config.bot.rules, routines: [expect.objectContaining({ enabled: true, response: "Follow me!", intervalSeconds: 150 })],
  }) }));
  expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("Follow me!");
  save.mockResolvedValueOnce(true);
  await wrapper.get("form").trigger("submit");
  expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("");
  wrapper.unmount();
});
test("existing routines can be paused, edited and removed without dropping other settings", async () => {
  const routine = { id: "routine-1", response: "Follow me!", intervalSeconds: 300, enabled: true };
  const save = vi.fn(async () => true);
  const config = { streamerDid: "did:plc:owner", enabled: true, commands: [], revision: "1",
    bot: { enabled: true, rules: [], moderation: [], routines: [routine] } };
  const wrapper = mount(BotRoutines, { props: { config, save } });
  await wrapper.get('[role="switch"]').setValue(false);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ bot: expect.objectContaining({
    moderation: [], routines: [{ ...routine, enabled: false }],
  }) }));
  await wrapper.get("li button").trigger("click");
  expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(routine.response);
  await wrapper.get("textarea").setValue("Updated text");
  await wrapper.get("form").trigger("submit");
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ bot: expect.objectContaining({
    routines: [{ ...routine, response: "Updated text" }],
  }) }));
  await wrapper.findAll("li button")[1]!.trigger("click");
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ bot: expect.objectContaining({ routines: [] }) }));
  wrapper.unmount();
});
