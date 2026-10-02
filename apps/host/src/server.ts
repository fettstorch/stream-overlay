import { join } from "node:path";
import { ConfigStore } from "./config-store.ts";
import { findModule, modules } from "./modules.ts";
import { ModuleSupervisor } from "./module-supervisor.ts";
import type { PokemonSnapshot } from "@stream-overlay/pokemon-model";
import { MgbaFileProvider } from "../../../modules/pokemon-blue/src/mgba-file-provider.ts";

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
const pokemonProvider = new MgbaFileProvider(
  join(projectRoot, "team.json"),
  join(projectRoot, "badges.json"),
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
    enabled: isEnabled(module.id),
    status: runtime.status,
    overlayUrl: module.routes[0]?.path ?? "",
    error: runtime.error,
  };
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
    "/team.json": (request) => proxyPokemonOverlay(request),
    "/badges.json": (request) => proxyPokemonOverlay(request),
    "/overlays/stream-pets/": (request) => {
      if (!isEnabled("streamplace-pets")) return transparentPage.clone();
      const query = new URL(request.url).search;
      return Response.redirect(`http://localhost:3000/pets.html${query}`, 302);
    },
    "/api/modules": () => Response.json(modules.map(moduleResponse)),
    "/api/config": {
      GET: () => Response.json(configStore.read().stream),
      PATCH: async (request) => {
        const body = await request.json() as { streamerDid?: unknown };
        if (!body || typeof body.streamerDid !== "string") {
          return Response.json({ error: "Invalid stream configuration" }, { status: 400 });
        }
        const configuration = configStore.read();
        configuration.stream = { streamerDid: body.streamerDid };
        configStore.write(configuration);
        return Response.json(configuration.stream);
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

for (const module of modules) {
  if (isEnabled(module.id)) supervisor.enable(module);
}
await pokemonProvider.start((snapshot) => {
  pokemonSnapshot = snapshot;
});

const shutDown = () => {
  supervisor.stopAll(modules);
  void pokemonProvider.stop();
  void server.stop();
};
process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);

console.log(`Overlay host available at ${server.url}`);
