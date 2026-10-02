import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { ConfigStore } from "./config-store.ts";
import { findModule, modules } from "./modules.ts";
import { ModuleSupervisor } from "./module-supervisor.ts";
import type { PokemonSnapshot } from "@stream-overlay/pokemon-model";
import { MgbaFileProvider } from "../../../modules/pokemon-blue/src/mgba-file-provider.ts";
import { getActorProfile, resolveStreamerIdentity, searchActors } from "./identity.ts";
import { StreamChatService } from "@stream-overlay/stream-chat";
import { FileLogger } from "./logger.ts";
import { PaintService, parseSegments } from "../../../modules/overlay-paint/src/service.ts";
import { getStreamDimensions } from "./stream-dimensions.ts";
import { defaultPaintConfiguration, parsePaintConfiguration } from "../../../modules/overlay-paint/src/config.ts";

const projectRoot = join(import.meta.dir, "../../..");
const port = Number(process.env.PORT ?? 3001);
const defaults = {
  modules: modules.map(({ id }) => ({ id, enabled: true })),
  stream: { streamerDid: "" },
  pokemonBlue: {
    components: { team: true, badges: true },
  },
};
const configStore = new ConfigStore(join(projectRoot, "runtime/config.json"), defaults);
const logger = new FileLogger(join(tmpdir(), "stream-overlay", "overlay.log"));
const supervisor = new ModuleSupervisor((event, details) => logger.log(event, details));
const chatService = new StreamChatService(getActorProfile, (event, details) => logger.log(event, details));
const paintService = new PaintService();
paintService.configure(configStore.read().overlayPaint ?? defaultPaintConfiguration);
// Bundle the canvas client in memory: no extra development server or port.
const paintBundle = await Bun.build({
  entrypoints: [join(projectRoot, "modules/overlay-paint/src/client.ts")],
  target: "browser",
  minify: true,
});
if (!paintBundle.success) throw new AggregateError(paintBundle.logs, "Could not build Overlay Paint");
const paintJavascript = await paintBundle.outputs[0]!.text();
const pokemonRuntimeDirectory = join(projectRoot, "runtime/pokemon-blue");
mkdirSync(pokemonRuntimeDirectory, { recursive: true });
const pokemonProvider = new MgbaFileProvider(
  join(pokemonRuntimeDirectory, "team.json"),
  join(pokemonRuntimeDirectory, "badges.json"),
);
let pokemonSnapshot: PokemonSnapshot | null = null;

function isEnabled(id: string) {
  return configStore.read().modules.find((module) => module.id === id)?.enabled
    ?? defaults.modules.find((module) => module.id === id)?.enabled ?? false;
}

function moduleResponse(module: (typeof modules)[number]) {
  const runtime = supervisor.status(module);
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    requirements: module.requirements ?? [],
    chatCommands: module.chatCommands ?? [],
    preview: module.preview,
    streamerQuery: module.streamerQuery ?? true,
    enabled: isEnabled(module.id),
    status: runtime.status,
    overlayUrl: module.routes[0]?.path ?? "",
    error: runtime.error,
  };
}

async function streamConfigurationResponse() {
  const stream = configStore.read().stream;
  if (!stream.streamerDid) return { ...stream, profile: null };
  try {
    return { ...stream, profile: await getActorProfile(stream.streamerDid) };
  } catch {
    return { ...stream, profile: null };
  }
}

function streamChatEvents(request: Request) {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      logger.log("chat.client-connected");
      const encoder = new TextEncoder();
      const close = () => {
        unsubscribe?.();
        unsubscribe = undefined;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        try { controller.close(); } catch { /* Already closed by the browser. */ }
        logger.log("chat.client-disconnected");
      };
      unsubscribe = chatService.messages.subscribe((message) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
          logger.log("chat.message-sent-to-client", { id: message.id });
        } catch {
          close();
        }
      });
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { close(); }
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

const transparentPage = new Response("<!doctype html><body style='margin:0;background:transparent'></body>", {
  headers: { "Content-Type": "text/html; charset=utf-8" },
});

function proxyPokemonOverlay(request: Request, path = new URL(request.url).pathname) {
  if (!isEnabled("pokemon-blue")) return transparentPage.clone();
  const source = new URL(request.url);
  source.protocol = "http:";
  source.hostname = "localhost";
  source.port = "3002";
  source.pathname = path;
  return fetch(source, request);
}

function proxyAdmin(request: Request) {
  const source = new URL(request.url);
  source.protocol = "http:";
  source.hostname = "localhost";
  source.port = "3003";
  return fetch(source, request);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: true,
  routes: {
    "/": (request) => proxyPokemonOverlay(request, "/"),
    "/overlay.html": (request) => proxyPokemonOverlay(request, "/overlay.html"),
    "/overlays/pokemon-blue/": (request) => proxyPokemonOverlay(request, "/"),
    "/overlays/overlay-paint": (request) => {
      const url = new URL(request.url);
      url.pathname += "/";
      return Response.redirect(url, 302);
    },
    "/overlays/overlay-paint/": () => new Response(Bun.file(join(projectRoot, "modules/overlay-paint/index.html")), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    }),
    "/overlays/overlay-paint/client.js": () => new Response(paintJavascript, {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
    }),
    "/overlays/overlay-paint/pencil-cursor.svg": () => new Response(Bun.file(join(projectRoot, "modules/overlay-paint/assets/pencil-cursor.svg")), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    }),
    "/api/overlay-paint/events": (request, server) => {
      server.timeout(request, 0);
      return paintService.events(request);
    },
    "/api/overlay-paint/segments": {
      POST: async request => {
        if (!isEnabled("overlay-paint")) return Response.json({ error: "Paint module disabled" }, { status: 409 });
        let body: { segments?: unknown };
        try { body = await request.json(); } catch {
          return Response.json({ error: "Invalid paint input" }, { status: 400 });
        }
        const segments = parseSegments(body?.segments);
        if (!segments) return Response.json({ error: "Invalid paint input" }, { status: 400 });
        paintService.append(segments);
        return new Response(null, { status: 204 });
      },
    },
    "/api/overlay-paint/config": {
      GET: () => Response.json(configStore.read().overlayPaint ?? defaultPaintConfiguration),
      PATCH: async request => {
        let body: unknown;
        try { body = await request.json(); } catch {
          return Response.json({ error: "Invalid Paint configuration" }, { status: 400 });
        }
        const paint = parsePaintConfiguration(body);
        if (!paint) return Response.json({ error: "Choose a color and a delay from 0.1 to 60 seconds" }, { status: 400 });
        const configuration = configStore.read();
        configuration.overlayPaint = paint;
        configStore.write(configuration);
        paintService.configure(paint);
        return Response.json(paint);
      },
    },
    "/team.json": (request) => proxyPokemonOverlay(request),
    "/badges.json": (request) => proxyPokemonOverlay(request),
    "/overlays/stream-pets/": (request) => {
      if (!isEnabled("streamplace-pets")) return transparentPage.clone();
      const query = new URL(request.url).search;
      return Response.redirect(`http://localhost:3000/pets.html${query}`, 302);
    },
    "/api/modules": () => Response.json(modules.map(moduleResponse)),
    "/api/stream/dimensions": async () => {
      const streamerDid = configStore.read().stream.streamerDid;
      try {
        const dimensions = await getStreamDimensions(streamerDid);
        return Response.json({ streamerDid, dimensions }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        logger.log("stream.dimensions-unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return Response.json({ streamerDid, dimensions: null }, { headers: { "Cache-Control": "no-store" } });
      }
    },
    "/api/config": {
      GET: async () => Response.json(await streamConfigurationResponse()),
      PATCH: async (request) => {
        const body = await request.json() as { streamerDid?: unknown };
        if (!body || typeof body.streamerDid !== "string") {
          return Response.json({ error: "Invalid stream configuration" }, { status: 400 });
        }
        let streamerDid: string;
        try {
          streamerDid = await resolveStreamerIdentity(body.streamerDid);
        } catch (error) {
          return Response.json({
            error: error instanceof Error ? error.message : "Could not resolve streamer identity",
          }, { status: 400 });
        }
        let profile;
        try {
          profile = await getActorProfile(streamerDid);
        } catch (error) {
          return Response.json({
            error: error instanceof Error ? error.message : "Could not load streamer profile",
          }, { status: 400 });
        }
        const configuration = configStore.read();
        configuration.stream = { streamerDid: profile.did };
        configStore.write(configuration);
        chatService.setStreamerDid(profile.did);
        return Response.json({ ...configuration.stream, profile });
      },
    },
    "/api/actors/search": async (request) => {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      try {
        return Response.json({ actors: await searchActors(query) });
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : "Could not search Bluesky profiles",
        }, { status: 502 });
      }
    },
    "/api/chat/events": (request, server) => {
      // Chat can remain quiet longer than Bun's default HTTP idle timeout.
      server.timeout(request, 0);
      return streamChatEvents(request);
    },
    "/api/diagnostics": {
      POST: async (request) => {
        const body = await request.json() as { event?: unknown; details?: unknown };
        if (typeof body.event !== "string" || !body.event.startsWith("pokemon.")) {
          return Response.json({ error: "Invalid diagnostic event" }, { status: 400 });
        }
        const details = body.details && typeof body.details === "object"
          ? body.details as Record<string, unknown>
          : {};
        logger.log(body.event, details);
        return new Response(null, { status: 204 });
      },
    },
    "/api/pokemon-blue/snapshot": () => pokemonSnapshot
      ? Response.json(pokemonSnapshot, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Pokémon data is unavailable" }, { status: 503 }),
    "/api/pokemon-blue/config": {
      GET: () => Response.json(configStore.read().pokemonBlue),
      PATCH: async (request) => {
        const body = await request.json() as unknown;
        if (
          !body || typeof body !== "object"
          || typeof (body as typeof defaults.pokemonBlue).components?.team !== "boolean"
          || typeof (body as typeof defaults.pokemonBlue).components?.badges !== "boolean"
        ) {
          return Response.json({ error: "Invalid Pokémon Blue configuration" }, { status: 400 });
        }
        const configuration = configStore.read();
        configuration.pokemonBlue = body as typeof defaults.pokemonBlue;
        configStore.write(configuration);
        return Response.json(configuration.pokemonBlue);
      },
    },
    "/api/modules/:id": {
      PATCH: async (request) => {
        const module = findModule(request.params.id);
        if (!module) return Response.json({ error: "Unknown module" }, { status: 404 });
        const body = await request.json() as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") {
          return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
        }
        configStore.setModuleEnabled(module.id, body.enabled);
        if (module.id === "overlay-paint") paintService.setEnabled(body.enabled);
        if (body.enabled) supervisor.enable(module);
        else supervisor.disable(module);
        return Response.json(moduleResponse(module));
      },
    },
    "/admin": (request) => Response.redirect(new URL("/admin/", request.url), 302),
    "/admin/": (request) => proxyAdmin(request),
    "/admin/*": (request) => proxyAdmin(request),
  },
  fetch: (request) => proxyPokemonOverlay(request),
});

logger.log("host.started", { port, logPath: logger.path });

for (const module of modules) {
  if (isEnabled(module.id)) supervisor.enable(module);
}
chatService.setStreamerDid(configStore.read().stream.streamerDid);
paintService.setEnabled(isEnabled("overlay-paint"));
await pokemonProvider.start((snapshot) => {
  pokemonSnapshot = snapshot;
});

const shutDown = () => {
  logger.log("host.stopping");
  supervisor.stopAll(modules);
  chatService.stop();
  paintService.stop();
  void pokemonProvider.stop();
  void server.stop();
};
process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);

console.log(`Overlay host available at ${server.url}`);
console.log(`Overlay log available at ${logger.path}`);
