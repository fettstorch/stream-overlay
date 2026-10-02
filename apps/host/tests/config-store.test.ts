import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../src/config-store.ts";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "stream-overlay-config-"));
  directories.push(directory);
  return new ConfigStore(join(directory, "config.json"), {
    modules: [{ id: "pokemon-blue", enabled: true }],
    stream: { streamerDid: "" },
    pokemonBlue: {
      components: { team: true, badges: true },
    },
  });
}

describe("ConfigStore", () => {
  test("persists chat fade settings and rejects invalid percentages", () => {
    const store = createStore();
    const configuration = { ...store.read(), chat: { ...defaultChatConfiguration, fadeOut: 80 } };
    store.write(configuration);
    expect(store.read().chat).toEqual(configuration.chat);
    for (const fadeOut of [-1, 101, NaN, Infinity]) {
      expect(() => store.write({ ...configuration, chat: { ...configuration.chat, fadeOut } })).toThrow();
    }
    for (const settings of [{ fontSize: 0 }, { fontSize: 73 }, { backgroundColor: "red" }, { backgroundOpacity: 101 },
      { rotationX: 181 }, { rotationY: -181 }, { rotationX: NaN }, { rotationY: Infinity }]) {
      expect(() => store.write({ ...configuration, chat: { ...configuration.chat, ...settings } })).toThrow();
    }
    const appearance = { ...configuration.chat, fontSize: 32, backgroundColor: "#123456", backgroundOpacity: 40, rotationX: 25, rotationY: -35 };
    store.write({ ...configuration, chat: appearance });
    expect(store.read().chat).toEqual(appearance);
    writeFileSync(store.path, JSON.stringify({ ...configuration, chat: { fadeOut: 80 } }));
    expect(store.read().chat).toEqual(configuration.chat);
  });
  test("returns defaults when no persisted configuration exists", () => {
    expect(createStore().read()).toEqual({
      modules: [{ id: "pokemon-blue", enabled: true }],
      stream: { streamerDid: "" },
      pokemonBlue: {
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

  test("persists Paint settings and rejects invalid colors or delays", () => {
    const store = createStore();
    const configuration = store.read();
    configuration.overlayPaint = { color: "#123456", decaySeconds: 8 };
    store.write(configuration);
    expect(store.read().overlayPaint).toEqual(configuration.overlayPaint);
    expect(() => store.write({ ...configuration, overlayPaint: { color: "invalid", decaySeconds: 8 } })).toThrow();
    expect(() => store.write({ ...configuration, overlayPaint: { color: "#123456", decaySeconds: -1 } })).toThrow();
  });

  test("migrates the legacy Pokémon streamer DID into global stream settings", () => {
    const store = createStore();
    writeFileSync(store.path, JSON.stringify({
      modules: [{ id: "pokemon-blue", enabled: true }],
      pokemonBlue: {
        streamerDid: "did:plc:legacy",
        components: { team: true, badges: false },
      },
    }));
    expect(store.read()).toEqual({
      modules: [{ id: "pokemon-blue", enabled: true }],
      stream: { streamerDid: "did:plc:legacy" },
      pokemonBlue: { components: { team: true, badges: false } },
    });
  });

  test("rejects malformed persisted configuration", () => {
    const store = createStore();
    store.write({
      modules: [],
      stream: { streamerDid: "" },
      pokemonBlue: { components: { team: true, badges: true } },
    });
    expect(() => store.write({
      modules: [{ id: "broken", enabled: "yes" as never }],
      stream: { streamerDid: "" },
      pokemonBlue: { components: { team: true, badges: true } },
    })).toThrow();
  });
});
