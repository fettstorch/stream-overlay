import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const overlayPaintManifest = {
  badges: ["overlay"],
  id: "overlay-paint",
  name: "Overlay Paint",
  description: "Draw over your stream with a shared brush and fading strokes.",
  cloud: {
    enabledKey: "paint",
    interactivePreview: true,
  },
} as const satisfies ModuleManifest;
