import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const emoticonsManifest = {
  badges: ["commands", "overlay"],
  id: "emoticons",
  name: "Emotes",
  description:
    "Let users in chat trigger clips/gifs & stickers using !<command>. Create and live test those commands here.",
  cloud: {
    enabledKey: "emoticons",
  },
} as const satisfies ModuleManifest;
