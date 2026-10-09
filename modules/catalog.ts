import type { ModuleManifest } from "../packages/overlay-sdk/src/manifest.ts";
import { chatManifest } from "./chat/src/manifest.ts";
import { overlayPaintManifest } from "./overlay-paint/src/manifest.ts";
import { emoticonsManifest } from "./emoticons/src/manifest.ts";
import { streamplacePetsManifest } from "./streamplace-pets/src/manifest.ts";

/** Curated cloud catalog shared by the admin, static server and frontend build. */
export const cloudModuleCatalog = [
  emoticonsManifest,
  chatManifest,
  overlayPaintManifest,
  streamplacePetsManifest,
] as const satisfies readonly ModuleManifest[];
export const cloudOverlayPages = Object.fromEntries(
  cloudModuleCatalog.flatMap((module) =>
    module.cloud.pages.map((page) => [page.path, page.entrypoint]),
  ),
);
