import { expect, test } from "bun:test";
import { BotAuth, createBotAuth, streamfaceBotDid } from "../src/bot-auth.ts";
import { StructuredLogger } from "../src/logger.ts";

const options = {
  identifier: "streamface.live",
  appPassword: "test-app-password",
  service: "https://bsky.social",
  expectedDid: streamfaceBotDid,
};
const session = {
  did: streamfaceBotDid,
  handle: "streamface.live",
  accessJwt: "test-access",
  refreshJwt: "test-refresh",
  active: true,
};
function harness(handler: (request: Request) => Response | Promise<Response>, now = Date.now) {
  const logs: string[] = [],
    requests: Request[] = [];
  const transport = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = new Request(input, init);
      requests.push(request);
      return handler(request);
    },
    { preconnect: fetch.preconnect },
  );
  const bot = new BotAuth(
    options,
    new StructuredLogger(undefined, (line) => logs.push(line)),
    now,
    transport,
  );
  return { bot, logs, requests };
}

test("bot login uses the real SDK, shares concurrent readiness, and never logs credentials", async () => {
  const { bot, logs, requests } = harness(async (request) => {
    expect(request.url).toContain("com.atproto.server.createSession");
    expect(await request.json()).toMatchObject({
      identifier: options.identifier,
      password: options.appPassword,
    });
    return Response.json(session);
  });
  const first = bot.getAgent();
  expect(bot.getAgent()).toBe(first);
  const agent = await first;
  expect(await bot.getAgent()).toBe(agent);
  expect(requests).toHaveLength(1);
  expect(logs.join()).toContain("cloud.bot.login-completed");
  for (const secret of [options.appPassword, session.accessJwt, session.refreshJwt])
    expect(logs.join()).not.toContain(secret);
  bot.stop();
  await expect(bot.getAgent()).rejects.toThrow("stopped");
});

test("failed login backs off, can recover, and rejects a different service account", async () => {
  let time = 0,
    fail = true;
  const { bot, requests, logs } = harness(
    () =>
      fail
        ? Response.json(
            { error: "AuthenticationRequired", message: options.appPassword },
            { status: 401 },
          )
        : Response.json(session),
    () => time,
  );
  await expect(bot.getAgent()).rejects.toThrow("Bot login failed");
  await expect(bot.getAgent()).rejects.toThrow("temporarily unavailable");
  expect(requests).toHaveLength(1);
  time = 60_000;
  fail = false;
  await bot.getAgent();
  expect(requests).toHaveLength(2);
  expect(logs.join()).toContain("cloud.bot.login-failed");
  expect(logs.join()).not.toContain(options.appPassword);
  const wrong = harness(() => Response.json({ ...session, did: "did:plc:other" }));
  await expect(wrong.bot.getAgent()).rejects.toThrow("Bot login failed");
  expect(wrong.logs.join()).not.toContain("login-completed");
  bot.stop();
  wrong.bot.stop();
});

test("SDK refreshes an expired bot token without another password login", async () => {
  let expired = true;
  const { bot, requests } = harness((request) => {
    if (request.url.endsWith("createSession")) return Response.json(session);
    if (request.url.endsWith("refreshSession")) {
      expired = false;
      return Response.json({ ...session, accessJwt: "renewed-access" });
    }
    return expired
      ? Response.json({ error: "ExpiredToken", message: "Expired" }, { status: 401 })
      : Response.json({ did: session.did, handle: session.handle, active: true });
  });
  const agent = await bot.getAgent();
  await agent.com.atproto.server.getSession();
  expect(requests.filter((request) => request.url.endsWith("createSession"))).toHaveLength(1);
  expect(requests.filter((request) => request.url.endsWith("refreshSession"))).toHaveLength(1);
  bot.stop();
});

test("bot authentication is opt-in and rejects unsafe service URLs", () => {
  const logs: string[] = [],
    logger = new StructuredLogger(undefined, (line) => logs.push(line));
  expect(createBotAuth({}, logger)).toBeUndefined();
  expect(logs.join()).toContain("not-configured");
  for (const service of [
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test?password=x",
  ])
    expect(() => new BotAuth({ ...options, service }, logger)).toThrow("BOT_PDS");
});
