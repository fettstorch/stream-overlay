import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const chatManifest = {
  badges: ["overlay"],
  id: "chat",
  name: "Chat",
  description: "Live chat with avatars, appearance controls and message decay.",
  cloud: { enabledKey: "chat" },
} as const satisfies ModuleManifest;
