import { expect, test } from "bun:test";
import { RoutineSchedule } from "../../../modules/bot/src/routines.ts";
import { validateBotSettings } from "../../../modules/bot/src/config.ts";
import { serializeModuleRecords, parseModuleRecords } from "../src/module-records.ts";
import { CloudBot } from "../src/cloud-bot.ts";
import type { BotAuth } from "../src/bot-auth.ts";
import { StructuredLogger } from "../src/logger.ts";
const routine = { id: "routine-1", enabled: true, response: "Follow the stream!", intervalSeconds: 300 };
const bot = { enabled: true, rules: [], routines: [routine] };
const config = { streamerDid: "did:plc:streamer", enabled: true, commands: [], revision: "1", bot };
test("browser deadlines wait a full interval, survive unchanged updates and never replay missed posts", () => {
  const schedule = new RoutineSchedule();
  schedule.update(bot, 0);
  expect(schedule.due(299999)).toEqual([]);
  schedule.update(bot, 100000);
  expect(schedule.due(300000)).toEqual([routine.id]);
  expect(schedule.due(300000)).toEqual([]);
  expect(schedule.due(9000000)).toEqual([routine.id]);
  expect(schedule.due(9000001)).toEqual([]);
  schedule.update({ ...bot, enabled: false }, 9000001);
  expect(schedule.due(99999999)).toEqual([]);
  schedule.update(bot, 99999999);
  expect(schedule.due(99999999)).toEqual([]);
  schedule.update({ ...bot, routines: [{ ...routine, intervalSeconds: 60 }] }, 100000000);
  expect(schedule.due(100059999)).toEqual([]);
  expect(schedule.due(100060000)).toEqual([routine.id]);
  schedule.update({ ...bot, routines: [] }, 100060001);
  expect(schedule.due(999999999)).toEqual([]);
});
test("routines roundtrip through PDS records, survive older clients, and validate limits", () => {
  const records = serializeModuleRecords(config, [], new Date().toISOString());
  expect(parseModuleRecords(config.streamerDid, records).bot?.routines).toEqual([routine]);
  const older = { ...config, bot: { enabled: true, rules: [] } };
  expect(parseModuleRecords(config.streamerDid, serializeModuleRecords(older, records, new Date().toISOString())).bot?.routines).toEqual([routine]);
  expect(parseModuleRecords(config.streamerDid, serializeModuleRecords({ ...config, bot: { ...bot, routines: [] } }, records, new Date().toISOString())).bot?.routines).toEqual([]);
  for (const value of [29, NaN, 86401]) expect(() => validateBotSettings({ ...bot, routines: [{ ...routine, intervalSeconds: value }] })).toThrow();
  expect(() => validateBotSettings({ ...bot, routines: [routine, routine] })).toThrow();
});
test("server posts only configured routines and suppresses duplicate sources and early attempts", async () => {
  const sent: any[] = [], logs: string[] = [];
  let now = 1000000;
  const auth = { getAgent: async () => ({ did: "did:plc:bot", com: { atproto: { repo: {
    createRecord: async (input: any) => { sent.push(input); },
  } } } }) } as unknown as BotAuth;
  const service = new CloudBot(auth, new StructuredLogger(undefined, line => logs.push(line)), fetch, () => now);
  expect(await service.routine(config, "unknown", "unknown")).toMatchObject({ sent: false });
  expect(await service.routine({ ...config, bot: { ...bot, enabled: false } }, routine.id, "disabled")).toMatchObject({ reason: "disabled" });
  expect(await service.routine(config, routine.id, "first")).toEqual({ sent: true });
  expect(await service.routine(config, routine.id, "duplicate")).toMatchObject({ reason: "interval" });
  expect(sent[0].record).toMatchObject({ text: routine.response, streamer: config.streamerDid });
  expect(sent[0].rkey).toMatch(/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
  now += 299999;
  expect(await service.routine(config, routine.id, "early")).toMatchObject({ reason: "interval" });
  now++;
  expect(await service.routine(config, routine.id, "next")).toEqual({ sent: true });
  expect(sent).toHaveLength(2);
  expect(logs.join()).toContain("cloud.bot.routine-completed");
  expect(logs.join()).not.toContain(routine.response);
});
