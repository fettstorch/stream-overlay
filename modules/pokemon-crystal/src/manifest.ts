import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const crystalMgbaManifest = {
  badges: ["commands", "overlay", "game", "pokemon"],
  id: "pokemon-crystal-mgba",
  name: "Pokémon Crystal mGBA",
  description:
    "Show your Pokémon party, HP, EXP and badges as a live overlay. Chatters can pet your Pokémon with !pet <name>. Connect Pokémon Crystal in mGBA using your personalized Lua script.",
  cloud: {
    enabledKey: "pokemonCrystalMgba",
  },
} as const satisfies ModuleManifest;
