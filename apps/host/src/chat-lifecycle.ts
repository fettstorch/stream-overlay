import type { StreamChatService } from "@stream-overlay/stream-chat";
import type { HostConfiguration } from "./config-store.ts";

/** Jetstream remains available for consumers that need AT Protocol events. */
export function updateSharedChat(service: Pick<StreamChatService, "setStreamerDid">, configuration: HostConfiguration, consumerIds: readonly string[] = []) {
  const needed = consumerIds.some(id => configuration.modules.find(module => module.id === id)?.enabled ?? false);
  service.setStreamerDid(needed ? configuration.stream.streamerDid : "");
}

export function updateDirectChat(service: Pick<StreamChatService, "setStreamerDid">, configuration: HostConfiguration) {
  const needed = ["chat", "pokemon-blue", "pokemon-crystal", "emoticons"].some(id => configuration.modules.find(module => module.id === id)?.enabled ?? (id === "chat" || id === "pokemon-blue"));
  service.setStreamerDid(needed ? configuration.stream.streamerDid : "");
}
