import { expect, test, spyOn } from "bun:test";
import { StreamChatService } from "@stream-overlay/stream-chat";
import { defaultHostConfiguration } from "../src/default-configuration.ts";
import { updateSharedChat } from "../src/chat-lifecycle.ts";

test("shared Jetstream stops with its last consumer and resumes with either consumer", () => {
  const sockets: Array<{ close: () => void }> = [];
  let closes = 0;
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => {
    const socket = { addEventListener: () => {}, close: () => { closes++; } };
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const service = new StreamChatService(async did => ({ did }));
  const configuration = structuredClone(defaultHostConfiguration);
  configuration.stream.streamerDid = "did:plc:streamer";
  const enable = (id: string, enabled: boolean) => { configuration.modules.find(module => module.id === id)!.enabled = enabled; };
  try {
    enable("chat", false); enable("pokemon-blue", false);
    updateSharedChat(service, configuration);
    expect(sockets).toHaveLength(0);
    enable("chat", true); updateSharedChat(service, configuration);
    expect(sockets).toHaveLength(1);
    enable("pokemon-blue", true); updateSharedChat(service, configuration);
    expect(sockets).toHaveLength(1);
    enable("chat", false); updateSharedChat(service, configuration);
    expect(closes).toBe(0);
    enable("pokemon-blue", false); updateSharedChat(service, configuration);
    expect(closes).toBe(1);
    enable("pokemon-blue", true); updateSharedChat(service, configuration);
    expect(sockets).toHaveLength(2);
    enable("pokemon-blue", false); updateSharedChat(service, configuration);
    enable("pokemon-crystal", true); updateSharedChat(service, configuration);
    expect(sockets).toHaveLength(3);
  } finally { service.stop(); mock.mockRestore(); }
});
