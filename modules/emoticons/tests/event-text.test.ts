import { expect, test } from "bun:test";
import { formatEventText } from "../src/events.ts";

test("teleport captions replace every supported placeholder literally in one pass", () => {
  expect(formatEventText("Hi [teleporter]! [viewers] viewers for [teleporter]. [other]", {
    type: "teleport-arrival", author: { displayName: "$& [viewers]", handle: "source.example" }, viewerCount: 42,
  })).toBe("Hi $& [viewers]! 42 viewers for $& [viewers]. [other]");
});
test("teleport captions fall back to handle and preserve zero viewers", () => {
  expect(formatEventText("[teleporter]: [viewers]", { type: "teleport-arrival", author: { displayName: " ", handle: "source.example" }, viewerCount: 0 })).toBe("source.example: 0");
  expect(formatEventText("[teleporter]: [viewers]", { type: "teleport-arrival" })).toBe("Another streamer: unknown");
  expect(formatEventText("[teleporter]", { type: "stream-started" })).toBe("[teleporter]");
  expect(formatEventText(undefined, { type: "teleport-arrival" })).toBeUndefined();
});
