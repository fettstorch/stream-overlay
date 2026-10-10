import { expect, test } from "bun:test";
import { commandNamePattern, validDimension, validateCloudCommand } from "../src/validation.ts";
import type { CloudCommand } from "../src/cloud-contracts.ts";

const command: CloudCommand = {
  id: "wave",
  command: "wave",
  mode: "effect",
  image: { url: "https://cdn.example/wave.gif" },
  durationSeconds: 5,
  cooldownSeconds: 20,
  volume: 1,
  width: "40vw",
  height: "auto",
  mirrored: false,
};
test("shared names and dimensions have consistent local/cloud boundaries", () => {
  expect(commandNamePattern.test("a".repeat(40))).toBe(true);
  expect(commandNamePattern.test("a".repeat(41))).toBe(false);
  for (const value of ["", "auto", "300px", "40vw", "25vh", "50%", " 2rem "])
    expect(validDimension(value)).toBe(true);
  for (const value of ["red", "-1px", "url(x)", 30]) expect(validDimension(value)).toBe(false);
});
test("Giphy IDs are a third image source, never mixed with URLs or blobs", () => {
  expect(() => validateCloudCommand({ ...command, image: { giphyId: "abc123" } })).not.toThrow();
  for (const giphyId of ["", "https://giphy.com/x", "bad/id", "a".repeat(129)])
    expect(() => validateCloudCommand({ ...command, image: { giphyId } })).toThrow("Giphy");
  expect(() => validateCloudCommand({ ...command, image: { giphyId: "abc", url: "https://example.com/x" } })).toThrow();
  expect(() => validateCloudCommand({ ...command, image: undefined, video: { giphyId: "abc" } })).toThrow();
});
test("cloud writes require playable media and one visual; legacy reads can omit media", () => {
  expect(() =>
    validateCloudCommand({ ...command, volume: "1" } as unknown as CloudCommand),
  ).toThrow("playback");
  expect(() => validateCloudCommand(command)).not.toThrow();
  expect(() => validateCloudCommand({ ...command, image: undefined })).toThrow("Add an image");
  expect(() => validateCloudCommand({ ...command, image: undefined }, false)).not.toThrow();
  expect(() =>
    validateCloudCommand({ ...command, video: { url: "https://cdn.example/video.mp4" } }),
  ).toThrow("image or video");
  expect(() =>
    validateCloudCommand({
      ...command,
      mode: "sticker",
      audio: { url: "https://cdn.example/audio.mp3" },
    }),
  ).toThrow("audio");
  expect(() =>
    validateCloudCommand({ ...command, image: { url: "http://cdn.example/wave.gif" } }),
  ).toThrow("HTTPS");
  expect(() => validateCloudCommand({ ...command, width: "nonsense" })).toThrow("CSS sizes");
});
