import type { OverlayModule } from "@streamface/sdk";
import { projectRoot } from "../../project-root.ts";

export const pokemonCrystalModule: OverlayModule = {
  id: "pokemon-crystal",
  name: "Pokémon Crystal mGBA",
  streamerQuery: false,
  description: "Live Crystal team, levels, HP, EXP, Johto and Kanto badges, and chat petting.",
  requirements: [
    "Open English Pokémon Crystal (USA/Europe Rev 1) in mGBA 0.10+. Other versions and ROM hacks are not supported by this reader.",
    "Start the overlay, then load scripts/mgba-crystal.lua from this project in mGBA Tools → Scripting. Keep the scripting window open.",
    "No ROM/save paths or Lua edits needed. Disable the Blue module when playing Crystal to avoid petting both teams.",
  ],
  chatCommands: [{ command: "!pet <Pokémon name>", description: "Pet an active team member using the nickname displayed in the overlay." }],
  routes: [{ path: "/overlays/pokemon-crystal/", entrypoint: `${projectRoot}/modules/pokemon-crystal/index.html` }],
};
