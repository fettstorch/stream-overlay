import { expect, test, spyOn } from "bun:test";
import { DirectStreamChatService } from "@stream-overlay/stream-chat";
import { defaultHostConfiguration } from "../src/default-configuration.ts";
import { updateDirectChat } from "../src/chat-lifecycle.ts";

test("direct chat stops with its last consumer and resumes with either consumer", () => {
  const sockets: Array<{ close: () => void }> = [];
  let closes = 0;
  const mock = spyOn(globalThis, "WebSocket").mockImplementation(() => {
    const socket = { addEventListener: () => {}, close: () => { closes++; } };
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const service = new DirectStreamChatService();
  const configuration = structuredClone(defaultHostConfiguration);
  configuration.stream.streamerDid = "did:plc:streamer";
  const enable = (id: string, enabled: boolean) => { configuration.modules.find(module => module.id === id)!.enabled = enabled; };
  try {
    enable("chat", false); enable("pokemon-blue", false);
    updateDirectChat(service, configuration);
    expect(sockets).toHaveLength(0);
    enable("chat", true); updateDirectChat(service, configuration);
    expect(sockets).toHaveLength(1);
    enable("pokemon-blue", true); updateDirectChat(service, configuration);
    expect(sockets).toHaveLength(1);
    enable("chat", false); updateDirectChat(service, configuration);
    expect(closes).toBe(0);
    enable("pokemon-blue", false); updateDirectChat(service, configuration);
    expect(closes).toBe(1);
    enable("pokemon-blue", true); updateDirectChat(service, configuration);
    expect(sockets).toHaveLength(2);
    enable("pokemon-blue", false); updateDirectChat(service, configuration);
    enable("pokemon-crystal", true); updateDirectChat(service, configuration);
    expect(sockets).toHaveLength(3);
  } finally { service.stop(); mock.mockRestore(); }
});
