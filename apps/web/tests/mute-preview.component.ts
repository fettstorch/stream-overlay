import { expect, test } from "vitest";
import { mutePreview } from "../src/mute-preview.ts";

test("mutes current, late-playing and nested local media and removes listeners", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const preview = frame.contentDocument!;
  preview.body.innerHTML = '<video></video><iframe></iframe>';
  const video = preview.querySelector("video")!;
  const nested = preview.querySelector("iframe")!.contentDocument!;
  nested.body.innerHTML = '<audio></audio>';
  const cleanup = mutePreview(frame);
  expect(video.muted).toBe(true);
  expect(video.defaultMuted).toBe(true);
  expect(nested.querySelector("audio")!.muted).toBe(true);
  const late = preview.createElement("audio");
  preview.body.append(late);
  late.dispatchEvent(new Event("play"));
  expect(late.muted).toBe(true);
  late.muted = false;
  late.dispatchEvent(new Event("volumechange"));
  expect(late.muted).toBe(true);
  cleanup();
  late.muted = false;
  late.dispatchEvent(new Event("volumechange"));
  expect(late.muted).toBe(false);
  frame.remove();
});

test("cross-origin previews remain usable when document access is denied", () => {
  const frame = document.createElement("iframe");
  Object.defineProperty(frame, "contentDocument", { get: () => { throw new DOMException("Blocked", "SecurityError"); } });
  expect(() => mutePreview(frame)()).not.toThrow();
});
