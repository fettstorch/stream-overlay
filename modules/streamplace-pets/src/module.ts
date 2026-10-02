import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

const projectRoot = join(import.meta.dir, "../../..");

export const streamplacePetsModule: OverlayModule = {
  id: "streamplace-pets",
  name: "Streamplace Pets",
  routes: [{
    path: "/overlays/stream-pets/",
    entrypoint: join(projectRoot, "streamplace-pets/pets.html"),
  }],
  process: {
    command: ["bun", "--port", "3000", "streamplace-pets/pets.html"],
    cwd: projectRoot,
    env: { PORT: "3000" },
  },
};
