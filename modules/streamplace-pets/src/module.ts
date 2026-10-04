import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

const projectRoot = join(import.meta.dir, "../../..");

export const streamplacePetsModule: OverlayModule = {
  id: "streamplace-pets",
  name: "Streamplace Pets",
  description: "Runs the independent Streamplace Pets overlay from its upstream submodule.",
  configurationLink: {
    url: "https://rpg.actor/streampets",
    label: "Configure Stream Pets on rpg.actor ↗",
    description: "Sign in with your streamer account on rpg.actor to access Stream Pets settings. This opens an external site in a new tab.",
  },
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
