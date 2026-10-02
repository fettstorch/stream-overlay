import type { OverlayModule } from "@stream-overlay/sdk";
import { pokemonBlueModule } from "../../../modules/pokemon-blue/src/module.ts";
import { streamplacePetsModule } from "../../../modules/streamplace-pets/src/module.ts";
import { overlayPaintModule } from "../../../modules/overlay-paint/src/module.ts";
import { chatModule } from "../../../modules/chat/src/module.ts";

export const modules: OverlayModule[] = [
  pokemonBlueModule,
  streamplacePetsModule,
  overlayPaintModule,
  chatModule,
];

export function findModule(id: string) {
  return modules.find((module) => module.id === id);
}
