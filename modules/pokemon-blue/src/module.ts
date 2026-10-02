import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

export const pokemonBlueModule: OverlayModule = {
  id: "pokemon-blue",
  name: "Pokémon Blue",
  description: "Shows the live party, levels, health, experience, badges, and chat pet interactions.",
  requirements: [
    "Pokémon Blue must be running in mGBA; OpenEmu does not provide the Lua interface this module uses.",
    "Load scripts/mgba-team.lua from mGBA's Tools → Scripting window and keep it running.",
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
