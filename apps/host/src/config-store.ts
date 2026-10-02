import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModuleConfiguration } from "@stream-overlay/sdk";

export interface HostConfiguration {
  modules: ModuleConfiguration[];
  pokemonBlue: {
    streamerDid: string;
    components: {
      team: boolean;
      badges: boolean;
    };
  };
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
      || typeof pokemonBlue.streamerDid !== "string"
      || !pokemonBlue.components || typeof pokemonBlue.components.team !== "boolean"
      || typeof pokemonBlue.components.badges !== "boolean"
    ) {
      throw new TypeError("Pokémon Blue configuration is invalid");
    }
    return {
      modules: modules as ModuleConfiguration[],
      pokemonBlue: structuredClone(pokemonBlue),
    };
  }
}
