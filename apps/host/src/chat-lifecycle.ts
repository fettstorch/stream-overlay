import type { StreamChatService } from "@stream-overlay/stream-chat";
import type { HostConfiguration } from "./config-store.ts";

/** Pets manages its own connection; only our Chat and Pokémon modules use this one. */
export function updateSharedChat(service: Pick<StreamChatService, "setStreamerDid">, configuration: HostConfiguration) {
  const needed = ["chat", "pokemon-blue"].some(id => configuration.modules.find(module => module.id === id)?.enabled ?? true);
  service.setStreamerDid(needed ? configuration.stream.streamerDid : "");
}
