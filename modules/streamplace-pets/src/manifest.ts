import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const streamplacePetsManifest = {
  badges: ["commands","overlay"],
  id: "streamplace-pets",
  name: "Streamplace Pets",
  description: "Chat-driven pets, configured on AT Protocol.",
  cloud: { enabledKey: "pets" },
} as const satisfies ModuleManifest;
