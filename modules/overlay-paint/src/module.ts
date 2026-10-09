import { join } from "node:path";
import type { OverlayModule } from "@streamface/sdk";
import { projectRoot } from "../../project-root.ts";
import { overlayPaintManifest } from "./manifest.ts";

export const overlayPaintModule: OverlayModule = {
  ...overlayPaintManifest,
  streamerQuery: false,
  description: "Draw over your stream with a soft brush using a mouse, pen, or touch. Choose a color and how long to wait before the whole drawing fades.",
  requirements: [
    "Place the OBS Browser Source above your video and match its dimensions to your stream.",
    "Draw in the preview below. Brush color and the delay before fading save automatically.",
  ],
  preview: { streamBackground: true, interactive: true },
  routes: [{ path: "/overlays/overlay-paint/", entrypoint: join(projectRoot, "modules/overlay-paint/index.html") }],
};
