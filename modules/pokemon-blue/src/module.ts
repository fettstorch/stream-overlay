import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

export const pokemonBlueModule: OverlayModule = {
  id: "pokemon-blue",
  name: "Pokémon Blue",
  routes: [{
    path: "/overlays/pokemon-blue/",
    entrypoint: join(import.meta.dir, "../../../overlay.html"),
  }],
  process: {
    command: ["bun", "--port", "3002", "overlay.html"],
    cwd: join(import.meta.dir, "../../.."),
    env: { PORT: "3002" },
  },
};
