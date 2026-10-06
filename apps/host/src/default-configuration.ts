import { modules } from "./modules.ts";
import type { HostConfiguration } from "./config-store.ts";

export const defaultHostConfiguration: HostConfiguration = {
  modules: modules.map(({ id }) => ({ id, enabled: id !== "pokemon-crystal" })),
  stream: { streamerDid: "" },
  pokemonBlue: { components: { team: true, badges: true } },
};
