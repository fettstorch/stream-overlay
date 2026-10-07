import type { StreamChatService } from "@stream-overlay/stream-chat";
import type { HostConfiguration } from "./config-store.ts";

/** Pets manages its own connection; our Chat, Emoticons and Pokémon modules use this one. */
export function updateSharedChat(service: Pick<StreamChatService, "setStreamerDid">, configuration: HostConfiguration) {
  const needed = ["chat", "pokemon-blue", "pokemon-crystal", "emoticons"].some(id => configuration.modules.find(module => module.id === id)?.enabled ?? (id !== "pokemon-crystal" && id !== "emoticons"));
  service.setStreamerDid(needed ? configuration.stream.streamerDid : "");
}
