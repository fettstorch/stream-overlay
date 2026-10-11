import type { ModuleManifest } from "../../../packages/overlay-sdk/src/manifest.ts";
export const customModuleManifest = {
  badges: ["overlay"],
  id: "custom-module",
  name: "Custom Module",
  description: "Design your own transparent overlay with HTML and CSS. No JavaScript.",
  cloud: {
    enabledKey: "customModule",
    pages: [
      { path: "/custom-module/", entrypoint: "custom-module.html" },
      // Preserve existing OBS sources while the retired singleton is migrated.
      { path: "/living-room/", entrypoint: "custom-module.html" },
    ],
  },
} as const satisfies ModuleManifest;
