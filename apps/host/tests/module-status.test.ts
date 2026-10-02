import { expect, test } from "bun:test";
import { ModuleStatusService } from "../src/module-status.ts";

async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunk = await reader.read();
  return JSON.parse(new TextDecoder().decode(chunk.value).slice(6));
}

test("configuration changes share the control channel and survive reconnects", async () => {
  const service = new ModuleStatusService(new Map([["chat", true]]));
  service.setConfiguration("chat", { fadeOut: 0 });
  const request = () => new Request("http://localhost/events");
  const reader = service.events(request(), "chat").body!.getReader();
  try {
    expect(await read(reader)).toEqual({ enabled: true, configuration: { fadeOut: 0 } });
    service.setConfiguration("chat", { fadeOut: 80 });
    expect(await read(reader)).toEqual({ enabled: true, configuration: { fadeOut: 80 } });
  } finally { await reader.cancel(); }
  const reconnected = service.events(request(), "chat").body!.getReader();
  try { expect(await read(reconnected)).toEqual({ enabled: true, configuration: { fadeOut: 80 } }); }
  finally { await reconnected.cancel(); }
});

test("status streams deliver initial state, live changes, and current state after reconnect", async () => {
  const service = new ModuleStatusService(new Map([["pokemon-blue", false]]));
  const request = () => new Request("http://localhost/api/modules/pokemon-blue/events");
  const first = service.events(request(), "pokemon-blue").body!.getReader();
  const second = service.events(request(), "pokemon-blue").body!.getReader();
  try {
    expect(await read(first)).toEqual({ enabled: false });
    expect(await read(second)).toEqual({ enabled: false });
    service.setEnabled("pokemon-blue", true);
    expect(await read(first)).toEqual({ enabled: true });
    expect(await read(second)).toEqual({ enabled: true });
    service.setEnabled("overlay-paint", false);
    service.setEnabled("pokemon-blue", false);
    expect(await read(first)).toEqual({ enabled: false });
    expect(await read(second)).toEqual({ enabled: false });
  } finally { await first.cancel(); await second.cancel(); }
  service.setEnabled("pokemon-blue", true);
  const reconnected = service.events(request(), "pokemon-blue").body!.getReader();
  try { expect(await read(reconnected)).toEqual({ enabled: true }); }
  finally { await reconnected.cancel(); }
});

test("aborting a status client closes it without affecting later subscribers", async () => {
  const service = new ModuleStatusService(new Map([["pokemon-blue", true]]));
  const controller = new AbortController();
  const reader = service.events(new Request("http://localhost/events", { signal: controller.signal }), "pokemon-blue").body!.getReader();
  await read(reader);
  controller.abort();
  expect((await reader.read()).done).toBe(true);
  service.setEnabled("pokemon-blue", false);
});

test("Bun keeps the status channel open beyond its default idle timeout", async () => {
  const service = new ModuleStatusService(new Map([["pokemon-blue", false]]));
  // Isolated ephemeral test port; never occupy any of the user's overlay ports.
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request, server) => {
    server.timeout(request, 0);
    return service.events(request, "pokemon-blue");
  } });
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(server.url, { signal: abort.signal });
    reader = response.body!.getReader();
    expect(await read(reader)).toEqual({ enabled: false });
    await Bun.sleep(11_000);
    service.setEnabled("pokemon-blue", true);
    expect(await read(reader)).toEqual({ enabled: true });
  } finally {
    await reader?.cancel();
    abort.abort();
    server.stop(true);
  }
}, 15_000);
