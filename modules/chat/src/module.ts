import { join } from "node:path";
import type { OverlayModule } from "@stream-overlay/sdk";

export const chatModule: OverlayModule = {
  id: "chat",
  obsSize: "stream-height",
  name: "Chat",
  description: "Shows incoming Stream.place chat messages with their authors, using the shared chat service.",
  requirements: ["Select your streamer account in the Stream settings above. New messages appear live; previous chat history is not loaded."],
  streamerQuery: false,
  routes: [{ path: "/overlays/chat/", entrypoint: join(import.meta.dir, "../index.html") }],
};
