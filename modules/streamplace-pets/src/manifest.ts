import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const streamplacePetsManifest = {
  id: "streamplace-pets",
  name: "Streamplace Pets",
  description: "Chat-driven pets, configured on AT Protocol.",
  cloud: { enabledKey: "pets", pages: [{ path: "/pets/", entrypoint: "pets.html" }] },
} as const satisfies ModuleManifest;
