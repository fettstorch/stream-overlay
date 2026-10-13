import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const customModuleManifest = {
  badges: ["overlay"],
  id: "custom-module",
  name: "Custom Module",
  description: "Design your own transparent overlay with HTML, CSS and JavaScript.",
  cloud: {
    enabledKey: "customModule",
  },
} as const satisfies ModuleManifest;
