import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const emoticonsManifest = {
  id: "emoticons",
  name: "Emoticons",
  description: "Trigger clips and stickers from stream chat.",
  cloud: {
    enabledKey: "emoticons",
    pages: [
      { path: "/effect/", entrypoint: "effect.html" },
      { path: "/board/", entrypoint: "board.html" },
    ],
  },
} as const satisfies ModuleManifest;
