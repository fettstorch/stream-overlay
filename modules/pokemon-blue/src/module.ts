import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

export const pokemonBlueModule: OverlayModule = {
  id: "pokemon-blue",
  name: "Pokémon Blue",
  description: "Shows the live party, levels, health, experience, badges, and chat pet interactions. Viewers can pet an active team member with !pet <Pokémon name>.",
  requirements: [
    "Open Pokémon Blue in mGBA. OpenEmu cannot provide the live game data this module needs.",
    "In mGBA, open Tools → Scripting… and load scripts/mgba-team.lua from this project.",
    "Keep the scripting window open while playing. No save-file path or Lua edits are needed.",
  ],
  routes: [{
    path: "/overlays/pokemon-blue/",
    entrypoint: join(import.meta.dir, "../../../overlay.html"),
  }],
  process: {
    command: ["bun", "--no-orphans", "run", "dev", "--", "--host", "127.0.0.1", "--port", "3002"],
    cwd: join(import.meta.dir, ".."),
    env: { PORT: "3002" },
  },
};
