import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

export const overlayPaintModule: OverlayModule = {
  id: "overlay-paint",
  name: "Overlay Paint",
  streamerQuery: false,
  description: "Draw over your stream with a soft brush using a mouse, pen, or touch. The whole drawing fades after four seconds without input.",
  requirements: [
    "Place the OBS Browser Source above your video and match its dimensions to your stream.",
    "Draw in the preview below. Turn drawing off temporarily to interact with the background stream player.",
  ],
  preview: { streamBackground: true, interactive: true },
  routes: [{ path: "/overlays/overlay-paint/", entrypoint: join(import.meta.dir, "../index.html") }],
};
