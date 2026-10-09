import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const chatManifest = {
  id: "chat",
  name: "Chat",
  description: "Live chat with avatars, appearance controls and message decay.",
  cloud: { enabledKey: "chat", pages: [{ path: "/chat/", entrypoint: "chat.html" }] },
} as const satisfies ModuleManifest;
