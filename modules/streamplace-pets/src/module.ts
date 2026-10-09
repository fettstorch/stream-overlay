import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

import { projectRoot } from "../../project-root.ts";
import { streamplacePetsManifest } from "./manifest.ts";

export const streamplacePetsModule: OverlayModule = {
  ...streamplacePetsManifest,
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
    cwd: join(projectRoot, "modules/streamplace-pets"),
    env: { PORT: "3000" },
  },
};
