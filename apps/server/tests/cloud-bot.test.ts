import { expect, test } from "bun:test";
import { CloudBot, botSourceToken, validBotSourceToken } from "../src/cloud-bot.ts";
import {
  serializeModuleRecords,
  parseModuleRecords,
  moduleCollections,
} from "../src/module-records.ts";
import { StructuredLogger } from "../src/logger.ts";
import type { BotAuth } from "../src/bot-auth.ts";
import type { CloudConfig } from "../src/pds.ts";
const did = "did:plc:streamer",
  author = "did:plc:viewer",
  now = Date.parse("2026-10-10T12:00:00Z");
const uri = `at://${author}/place.stream.chat.message/3abc`;
const config: CloudConfig = {
  streamerDid: did,
  enabled: true,
  commands: [],
  revision: "new",
  bot: { enabled: true, rules: [{ command: "hi", response: "Hello chat!", cooldownSeconds: 30 }] },
};
function harness(overrides: Record<string, unknown> = {}) {
  const sent: any[] = [],
    logs: string[] = [];
  let time = now,
    requests = 0;
  const view = {
    $type: "place.stream.chat.defs#messageView",
    uri,
    author: { did: author },
    record: { streamer: did, text: "!hi", createdAt: new Date(now).toISOString() },
    ...overrides,
  };
  const auth = {
    getAgent: async () => ({
      did: "did:plc:bot",
      com: {
        atproto: {
          repo: {
            createRecord: async (value: any) => {
              sent.push(value);
            },
          },
        },
      },
    }),
  } as unknown as BotAuth;
  const transport = Object.assign(
    async (input: any) => {
      expect(String(input)).toBe(`https://stream.place/api/chat/${encodeURIComponent(did)}`);
      requests++;
      return Response.json([view]);
    },
    { preconnect: fetch.preconnect },
  );
  return {
    service: new CloudBot(
      auth,
      new StructuredLogger(undefined, (line) => logs.push(line)),
      transport,
      () => time,
    ),
    sent,
    logs,
    view,
    advance: (amount: number) => {
      time += amount;
    },
    requests: () => requests,
  };
}
test("Bot role gates use verified Streamplace badges and explicit identities, with blocks taking priority", async () => {
  const roles = { followers: false, mutuals: false, moderators: true, users: [] };
  const candidate = { ...config, bot: { ...config.bot!, roles } };
  const denied = harness();
  expect(await denied.service.trigger(candidate, uri, "roles-denied")).toEqual({ sent: false, reason: "role-not-allowed" });
  const mod = harness({ badges: [{ badgeType: "place.stream.badge.defs#mod", recipient: author }] });
  expect(await mod.service.trigger(candidate, uri, "roles-mod")).toEqual({ sent: true });
  const forgedSlot = harness({ badges: [{ badgeType: "place.stream.badge.defs#bot", recipient: author }, { badgeType: "place.stream.badge.defs#mod", recipient: author }] });
  expect(await forgedSlot.service.trigger(candidate, uri, "roles-slot")).toEqual({ sent: false, reason: "role-not-allowed" });
  const allowed = harness();
  const explicit = { ...candidate, bot: { ...candidate.bot, roles: { ...roles, users: [{ did: author }] } } };
  expect(await allowed.service.trigger(explicit, uri, "roles-explicit")).toEqual({ sent: true });
  const blocked = harness();
  expect(await blocked.service.trigger({ ...explicit, bot: { ...explicit.bot, moderation: [{ did: author, blocked: true, cooldownSeconds: 0 }] } }, uri, "roles-blocked")).toEqual({ sent: false, reason: "user-blocked" });
});
test("verified commands send only server-configured replies, with valid stable TID keys and duplicate protection", async () => {
  const h = harness();
  expect(await h.service.trigger(config, uri, "test-1")).toEqual({ sent: true });
  expect(h.sent[0].record).toMatchObject({
    text: "Hello chat!",
    streamer: did,
    $type: "place.stream.chat.message",
  });
  expect(h.sent[0].rkey).toMatch(/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
  expect(await h.service.trigger(config, uri, "test-2")).toMatchObject({ reason: "duplicate" });
  expect(h.sent).toHaveLength(1);
  expect(h.logs.join()).toContain("cloud.bot.reply-completed");
  expect(h.logs.join()).not.toContain("Hello chat!");
});
test("rejects disabled, forged, stale, deleted and bot-authored messages without sending", async () => {
  for (const overrides of [
    { deleted: true },
    { author: { did: "did:plc:forged" } },
    { record: { streamer: did, text: "!hi", createdAt: new Date(now - 61000).toISOString() } },
    { record: { streamer: "did:plc:other", text: "!hi", createdAt: new Date(now).toISOString() } },
  ]) {
    const h = harness(overrides);
    expect((await h.service.trigger(config, uri, "reject")).sent).toBe(false);
    expect(h.sent).toHaveLength(0);
  }
  const h = harness();
  expect(
    await h.service.trigger(
      { ...config, bot: { ...config.bot!, enabled: false } },
      uri,
      "disabled",
    ),
  ).toMatchObject({ reason: "disabled" });
  expect(await h.service.trigger(config, "https://localhost/private", "invalid")).toMatchObject({
    reason: "invalid-message",
  });
  expect(h.requests()).toBe(0);
});
test("cooldown is shared across viewers and a restart derives the same record key", async () => {
  const h = harness();
  await h.service.trigger(config, uri, "first");
  h.advance(2100);
  h.view.uri = `at://${author}/place.stream.chat.message/3def`;
  expect(await h.service.trigger(config, h.view.uri, "second")).toMatchObject({
    reason: "cooldown",
  });
  const fresh = harness();
  await fresh.service.trigger(config, uri, "restart");
  expect(fresh.sent[0].rkey).toBe(h.sent[0].rkey);
});
test("private source tokens are scoped to account and service secret", () => {
  const token = botSourceToken(did, "test-secret");
  expect(validBotSourceToken(did, token, "test-secret")).toBe(true);
  expect(validBotSourceToken("did:plc:other", token, "test-secret")).toBe(false);
  expect(validBotSourceToken(did, token, "other-secret")).toBe(false);
  expect(validBotSourceToken(did, undefined, "test-secret")).toBe(false);
});
test("bot user blocks and shared cooldowns are independent of Emoticons moderation", async () => {
  const blocked = harness();
  const restriction = { did: author, blocked: true, cooldownSeconds: 0 };
  expect(
    await blocked.service.trigger(
      { ...config, bot: { ...config.bot!, moderation: [restriction] } },
      uri,
      "blocked",
    ),
  ).toMatchObject({ reason: "user-blocked" });
  expect(blocked.sent).toHaveLength(0);
  const h = harness();
  const moderated = {
    ...config,
    moderation: [restriction],
    bot: {
      enabled: true,
      rules: [
        { command: "hi", response: "Hi", cooldownSeconds: 5 },
        { command: "bye", response: "Bye", cooldownSeconds: 5 },
      ],
      moderation: [{ ...restriction, blocked: false, cooldownSeconds: 30 }],
    },
  };
  expect((await h.service.trigger(moderated, uri, "accepted")).sent).toBe(true);
  h.advance(7000);
  h.view.uri = `at://${author}/place.stream.chat.message/3next`;
  h.view.record.text = "!bye";
  expect(await h.service.trigger(moderated, h.view.uri, "cooldown")).toMatchObject({
    reason: "user-cooldown",
  });
  expect(h.sent).toHaveLength(1);
  const records = serializeModuleRecords(moderated, [], new Date(now).toISOString());
  expect(parseModuleRecords(did, records).bot?.moderation).toEqual(moderated.bot.moderation);
  const oldClient = { ...moderated, bot: { enabled: true, rules: moderated.bot.rules } };
  expect(
    parseModuleRecords(did, serializeModuleRecords(oldClient, records, new Date(now).toISOString()))
      .bot?.moderation,
  ).toEqual(moderated.bot.moderation);
});
test("bot PDS records roundtrip and older clients retain rules", () => {
  const records = serializeModuleRecords(config, [], new Date(now).toISOString());
  expect(
    records.find((item) => item.collection === moduleCollections.bot)?.value.rules[0]
      .cooldownMilliseconds,
  ).toBe(30000);
  expect(parseModuleRecords(did, records).bot).toEqual(config.bot);
  const { bot, ...older } = config;
  expect(
    parseModuleRecords(did, serializeModuleRecords(older, records, new Date(now).toISOString()))
      .bot,
  ).toEqual(bot);
  expect(() =>
    serializeModuleRecords(
      { ...config, bot: { enabled: true, rules: [...bot!.rules, ...bot!.rules] } },
      [],
      new Date(now).toISOString(),
    ),
  ).toThrow();
});
