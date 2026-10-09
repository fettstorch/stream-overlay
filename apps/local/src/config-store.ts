import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModuleConfiguration } from "@streamface/sdk";
import { parsePaintConfiguration, type PaintConfiguration } from "../../../modules/overlay-paint/src/config.ts";
import { parseChatConfiguration, type ChatConfiguration } from "../../../modules/chat/src/config.ts";
import { parseThoughtInterval, type PokemonBlueConfiguration } from "../../../modules/pokemon-blue/src/config.ts";

export interface HostConfiguration {
  chat?: ChatConfiguration;
  overlayPaint?: PaintConfiguration;
  modules: ModuleConfiguration[];
  stream: {
    streamerDid: string;
  };
  pokemonBlue: PokemonBlueConfiguration;
  pokemonCrystal?: PokemonBlueConfiguration;
}

export class ConfigStore {
  readonly path: string;
  readonly defaults: HostConfiguration;

  constructor(path: string, defaults: HostConfiguration) {
    this.path = path;
    this.defaults = defaults;
  }

  read(): HostConfiguration {
    try {
      return this.validate(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      return structuredClone(this.defaults);
    }
  }

  write(configuration: HostConfiguration) {
    const validated = this.validate(configuration);
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`);
    renameSync(temporaryPath, this.path);
  }

  setModuleEnabled(id: string, enabled: boolean) {
    const configuration = this.read();
    const module = configuration.modules.find((entry) => entry.id === id);
    if (module) module.enabled = enabled;
    else configuration.modules.push({ id, enabled });
    this.write(configuration);
    return configuration;
  }

  private validate(value: unknown): HostConfiguration {
    if (!value || typeof value !== "object" || !("modules" in value)) {
      throw new TypeError("Configuration must contain modules");
    }
    const modules = (value as { modules: unknown }).modules;
    if (!Array.isArray(modules) || modules.some((entry) => (
      !entry || typeof entry !== "object"
      || typeof (entry as ModuleConfiguration).id !== "string"
      || typeof (entry as ModuleConfiguration).enabled !== "boolean"
    ))) {
      throw new TypeError("Configuration modules are invalid");
    }
    const pokemonBlue = "pokemonBlue" in value
      ? (value as HostConfiguration).pokemonBlue
      : this.defaults.pokemonBlue;
    if (
      !pokemonBlue || typeof pokemonBlue !== "object"
      || !pokemonBlue.components || typeof pokemonBlue.components.team !== "boolean"
      || typeof pokemonBlue.components.badges !== "boolean"
      || parseThoughtInterval(pokemonBlue.thoughtIntervalSeconds) === null
    ) {
      throw new TypeError("Pokémon Blue configuration is invalid");
    }
    const legacyStreamerDid = "streamerDid" in pokemonBlue && typeof pokemonBlue.streamerDid === "string"
      ? pokemonBlue.streamerDid
      : this.defaults.stream.streamerDid;
    const pokemonCrystal = "pokemonCrystal" in value ? (value as HostConfiguration).pokemonCrystal : undefined;
    if ("pokemonCrystal" in value && (!pokemonCrystal || typeof pokemonCrystal !== "object" || !pokemonCrystal.components || typeof pokemonCrystal.components.team !== "boolean"
      || typeof pokemonCrystal.components.badges !== "boolean" || parseThoughtInterval(pokemonCrystal.thoughtIntervalSeconds) === null)) {
      throw new TypeError("Pokémon Crystal configuration is invalid");
    }
    const stream = "stream" in value ? (value as HostConfiguration).stream : { streamerDid: legacyStreamerDid };
    if (!stream || typeof stream !== "object" || typeof stream.streamerDid !== "string") {
      throw new TypeError("Stream configuration is invalid");
    }
    const overlayPaint = "overlayPaint" in value ? parsePaintConfiguration(value.overlayPaint) : undefined;
    if (overlayPaint === null) throw new TypeError("Overlay Paint configuration is invalid");
    const chat = "chat" in value ? parseChatConfiguration(value.chat) : undefined;
    if (chat === null) throw new TypeError("Chat configuration is invalid");
    return {
      ...(chat ? { chat } : {}),
      ...(pokemonCrystal ? { pokemonCrystal: structuredClone(pokemonCrystal) } : {}),
      ...(overlayPaint ? { overlayPaint } : {}),
      modules: modules as ModuleConfiguration[],
      stream: structuredClone(stream),
      pokemonBlue: {
        components: structuredClone(pokemonBlue.components),
        ...(pokemonBlue.thoughtIntervalSeconds !== undefined ? { thoughtIntervalSeconds: pokemonBlue.thoughtIntervalSeconds } : {}),
      },
    };
  }
}
