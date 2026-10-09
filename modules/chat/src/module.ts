import { join } from "node:path";
import type { OverlayModule } from "@streamface/sdk";
import { projectRoot } from "../../project-root.ts";
import { chatManifest } from "./manifest.ts";

export const chatModule: OverlayModule = {
  ...chatManifest,
  obsSize: "stream-height",
  description: "Shows incoming Stream.place chat messages with their authors, using the shared chat service.",
  requirements: ["Select your streamer account in the Stream settings above. New messages appear live; previous chat history is not loaded."],
  streamerQuery: false,
  routes: [{ path: "/overlays/chat/", entrypoint: join(projectRoot, "modules/chat/index.html") }],
};
