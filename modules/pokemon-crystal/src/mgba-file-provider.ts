import { MgbaFileProvider } from "../../pokemon-blue/src/mgba-file-provider.ts";

// Each byte follows its region's engine badge flags, not gym visit order.
export const crystalBadgeIds = [
  "zephyr", "hive", "plain", "fog", "mineral", "storm", "glacier", "rising",
  "boulder", "cascade", "thunder", "rainbow", "soul", "marsh", "volcano", "earth",
];

export class CrystalMgbaFileProvider extends MgbaFileProvider {
  constructor(teamPath: string, badgesPath: string, pollInterval = 500) {
    super(teamPath, badgesPath, pollInterval, crystalBadgeIds, "Pokémon Crystal");
  }

  override async readSnapshot() {
    const snapshot = await super.readSnapshot();
    if (snapshot.party.length > 6 || snapshot.party.some(pokemon => (
      pokemon.nationalDexNumber < 1 || pokemon.nationalDexNumber > 251
      || pokemon.level < 1 || pokemon.level > 100
      || pokemon.experienceAtLevel === undefined || pokemon.experienceAtNextLevel === undefined
    ))) throw new TypeError("Crystal output requires valid species, levels and game-provided EXP thresholds");
    return snapshot;
  }
}
