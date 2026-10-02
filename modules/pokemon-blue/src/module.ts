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
    command: ["bun", "run", "dev", "--", "--host", "127.0.0.1", "--port", "3002"],
    cwd: join(import.meta.dir, ".."),
    env: { PORT: "3002" },
  },
};
