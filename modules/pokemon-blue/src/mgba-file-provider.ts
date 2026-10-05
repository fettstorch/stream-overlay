import { readFile } from "node:fs/promises";
import type { GameDataProvider } from "@stream-overlay/sdk";
import type { BadgeProgress, Pokemon, PokemonSnapshot } from "@stream-overlay/pokemon-model";

interface MgbaPokemon {
  id?: string;
  number: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  experience: number;
  experienceAtLevel?: number;
  experienceAtNextLevel?: number;
  isEgg?: boolean;
}

const badgeIds = [
  "boulder",
  "cascade",
  "thunder",
  "rainbow",
  "soul",
  "marsh",
  "volcano",
  "earth",
];

export class MgbaFileProvider implements GameDataProvider<PokemonSnapshot> {
  private readonly teamPath: string;
  private readonly badgesPath: string;
  private readonly pollInterval: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastSerializedSnapshot = "";

  constructor(teamPath: string, badgesPath: string, pollInterval = 500, private readonly gameBadgeIds = badgeIds, private readonly gameName = "Pokémon Blue") {
    this.teamPath = teamPath;
    this.badgesPath = badgesPath;
    this.pollInterval = pollInterval;
  }

  async readSnapshot(): Promise<PokemonSnapshot> {
    const [teamContents, badgesContents] = await Promise.all([
      readFile(this.teamPath, "utf8"),
      readFile(this.badgesPath, "utf8"),
    ]);
    const team = JSON.parse(teamContents) as MgbaPokemon[];
    const { mask } = JSON.parse(badgesContents) as { mask: number };
    if (!Array.isArray(team) || !Number.isInteger(mask) || mask < 0 || mask >= 2 ** this.gameBadgeIds.length) {
      throw new TypeError("mGBA output is malformed");
    }
    return {
      party: team.map((pokemon) => this.normalizePokemon(pokemon)),
      badges: this.normalizeBadges(mask),
      capturedAt: new Date().toISOString(),
    };
  }

  async start(publish: (snapshot: PokemonSnapshot) => void) {
    const refresh = async () => {
      try {
        const snapshot = await this.readSnapshot();
        const serialized = JSON.stringify({ party: snapshot.party, badges: snapshot.badges });
        if (serialized === this.lastSerializedSnapshot) return;
        this.lastSerializedSnapshot = serialized;
        publish(snapshot);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
        console.error(`Could not read ${this.gameName} mGBA output`, error);
      }
    };
    await refresh();
    this.timer = setInterval(refresh, this.pollInterval);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private normalizePokemon(pokemon: MgbaPokemon): Pokemon {
    if (
      !pokemon || typeof pokemon.name !== "string"
      || !Number.isInteger(pokemon.number)
      || !Number.isInteger(pokemon.level)
      || !Number.isInteger(pokemon.hp)
      || !Number.isInteger(pokemon.maxHp)
      || !Number.isInteger(pokemon.experience)
      || (pokemon.experienceAtLevel !== undefined && (!Number.isInteger(pokemon.experienceAtLevel) || pokemon.experienceAtLevel < 0))
      || (pokemon.experienceAtNextLevel !== undefined && (!Number.isInteger(pokemon.experienceAtNextLevel) || pokemon.experienceAtNextLevel < (pokemon.experienceAtLevel ?? 0)))
      || (pokemon.isEgg !== undefined && typeof pokemon.isEgg !== "boolean")
    ) {
      throw new TypeError("mGBA party member is malformed");
    }
    return {
      id: pokemon.id ?? `${pokemon.number}:${pokemon.name.trim().toLowerCase()}`,
      nationalDexNumber: pokemon.number,
      name: pokemon.name,
      level: pokemon.level,
      hp: pokemon.hp,
      maxHp: pokemon.maxHp,
      experience: pokemon.experience,
      ...(pokemon.experienceAtLevel !== undefined ? { experienceAtLevel: pokemon.experienceAtLevel } : {}),
      ...(pokemon.experienceAtNextLevel !== undefined ? { experienceAtNextLevel: pokemon.experienceAtNextLevel } : {}),
      ...(pokemon.isEgg !== undefined ? { isEgg: pokemon.isEgg } : {}),
    };
  }

  private normalizeBadges(mask: number): BadgeProgress {
    return {
      ownedBadgeIds: this.gameBadgeIds.filter((_, index) => (mask & (1 << index)) !== 0),
    };
  }
}
