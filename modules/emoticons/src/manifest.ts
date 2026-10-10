import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const emoticonsManifest = {
  id: "emoticons",
  name: "Emotes",
  description:
    "Let users in chat trigger clips/gifs & stickers using !<command>. Create and live test those commands here.",
  cloud: {
    enabledKey: "emoticons",
    pages: [
      { path: "/emotes/", entrypoint: "effect.html" },
      { path: "/emote-listings/", entrypoint: "board.html" },
      // Retain existing OBS browser sources without a redirect or URL migration.
      { path: "/effect/", entrypoint: "effect.html" },
      { path: "/board/", entrypoint: "board.html" },
    ],
  },
} as const satisfies ModuleManifest;
