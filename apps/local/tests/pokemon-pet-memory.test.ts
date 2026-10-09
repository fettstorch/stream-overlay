import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PetMemory } from "../src/pokemon-pet-memory.ts";
import type { Pokemon } from "@streamface/pokemon-model";
import type { StreamChatMessage } from "@streamface/stream-chat";

const party: Pokemon[] = [{ id: "stable-id", nationalDexNumber: 37, name: " Kleo ", level: 40, hp: 50, maxHp: 100, experience: 67907 }];
const message = (id: string, did = "viewer-a", text = " !PET kleo ", streamerDid = "streamer"): StreamChatMessage => ({
  id, text, streamerDid, createdAt: "", author: { did, avatar: "/avatar.png" },
});

test("counts matched commands once and chooses the highest count, not the last petter", () => {
  const memory = new PetMemory();
  expect(memory.record(message("1"), party)).toBe(true);
  expect(memory.record(message("1"), party)).toBe(false);
  memory.record(message("2"), party);
  memory.record(message("3", "viewer-b"), party);
  expect(memory.favourite("streamer", "stable-id")?.authorDid).toBe("viewer-a");
  expect(memory.favourite("streamer", "stable-id")?.count).toBe(2);
  expect(memory.record(message("4", "viewer-b", "!pet Missing"), party)).toBe(false);
  expect(memory.record(message("5", "viewer-b", "hi"), party)).toBe(false);
  expect(memory.record(message("6"), [])).toBe(false);
  expect(memory.favourite("another-stream", "stable-id")).toBeNull();
  memory.record(message("7", "viewer-c", "!pet Renamed"), [{ ...party[0]!, name: "Renamed", nationalDexNumber: 38 }]);
  expect(memory.favourite("streamer", "stable-id")?.authorDid).toBe("viewer-a");
});

test("persists counts and deduplication, but never profile data", () => {
  const directory = mkdtempSync(join(tmpdir(), "pet-memory-test-"));
  try {
    const path = join(directory, "counts.json");
    new PetMemory(path).record(message("1"), party);
    const restored = new PetMemory(path);
    expect(restored.favourite("streamer", "stable-id")?.count).toBe(1);
    expect(restored.record(message("1"), party)).toBe(false);
    expect(readFileSync(path, "utf8")).not.toContain("avatar");
    restored.record(message("2"), party);
    expect(new PetMemory(path).favourite("streamer", "stable-id")?.count).toBe(2);
  } finally { rmSync(directory, { recursive: true }); }
});

test("reset purges every count and its file without touching game data, then counting resumes", () => {
  const directory = mkdtempSync(join(tmpdir(), "pet-memory-test-"));
  try {
    const path = join(directory, "counts.json");
    const teamPath = join(directory, "team.json");
    writeFileSync(teamPath, "game data");
    const memory = new PetMemory(path);
    memory.record(message("1"), party);
    memory.record(message("2", "another-viewer", "!pet Kleo", "another-stream"), party);
    memory.reset();
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(teamPath, "utf8")).toBe("game data");
    expect(memory.favourite("streamer", "stable-id")).toBeNull();
    expect(memory.favourite("another-stream", "stable-id")).toBeNull();
    expect(new PetMemory(path).favourite("streamer", "stable-id")).toBeNull();
    memory.reset(); // Missing files are safe.
    expect(memory.record(message("1"), party)).toBe(false); // No restoration from replay.
    expect(memory.record(message("3"), party)).toBe(true);
    expect(new PetMemory(path).favourite("streamer", "stable-id")?.count).toBe(1);
  } finally { rmSync(directory, { recursive: true }); }
});
