import { afterEach, expect, test, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  config: undefined as undefined | ((config: any) => void),
  message: undefined as undefined | ((message: any) => void),
  setStreamerDid: vi.fn(),
  stop: vi.fn(),
}));
let close: (() => void) | undefined;
async function start(preview = false) {
  const host: any = {
    did: "did:plc:owner",
    token: "test",
    preview,
    subscribe: (callback: any) => {
      runtime.config = callback;
      return () => {};
    },
    chat: {
      messages: {
        subscribe: (callback: any) => {
          runtime.message = callback;
          return () => {};
        },
      },
    },
    acquireChat: () => {
      runtime.setStreamerDid("did:plc:owner");
      return () => runtime.setStreamerDid("");
    },
  };
  close = (await import("../src/cloud-bot.ts")).mountBot(host);
}
afterEach(() => {
  close?.();
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});
test("standby does not listen or schedule; takeover starts a fresh interval and loss stops it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  window.history.replaceState({}, "", "/bot/?did=did:plc:owner&token=test");
  let active = false;
  const requests: { url: string; data: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: any) => {
      requests.push({ url, data: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ active }) };
    }),
  );
  await start();
  runtime.config!({
    bot: {
      enabled: true,
      rules: [{ command: "hi" }],
      routines: [{ id: "one", response: "hello", enabled: true, intervalSeconds: 30 }],
    },
  });
  await vi.advanceTimersByTimeAsync(80_000);
  expect(requests.every((item) => item.url.endsWith("/lease"))).toBe(true);
  expect(runtime.setStreamerDid).not.toHaveBeenCalledWith("did:plc:owner");
  active = true;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(runtime.setStreamerDid).toHaveBeenCalledWith("did:plc:owner");
  await vi.advanceTimersByTimeAsync(29_000);
  expect(requests.filter((item) => item.url.endsWith("/routine"))).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(requests.filter((item) => item.url.endsWith("/routine"))).toHaveLength(1);
  runtime.message!({ text: "!hi", id: "did:plc:chatter:rkey", author: { did: "did:plc:chatter" } });
  expect(requests.at(-1)!.url).toMatch(/\/trigger$/);
  expect(new Set(requests.map((item) => item.data.sourceId)).size).toBe(1);
  active = false;
  await vi.advanceTimersByTimeAsync(70_000);
  expect(requests.filter((item) => item.url.endsWith("/routine"))).toHaveLength(1);
  expect(runtime.setStreamerDid).toHaveBeenLastCalledWith("");
});

test("preview never acquires a bot lease or sends replies", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await start(true);
  await vi.advanceTimersByTimeAsync(120000);
  expect(fetch).not.toHaveBeenCalled();
});
