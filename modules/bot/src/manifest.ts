import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const botManifest = {
  badges: ["commands"],
  id: "bot",
  name: "Bot",
  description:
    "Map chat commands to replies from Streamface. Keep your shared overlay running in OBS.",
  cloud: { enabledKey: "bot" },
} as const satisfies ModuleManifest;
