import { join } from "node:path";
import { projectRoot } from "../../project-root.ts";
import type { OverlayModule } from "@stream-overlay/sdk";
import { emoticonsManifest } from "./manifest.ts";
export const emoticonsModule: OverlayModule = {
  ...emoticonsManifest, streamerQuery: false,
  description: "Chat commands play your images, GIFs and sounds, one effect at a time.",
  preview: { streamBackground: true },
  requirements: ["Select your streamer account. Match the effect source to your OBS canvas dimensions.", "Add the instruction board separately; choose its width and height independently."],
  routes: [{ path: "/overlays/emoticons/", entrypoint: join(projectRoot, "modules/emoticons/index.html") },
    { path: "/overlays/emoticons/board/", entrypoint: join(projectRoot, "modules/emoticons/index.html") }],
};
