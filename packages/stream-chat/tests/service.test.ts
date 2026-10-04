import { describe, expect, test, spyOn } from "bun:test";
import { parseChatEvent, StreamChatService } from "../src/service.ts";

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
