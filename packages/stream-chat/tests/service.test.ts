import { describe, expect, test } from "bun:test";
import { parseChatEvent } from "../src/service.ts";

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
