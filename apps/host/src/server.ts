import { join } from "node:path";
import { ConfigStore } from "./config-store.ts";
import { findModule, modules } from "./modules.ts";
import { ModuleSupervisor } from "./module-supervisor.ts";

const projectRoot = join(import.meta.dir, "../../..");
const port = Number(process.env.PORT ?? 3001);
const defaults = {
  modules: modules.map(({ id }) => ({ id, enabled: true })),
};
const configStore = new ConfigStore(join(projectRoot, "runtime/config.json"), defaults);
const supervisor = new ModuleSupervisor();

function isEnabled(id: string) {
  return configStore.read().modules.find((module) => module.id === id)?.enabled ?? false;
}

function moduleResponse(module: (typeof modules)[number]) {
  const runtime = supervisor.status(module);
  return {
    id: module.id,
    name: module.name,
    enabled: isEnabled(module.id),
    status: runtime.status,
    overlayUrl: module.routes[0]?.path ?? "",
    error: runtime.error,
  };
}

for (const module of modules) {
  if (isEnabled(module.id)) supervisor.enable(module);
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

const server = Bun.serve({
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
    "/admin/": new Response(`<!doctype html>
      <meta charset="utf-8">
      <title>Stream Overlay Admin</title>
      <body><h1>Stream Overlay Admin</h1><p>The Vue admin UI is coming in the next migration step.</p></body>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  },
  fetch: (request) => proxyPokemonOverlay(request),
});

const shutDown = () => {
  supervisor.stopAll(modules);
  void server.stop();
};
process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);

console.log(`Overlay host available at ${server.url}`);
