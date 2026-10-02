import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MgbaFileProvider } from "../src/mgba-file-provider.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function fixture(team: unknown, mask: number) {
  const directory = mkdtempSync(join(tmpdir(), "pokemon-blue-provider-"));
  directories.push(directory);
  const teamPath = join(directory, "team.json");
  const badgesPath = join(directory, "badges.json");
  writeFileSync(teamPath, JSON.stringify(team));
  writeFileSync(badgesPath, JSON.stringify({ mask }));
  return new MgbaFileProvider(teamPath, badgesPath);
}

describe("MgbaFileProvider", () => {
  test("converts mGBA output into a normalized Pokémon snapshot", async () => {
    const provider = fixture([{
      id: "1234-abcd",
      number: 37,
      name: "Kleo",
      level: 40,
      hp: 100,
      maxHp: 100,
      experience: 67907,
    }], 5);

    const snapshot = await provider.readSnapshot();
    expect(snapshot.party[0]).toEqual({
      id: "1234-abcd",
      nationalDexNumber: 37,
      name: "Kleo",
      level: 40,
      hp: 100,
      maxHp: 100,
      experience: 67907,
    });
    expect(snapshot.badges).toEqual({ ownedBadgeIds: ["boulder", "thunder"] });
  });

  test("derives stable fallback identity without using party position", async () => {
    const provider = fixture([{
      number: 37,
      name: "Kleo",
      level: 40,
      hp: 100,
      maxHp: 100,
      experience: 67907,
    }], 0);
    expect((await provider.readSnapshot()).party[0]?.id).toBe("37:kleo");
  });

  test("rejects malformed party data", async () => {
    const provider = fixture([{ number: 37, name: "Kleo" }], 0);
    await expect(provider.readSnapshot()).rejects.toThrow("party member is malformed");
  });
});
