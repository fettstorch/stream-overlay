import type { OverlayModule } from "@streamface/sdk";
import { pokemonBlueModule } from "../../../modules/pokemon-blue/src/module.ts";
import { pokemonCrystalModule } from "../../../modules/pokemon-crystal/src/module.ts";
import { streamplacePetsModule } from "../../../modules/streamplace-pets/src/module.ts";
import { overlayPaintModule } from "../../../modules/overlay-paint/src/module.ts";
import { chatModule } from "../../../modules/chat/src/module.ts";

import { emoticonsModule } from "../../../modules/emoticons/src/module.ts";

export const modules: OverlayModule[] = [
  pokemonBlueModule,
  pokemonCrystalModule,
  streamplacePetsModule,
  overlayPaintModule,
  chatModule,
  emoticonsModule,
];

export function findModule(id: string) {
  return modules.find((module) => module.id === id);
}
