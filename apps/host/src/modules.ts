import type { OverlayModule } from "@stream-overlay/sdk";
import { pokemonBlueModule } from "../../../modules/pokemon-blue/src/module.ts";
import { streamplacePetsModule } from "../../../modules/streamplace-pets/src/module.ts";

export const modules: OverlayModule[] = [
  pokemonBlueModule,
  streamplacePetsModule,
];

export function findModule(id: string) {
  return modules.find((module) => module.id === id);
}
