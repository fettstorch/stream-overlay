import { describe, expect, test, spyOn } from "bun:test";
import { parseChatEvent, StreamChatService } from "../src/service.ts";
import { DirectStreamChatService } from "../src/direct-service.ts";

describe("parseChatEvent", () => {
  test("normalizes a chat message for the configured streamer", () => {
    expect(parseChatEvent({
      kind: "commit",
      did: "did:plc:viewer",
      commit: {
        operation: "create",
        collection: "place.stream.chat.message",
        rkey: "message-1",
        record: {
          streamer: "did:plc:streamer",
          text: "!pet Kleo",
          createdAt: "2026-10-02T12:00:00.000Z",
        },
      },
    }, "did:plc:streamer")).toEqual({
      id: "did:plc:viewer:message-1",
      streamerDid: "did:plc:streamer",
      authorDid: "did:plc:viewer",
      text: "!pet Kleo",
      createdAt: "2026-10-02T12:00:00.000Z",
    });
  });

  test("ignores messages for another streamer", () => {
    expect(parseChatEvent({
      kind: "commit",
      did: "did:plc:viewer",
      commit: {
        operation: "create",
        collection: "place.stream.chat.message",
        record: { streamer: "did:plc:other", text: "hello" },
      },
    }, "did:plc:streamer")).toBeNull();
  });
});

test("direct browser transport ignores startup history and repeated reconnect events", async () => {
  class FakeSocket extends EventTarget { close() {} }
  const sockets: FakeSocket[] = [];
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  const service = new DirectStreamChatService();
  const ids: string[] = [];
  const unsubscribe = service.messages.subscribe(message => ids.push(message.id));
  const message = (rkey: string, createdAt: string) => JSON.stringify({
    $type: "place.stream.chat.defs#messageView",
    uri: `at://did:plc:viewer/place.stream.chat.message/${rkey}`,
    author: { did: "did:plc:viewer" },
    record: { streamer: "did:plc:streamer", text: "!party", createdAt },
  });
  try {
    service.setStreamerDid("did:plc:streamer");
    sockets[0]!.dispatchEvent(new MessageEvent("message", { data: message("history", new Date(Date.now() - 60_000).toISOString()) }));
    sockets[0]!.dispatchEvent(new MessageEvent("message", { data: message("live", new Date(Date.now() + 1_000).toISOString()) }));
    sockets[0]!.dispatchEvent(new MessageEvent("message", { data: message("live", new Date(Date.now() + 1_000).toISOString()) }));
    expect(ids).toEqual(["did:plc:viewer:live"]);

    sockets[0]!.dispatchEvent(new Event("close"));
    await Bun.sleep(1050);
    sockets[1]!.dispatchEvent(new MessageEvent("message", { data: message("live", new Date(Date.now() + 1_000).toISOString()) }));
    sockets[1]!.dispatchEvent(new MessageEvent("message", { data: message("older-unseen", new Date(Date.now() - 60_000).toISOString()) }));
    expect(ids).toEqual(["did:plc:viewer:live"]);
  } finally {
    unsubscribe(); service.stop(); mock.mockRestore();
  }
});

test("profile lookups are concurrent but messages publish in arrival order, including failures", async () => {
  class FakeSocket extends EventTarget { close() {} }
  const socket = new FakeSocket();
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => socket as unknown as WebSocket);
  const pending = new Map<string, { resolve: (value: { did: string }) => void; reject: (error: Error) => void }>();
  const service = new StreamChatService(did => new Promise((resolve, reject) => { pending.set(did, { resolve, reject }); }));
  const ids: string[] = [];
  const unsubscribe = service.messages.subscribe(message => { ids.push(message.id); });
  try {
    service.setStreamerDid("did:plc:streamer");
    for (const did of ["slow", "fast", "failed"]) {
      socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
        kind: "commit", did, commit: { operation: "create", collection: "place.stream.chat.message", rkey: did,
          record: { streamer: "did:plc:streamer", text: did } },
      }) }));
    }
    expect(pending.size).toBe(3);
    pending.get("fast")!.resolve({ did: "fast" });
    pending.get("failed")!.reject(new Error("Profile unavailable"));
    await Bun.sleep(0);
    expect(ids).toEqual([]);
    pending.get("slow")!.resolve({ did: "slow" });
    await Bun.sleep(0);
    expect(ids).toEqual(["slow:slow", "fast:fast", "failed:failed"]);
  } finally { unsubscribe(); service.stop(); mock.mockRestore(); }
});

test("diagnostics never log unrelated or malformed message contents", async () => {
  class FakeSocket extends EventTarget { close() {} }
  const socket = new FakeSocket();
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => socket as unknown as WebSocket);
  const logs: unknown[] = [];
  const service = new StreamChatService(async did => ({ did }), (event, details) => { logs.push({ event, details }); });
  try {
    service.setStreamerDid("did:plc:streamer");
    for (const data of [JSON.stringify({ kind: "commit", did: "viewer", commit: {
      operation: "create", collection: "place.stream.chat.message", record: { streamer: "did:plc:other", text: "unrelated-private-text" },
    } }), 'invalid-json-with-private-text']) socket.dispatchEvent(new MessageEvent("message", { data }));
    await Bun.sleep(0);
    expect(JSON.stringify(logs)).not.toContain("unrelated-private-text");
    expect(JSON.stringify(logs)).not.toContain("invalid-json-with-private-text");
    expect(JSON.stringify(logs)).not.toContain("chat.jetstream-event-decoded");
  } finally { service.stop(); mock.mockRestore(); }
});

test("unrelated collection traffic produces no per-event diagnostic writes", () => {
  class FakeSocket extends EventTarget { close() {} }
  const socket = new FakeSocket();
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => socket as unknown as WebSocket);
  const logs: string[] = [];
  const service = new StreamChatService(async did => ({ did }), event => { logs.push(event); });
  try {
    service.setStreamerDid("did:plc:streamer");
    const before = logs.length;
    for (let i = 0; i < 1000; i++) socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
      kind: "commit", did: "viewer", commit: { operation: "create", collection: "place.stream.chat.message", record: { streamer: "did:plc:other", text: "hello" } },
    }) }));
    expect(logs).toHaveLength(before);
  } finally { service.stop(); mock.mockRestore(); }
});

test("stalled author lookup falls back and unblocks later messages", async () => {
  class FakeSocket extends EventTarget { close() {} }
  const socket = new FakeSocket();
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => socket as unknown as WebSocket);
  const service = new StreamChatService(did => did === "stalled" ? new Promise(() => {}) : Promise.resolve({ did }), () => {}, 10);
  const ids: string[] = [];
  const unsubscribe = service.messages.subscribe(message => { ids.push(message.id); });
  try {
    service.setStreamerDid("did:plc:streamer");
    for (const did of ["stalled", "ready"]) socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
      kind: "commit", did, commit: { operation: "create", collection: "place.stream.chat.message", rkey: did, record: { streamer: "did:plc:streamer", text: did } },
    }) }));
    await Bun.sleep(25);
    expect(ids).toEqual(["stalled:stalled", "ready:ready"]);
  } finally { unsubscribe(); service.stop(); mock.mockRestore(); }
});

test("accepted messages drain in order across transport reconnects", async () => {
  class FakeSocket extends EventTarget { close() {} }
  const sockets: FakeSocket[] = [];
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  let resolveOld!: (author: { did: string }) => void;
  const service = new StreamChatService(did => did === "old" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ did }));
  const ids: string[] = [];
  const unsubscribe = service.messages.subscribe(message => { ids.push(message.id); });
  const send = (socket: FakeSocket, did: string) => socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
    kind: "commit", did, commit: { operation: "create", collection: "place.stream.chat.message", rkey: did, record: { streamer: "did:plc:streamer", text: did } },
  }) }));
  try {
    service.setStreamerDid("did:plc:streamer"); send(sockets[0]!, "old");
    sockets[0]!.dispatchEvent(new Event("close"));
    await Bun.sleep(1050);
    expect(sockets).toHaveLength(2);
    send(sockets[1]!, "new");
    send(sockets[0]!, "stale");
    resolveOld({ did: "old" });
    await Bun.sleep(0);
    expect(ids).toEqual(["old:old", "new:new"]);
  } finally { unsubscribe(); service.stop(); mock.mockRestore(); }
});

for (const intermediate of ["", "did:plc:other"]) test(`superseded lookups cannot reappear after switching through ${intermediate || "disabled"}`, async () => {
  class FakeSocket extends EventTarget { close() {} }
  const sockets: FakeSocket[] = [];
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  let resolveOld!: (author: { did: string }) => void;
  const service = new StreamChatService(did => did === "old" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ did }));
  const ids: string[] = [];
  const unsubscribe = service.messages.subscribe(message => { ids.push(message.id); });
  const send = (socket: FakeSocket, did: string) => socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
    kind: "commit", did, commit: { operation: "create", collection: "place.stream.chat.message", rkey: did, record: { streamer: "did:plc:streamer", text: did } },
  }) }));
  try {
    service.setStreamerDid("did:plc:streamer"); send(sockets[0]!, "old");
    service.setStreamerDid(intermediate); service.setStreamerDid("did:plc:streamer");
    send(sockets.at(-1)!, "new");
    await Bun.sleep(0);
    expect(ids).toEqual(["new:new"]);
    resolveOld({ did: "old" });
    await Bun.sleep(0);
    send(sockets[0]!, "stale-socket");
    await Bun.sleep(0);
    expect(ids).toEqual(["new:new"]);
  } finally { unsubscribe(); service.stop(); mock.mockRestore(); }
});
