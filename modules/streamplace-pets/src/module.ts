import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

const projectRoot = join(import.meta.dir, "../../..");

export const streamplacePetsModule: OverlayModule = {
  id: "streamplace-pets",
  name: "Streamplace Pets",
  description: "Runs the independent Streamplace Pets overlay from its upstream submodule.",
  requirements: [
    "The streamplace-pets Git submodule must be initialized.",
  ],
  routes: [{
    path: "/overlays/stream-pets/",
    entrypoint: join(projectRoot, "streamplace-pets/pets.html"),
  }],
  process: {
    command: ["bun", "--no-orphans", "src/server.ts"],
    cwd: join(import.meta.dir, ".."),
    env: { PORT: "3000" },
  },
};
