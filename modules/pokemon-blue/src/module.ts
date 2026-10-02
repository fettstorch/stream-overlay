import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

export const pokemonBlueModule: OverlayModule = {
  id: "pokemon-blue",
  name: "Pokémon Blue mGBA",
  streamerQuery: false,
  description: "Shows the live party, levels, health, experience, badges, and chat pet interactions.",
  requirements: [
    "Open Pokémon Blue in mGBA. OpenEmu cannot provide the live game data this module needs.",
    "In mGBA, open Tools → Scripting… and load scripts/mgba-team.lua from this project.",
    "Keep the scripting window open while playing. No save-file path or Lua edits are needed.",
  ],
  chatCommands: [{
    command: "!pet <Pokémon name>",
    description: "Pet an active member of the Pokémon team.",
  }],
  routes: [{
    path: "/overlays/pokemon-blue/",
    entrypoint: join(import.meta.dir, "../index.html"),
  }],
};
