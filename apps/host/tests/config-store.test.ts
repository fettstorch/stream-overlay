import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../src/config-store.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "stream-overlay-config-"));
  directories.push(directory);
  return new ConfigStore(join(directory, "config.json"), {
    modules: [{ id: "pokemon-blue", enabled: true }],
    pokemonBlue: {
      streamerDid: "",
      components: { team: true, badges: true },
    },
  });
}

describe("ConfigStore", () => {
  test("returns defaults when no persisted configuration exists", () => {
    expect(createStore().read()).toEqual({
      modules: [{ id: "pokemon-blue", enabled: true }],
      pokemonBlue: {
        streamerDid: "",
        components: { team: true, badges: true },
      },
    });
  });

  test("persists module settings atomically", () => {
    const store = createStore();
    store.setModuleEnabled("pokemon-blue", false);
    expect(store.read().modules).toEqual([{ id: "pokemon-blue", enabled: false }]);
    expect(JSON.parse(readFileSync(store.path, "utf8"))).toEqual(store.read());
  });

  test("rejects malformed persisted configuration", () => {
    const store = createStore();
    store.write({
      modules: [],
      pokemonBlue: { streamerDid: "", components: { team: true, badges: true } },
    });
    expect(() => store.write({
      modules: [{ id: "broken", enabled: "yes" as never }],
      pokemonBlue: { streamerDid: "", components: { team: true, badges: true } },
    })).toThrow();
  });
});
