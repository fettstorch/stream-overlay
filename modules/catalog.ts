import type { ModuleManifest } from "../packages/overlay-sdk/src/manifest.ts";
import { chatManifest } from "./chat/src/manifest.ts";
import { botManifest } from "./bot/src/manifest.ts";
import { overlayPaintManifest } from "./overlay-paint/src/manifest.ts";
import { emoticonsManifest } from "./emoticons/src/manifest.ts";
import { streamplacePetsManifest } from "./streamplace-pets/src/manifest.ts";

/** Curated cloud catalog shared by the admin, static server and frontend build. */
const availableCloudModules = [
  emoticonsManifest,
  chatManifest,
  botManifest,
  overlayPaintManifest,
  streamplacePetsManifest,
] as const satisfies readonly ModuleManifest[];

/** Pets is opt-in until upstream grants hosted redistribution permission. */
export function getCloudModuleCatalog(enablePets = false) {
  return availableCloudModules.filter((module) => enablePets || module.id !== "streamplace-pets");
}
export const cloudModuleCatalog = getCloudModuleCatalog();
export function getCloudOverlayPages(enablePets = false) {
  return Object.fromEntries(
    getCloudModuleCatalog(enablePets).flatMap((module) =>
      module.cloud.pages.map((page) => [page.path, page.entrypoint]),
    ),
  );
}
export const cloudOverlayPages = getCloudOverlayPages();
