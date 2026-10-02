import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { ConfigStore } from "./config-store.ts";
import { findModule, modules } from "./modules.ts";
import { ModuleSupervisor } from "./module-supervisor.ts";
import type { PokemonSnapshot } from "@stream-overlay/pokemon-model";
import { MgbaFileProvider } from "../../../modules/pokemon-blue/src/mgba-file-provider.ts";
import { getActorProfile, resolveStreamerIdentity, searchActors } from "./identity.ts";
import { StreamChatService } from "@stream-overlay/stream-chat";

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
const supervisor = new ModuleSupervisor();
const chatService = new StreamChatService(getActorProfile);
const moduleStateListeners = new Set<(id: string, enabled: boolean) => void>();
const pokemonRuntimeDirectory = join(projectRoot, "runtime/pokemon-blue");
mkdirSync(pokemonRuntimeDirectory, { recursive: true });
const pokemonProvider = new MgbaFileProvider(
  join(pokemonRuntimeDirectory, "team.json"),
  join(pokemonRuntimeDirectory, "badges.json"),
);
let pokemonSnapshot: PokemonSnapshot | null = null;

function isEnabled(id: string) {
  return configStore.read().modules.find((module) => module.id === id)?.enabled ?? false;
}

function moduleResponse(module: (typeof modules)[number]) {
  const runtime = supervisor.status(module);
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    requirements: module.requirements ?? [],
    chatCommands: module.chatCommands ?? [],
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
      const encoder = new TextEncoder();
      const close = () => {
        unsubscribe?.();
        unsubscribe = undefined;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        try { controller.close(); } catch { /* Already closed by the browser. */ }
      };
      unsubscribe = chatService.messages.subscribe((message) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
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

function escapeHtmlAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function overlayShell(moduleId: string, sourceUrl: string) {
  const enabled = isEnabled(moduleId);
  return new Response(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>html,body,iframe{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;border:0}iframe[hidden]{display:none}</style>
  </head>
  <body>
    <iframe data-source="${escapeHtmlAttribute(sourceUrl)}"${enabled ? ` src="${escapeHtmlAttribute(sourceUrl)}"` : " hidden"}></iframe>
    <script>
      const frame = document.querySelector("iframe");
      let enableTimer;
      function setEnabled(enabled) {
        clearTimeout(enableTimer);
        if (!enabled) {
          frame.hidden = true;
          frame.src = "about:blank";
          return;
        }
        enableTimer = setTimeout(() => {
          frame.src = frame.dataset.source;
          frame.hidden = false;
        }, 250);
      }
      const events = new EventSource("/api/module-events");
      events.onmessage = ({ data }) => {
        const state = JSON.parse(data);
        if (state.id === ${JSON.stringify(moduleId)}) setEnabled(state.enabled);
      };
    </script>
  </body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function moduleStateEvents(request: Request) {
  let listener: ((id: string, enabled: boolean) => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (id: string, enabled: boolean) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, enabled })}\n\n`)); } catch { close(); }
      };
      const close = () => {
        if (listener) moduleStateListeners.delete(listener);
        listener = undefined;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        try { controller.close(); } catch { /* Already closed by the browser. */ }
      };
      listener = send;
      moduleStateListeners.add(listener);
      for (const module of modules) send(module.id, isEnabled(module.id));
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { close(); }
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      if (listener) moduleStateListeners.delete(listener);
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

function publishModuleState(id: string, enabled: boolean) {
  for (const listener of moduleStateListeners) listener(id, enabled);
}

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
    "/": (request) => overlayShell("pokemon-blue", `/internal/pokemon-blue/${new URL(request.url).search}`),
    "/overlay.html": (request) => overlayShell("pokemon-blue", `/internal/pokemon-blue/${new URL(request.url).search}`),
    "/overlays/pokemon-blue/": (request) => overlayShell("pokemon-blue", `/internal/pokemon-blue/${new URL(request.url).search}`),
    "/internal/pokemon-blue/": (request) => proxyPokemonOverlay(request, "/"),
    "/team.json": (request) => proxyPokemonOverlay(request),
    "/badges.json": (request) => proxyPokemonOverlay(request),
    "/overlays/stream-pets/": (request) => overlayShell(
      "streamplace-pets",
      `http://127.0.0.1:3000/pets.html${new URL(request.url).search}`,
    ),
    "/api/modules": () => Response.json(modules.map(moduleResponse)),
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
    "/api/chat/events": (request) => streamChatEvents(request),
    "/api/module-events": (request) => moduleStateEvents(request),
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
        if (body.enabled) {
          supervisor.enable(module);
          publishModuleState(module.id, true);
        } else {
          // Let OBS clear the module's last rendered frame before its server disappears.
          publishModuleState(module.id, false);
          await Bun.sleep(100);
          if (!isEnabled(module.id)) supervisor.disable(module);
        }
        return Response.json(moduleResponse(module));
      },
    },
    "/admin": (request) => Response.redirect(new URL("/admin/", request.url), 302),
    "/admin/": (request) => proxyAdmin(request),
    "/admin/*": (request) => proxyAdmin(request),
  },
  fetch: (request) => proxyPokemonOverlay(request),
});

for (const module of modules) {
  if (isEnabled(module.id)) supervisor.enable(module);
}
chatService.setStreamerDid(configStore.read().stream.streamerDid);
await pokemonProvider.start((snapshot) => {
  pokemonSnapshot = snapshot;
});

const shutDown = () => {
  supervisor.stopAll(modules);
  chatService.stop();
  void pokemonProvider.stop();
  void server.stop();
};
process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);

console.log(`Overlay host available at ${server.url}`);
