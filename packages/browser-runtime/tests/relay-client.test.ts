import { expect, spyOn, test } from "bun:test";
import { RelayClient } from "../src/index.ts";

type Timer = { callback: () => void; delay: number };

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send(value: string) { this.sent.push(value); }
  close() {}
  open() { this.onopen?.(new Event("open")); }
  message(value: unknown) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) })); }
  disconnect(code: number) { this.onclose?.({ code } as CloseEvent); }
}

test("backs off rejected handshakes and resets after server acceptance", () => {
  const sockets: FakeSocket[] = [];
  const timers: Timer[] = [];
  const websocketMock = spyOn(globalThis, "WebSocket").mockImplementation(() => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  const timeoutMock = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
    timers.push({ callback, delay: Number(delay) });
    return timers.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  const clearTimeoutMock = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});

  const client = new RelayClient("ws://relay.test", { type: "hello", did: "did:plc:a", page: "effect", channel: "preview" }, () => {});
  try {
    sockets[0]!.open(); sockets[0]!.disconnect(1008);
    expect(timers.at(-1)?.delay).toBe(500);
    timers.at(-1)!.callback();
    sockets[1]!.open(); sockets[1]!.disconnect(1008);
    expect(timers.at(-1)?.delay).toBe(1000);
    timers.at(-1)!.callback();
    sockets[2]!.open();
    sockets[2]!.message({ type: "snapshot", did: "did:plc:a", channel: "preview", revision: 0, cooldowns: {} });
    sockets[2]!.disconnect(1008);
    expect(timers.at(-1)?.delay).toBe(500);
  } finally {
    client.close();
    clearTimeoutMock.mockRestore();
    timeoutMock.mockRestore();
    websocketMock.mockRestore();
  }
});
