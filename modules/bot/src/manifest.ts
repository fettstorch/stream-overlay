import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const botManifest = {
  id: "bot",
  name: "Bot",
  description:
    "Map chat commands to replies from Streamface. Keep the transparent Bot browser source running in OBS.",
  cloud: { enabledKey: "bot", pages: [{ path: "/bot/", entrypoint: "bot.html" }] },
} as const satisfies ModuleManifest;
