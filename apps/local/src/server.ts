import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { ConfigStore } from "./config-store.ts";
import { findModule, modules } from "./modules.ts";
import { ModuleSupervisor } from "./module-supervisor.ts";
import type { PokemonSnapshot } from "@stream-overlay/pokemon-model";
import { MgbaFileProvider } from "../../../modules/pokemon-blue/src/mgba-file-provider.ts";
import { CrystalMgbaFileProvider } from "../../../modules/pokemon-crystal/src/mgba-file-provider.ts";
import { getActorProfile, resolveStreamerIdentity, searchActors } from "./identity.ts";
import { DirectStreamChatService, StreamChatService } from "@stream-overlay/stream-chat";
import { FileLogger } from "./logger.ts";
import { PaintService, parseSegments, parseCursor } from "../../../modules/overlay-paint/src/service.ts";
import { getStreamDimensions } from "./stream-dimensions.ts";
import { defaultPaintConfiguration, parsePaintConfiguration } from "../../../modules/overlay-paint/src/config.ts";
import { defaultChatConfiguration, parseChatConfiguration } from "../../../modules/chat/src/config.ts";
import { buildStaticOverlay } from "./static-overlay.ts";
import { ModuleStatusService } from "./module-status.ts";
import { PetMemory } from "./pokemon-pet-memory.ts";
import { parseThoughtInterval, type PokemonBlueConfiguration } from "../../../modules/pokemon-blue/src/config.ts";

import { EmoticonService } from "../../../modules/emoticons/src/service.ts";

import { projectRoot } from "../../../modules/project-root.ts";
import { defaultHostConfiguration as defaults } from "./default-configuration.ts";
import { updateDirectChat, updateSharedChat } from "./chat-lifecycle.ts";
const port = Number(process.env.PORT ?? 3001);
const configStore = new ConfigStore(join(projectRoot, "runtime/config.json"), defaults);
const logger = new FileLogger(join(tmpdir(), "stream-overlay", "overlay.log"));
const supervisor = new ModuleSupervisor((event, details) => logger.log(event, details));
const chatService = new StreamChatService(getActorProfile, (event, details) => logger.log(event, details));
const directChatService = new DirectStreamChatService((event, details) => logger.log(event, details));
const emoticons = new EmoticonService(join(projectRoot, "runtime/emoticons"), (event, details) => logger.log(event, details));
const unsubscribeEmoticons = directChatService.messages.subscribe(message => emoticons.message(message.id, message.text, message.author));
const emoticonBundle = await Bun.build({ entrypoints: [join(projectRoot, "modules/emoticons/src/client.ts")], target: "browser", minify: true });
if (!emoticonBundle.success) throw new AggregateError(emoticonBundle.logs, "Could not build Emoticons");
const emoticonJavascript = await emoticonBundle.outputs[0]!.text();
// Keep HTML and its startup-built client in sync throughout this host run.
const emoticonHtml = await Bun.file(join(projectRoot, "modules/emoticons/index.html")).text();
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
const [pokemonOverlay, crystalOverlay, chatOverlay] = await Promise.all([
  buildStaticOverlay(projectRoot, "pokemon-blue"),
  buildStaticOverlay(projectRoot, "pokemon-crystal"),
  buildStaticOverlay(projectRoot, "chat"),
]);
const pokemonRuntimeDirectory = join(projectRoot, "runtime/pokemon-blue");
mkdirSync(pokemonRuntimeDirectory, { recursive: true });
const pokemonProvider = new MgbaFileProvider(
  join(pokemonRuntimeDirectory, "team.json"),
  join(pokemonRuntimeDirectory, "badges.json"),
);
let pokemonSnapshot: PokemonSnapshot | null = null;
const crystalRuntimeDirectory = join(projectRoot, "runtime/pokemon-crystal");
mkdirSync(crystalRuntimeDirectory, { recursive: true });
const crystalProvider = new CrystalMgbaFileProvider(join(crystalRuntimeDirectory, "team.json"), join(crystalRuntimeDirectory, "badges.json"));
let crystalSnapshot: PokemonSnapshot | null = null;
const crystalPetMemory = new PetMemory(join(crystalRuntimeDirectory, "pet-counts.json"));
const petMemory = new PetMemory(join(pokemonRuntimeDirectory, "pet-counts.json"));
const unsubscribePetMemory = directChatService.messages.subscribe(message => {
  for (const [moduleId, snapshot, memory] of [
    ["pokemon-blue", pokemonSnapshot, petMemory], ["pokemon-crystal", crystalSnapshot, crystalPetMemory],
  ] as const) {
    if (!isEnabled(moduleId) || !snapshot) continue;
    try {
      if (memory.record(message, snapshot.party)) logger.log("pokemon.pet-counted", { moduleId, id: message.id, authorDid: message.author.did });
    } catch (error) { logger.log("pokemon.pet-count-failed", { moduleId, error: String(error) }); }
  }
});

async function emoticonWrite(request: Request, action: () => Promise<Response>) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Use the local Admin Center" }, { status: 403 });
  try { return await action(); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not save" }, { status: 400 }); }
}

function isEnabled(id: string) {
  return configStore.read().modules.find((module) => module.id === id)?.enabled
    ?? defaults.modules.find((module) => module.id === id)?.enabled ?? false;
}
const moduleStatus = new ModuleStatusService(new Map(modules.map(module => [module.id, isEnabled(module.id)])));
moduleStatus.setConfiguration("chat", configStore.read().chat ?? defaultChatConfiguration);
moduleStatus.setStreamerDid(configStore.read().stream.streamerDid);

function moduleResponse(module: (typeof modules)[number]) {
  const runtime = supervisor.status(module);
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    requirements: module.requirements ?? [],
    configurationLink: module.configurationLink,
    chatCommands: module.chatCommands ?? [],
    preview: module.preview,
    obsSize: module.obsSize,
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
      unsubscribe = directChatService.messages.subscribe((message) => {
        try {
          const hydrated = { ...message, author: { ...message.author,
            avatar: message.author.avatar || `/api/avatars/${encodeURIComponent(message.author.did)}`,
          } };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(hydrated)}\n\n`));
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

function servePokemonOverlay(path = "index.html") {
  // The control client must load even while disabled, so it can turn on live.
  return pokemonOverlay(path);
}

function proxyAdmin(request: Request) {
  const source = new URL(request.url);
  source.protocol = "http:";
  source.hostname = "localhost";
  source.port = "3003";
  return fetch(source, request);
}

const avatarProfiles = new Map<string, { expires: number; profile: ReturnType<typeof getActorProfile> }>();
async function authorAvatar(did: string) {
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did)) return new Response(null, { status: 400 });
  let cached = avatarProfiles.get(did);
  if (!cached || cached.expires < Date.now()) {
    const profile = getActorProfile(did);
    cached = { expires: Date.now() + 2 * 60 * 60_000, profile };
    avatarProfiles.set(did, cached);
    void profile.catch(() => { if (avatarProfiles.get(did)?.profile === profile) avatarProfiles.delete(did); });
  }
  try {
    const profile = await cached.profile;
    if (!profile.avatar) return new Response(null, { status: 404 });
    const image = await fetch(profile.avatar, { signal: AbortSignal.timeout(5000) });
    const contentType = image.headers.get("Content-Type") ?? "";
    if (!image.ok || !contentType.startsWith("image/")) throw new Error(`Avatar image unavailable (${image.status})`);
    return new Response(image.body, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=7200" } });
  } catch (error) {
    logger.log("identity.avatar-profile-failed", { authorDid: did, error: String(error) });
    return new Response(null, { status: 502 });
  }
}

interface EmoticonSocketData { clientId: string; overlay: string; unsubscribe?: () => void }
function serveHost<R extends string>(options: Bun.Serve.Options<EmoticonSocketData, R>) {
  return Bun.serve<EmoticonSocketData, R>(options);
}
const server = serveHost({
  hostname: "127.0.0.1",
  port,
  development: true,
  routes: {
    "/overlays/emoticons": request => Response.redirect(new URL("/overlays/emoticons/", request.url), 302),
    "/overlays/emoticons/board": request => Response.redirect(new URL("/overlays/emoticons/board/", request.url), 302),
    "/overlays/emoticons/": () => new Response(emoticonHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    "/overlays/emoticons/board/": () => new Response(emoticonHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    "/overlays/emoticons/speech-bubble-tail.png": () => new Response(Bun.file(join(projectRoot, "modules/emoticons/assets/speech-bubble-tail.png")), { headers: { "Content-Type": "image/png" } }),
    "/overlays/emoticons/client.js": () => new Response(emoticonJavascript, { headers: { "Content-Type": "application/javascript" } }),
    "/api/emoticons/events": (request, server) => { server.timeout(request, 0); return emoticons.events(request); },
    "/api/emoticons/socket": (request, server) => {
      const url = new URL(request.url);
      const requestedId = url.searchParams.get("clientId") ?? "";
      const overlay = url.searchParams.get("overlay");
      if (server.upgrade(request, { data: {
        clientId: /^[a-f0-9-]{36}$/.test(requestedId) ? requestedId : crypto.randomUUID(),
        overlay: overlay === "effects" || overlay === "board" ? overlay : "admin",
      } })) return;
      return new Response("WebSocket upgrade required", { status: 426 });
    },
    "/api/avatars/:did": request => authorAvatar(request.params.did),
    "/api/emoticons/avatar/:did": request => authorAvatar(request.params.did),
    "/api/emoticons/commands": {
      GET: () => Response.json(emoticons.snapshot()),
      POST: request => emoticonWrite(request, async () => Response.json(emoticons.save(await request.json()), { status: 201 })),
    },
    "/api/emoticons/commands/:id": {
      PUT: request => emoticonWrite(request, async () => Response.json(emoticons.save(await request.json(), request.params.id))),
      DELETE: request => emoticonWrite(request, async () => { emoticons.remove(request.params.id); return new Response(null, { status: 204 }); }),
    },
    "/api/emoticons/assets": {
      POST: request => emoticonWrite(request, async () => {
        const requestedId = request.headers.get("x-emoticon-upload-id") ?? "";
        const uploadId = /^[a-f0-9-]{36}$/.test(requestedId) ? requestedId : crypto.randomUUID();
        const startedAt = Date.now();
        logger.log("emoticons.upload-request-received", { uploadId, contentLength: request.headers.get("content-length") });
        try {
          const form = await request.formData(); const file = form.get("file");
          if (!(file instanceof File)) throw new Error("Choose a media file");
          logger.log("emoticons.upload-body-read", { uploadId, filename: file.name, bytes: file.size, contentType: file.type, elapsedMs: Date.now() - startedAt });
          const asset = await emoticons.upload(file, String(form.get("kind")), Number(form.get("durationSeconds")), uploadId);
          logger.log("emoticons.upload-request-completed", { uploadId, assetId: asset.id, elapsedMs: Date.now() - startedAt });
          return Response.json(asset, { status: 201 });
        } catch (error) {
          logger.log("emoticons.upload-request-failed", { uploadId, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }),
    },
    "/api/emoticons/assets/:id": request => {
      const asset = emoticons.asset(request.params.id);
      return asset ? new Response(Bun.file(join(emoticons.assetDirectory, asset.filename)), { headers: { "Content-Type": asset.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" } }) : new Response("Not found", { status: 404 });
    },
    "/api/emoticons/test/:id": {
      POST: request => emoticonWrite(request, async () => Response.json({ accepted: emoticons.trigger(request.params.id) })),
    },
    "/overlays/pokemon-crystal": () => Response.redirect("/overlays/pokemon-crystal/"),
    "/overlays/pokemon-crystal/": () => crystalOverlay(),
    "/overlays/pokemon-crystal/*": request => crystalOverlay(new URL(request.url).pathname.slice("/overlays/pokemon-crystal/".length)),
    "/": () => servePokemonOverlay(),
    "/overlay.html": () => servePokemonOverlay(),
    "/overlays/pokemon-blue": request => Response.redirect(new URL("/overlays/pokemon-blue/", request.url), 302),
    "/overlays/pokemon-blue/": () => servePokemonOverlay(),
    "/overlays/pokemon-blue/*": request => pokemonOverlay(new URL(request.url).pathname.slice("/overlays/pokemon-blue/".length)),
    "/overlays/chat": request => Response.redirect(new URL("/overlays/chat/", request.url), 302),
    "/overlays/chat/": () => chatOverlay(),
    "/overlays/chat/*": request => chatOverlay(new URL(request.url).pathname.slice("/overlays/chat/".length)),
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
    "/api/overlay-paint/cursor": {
      POST: async request => {
        if (!isEnabled("overlay-paint")) return Response.json({ error: "Paint module disabled" }, { status: 409 });
        let body: { cursor?: unknown };
        try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
        const cursor = parseCursor(body?.cursor);
        if (cursor === undefined) return new Response(null, { status: 400 });
        paintService.moveCursor(cursor);
        return new Response(null, { status: 204 });
      },
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
    "/api/chat/config": {
      GET: () => Response.json(configStore.read().chat ?? defaultChatConfiguration),
      PATCH: async request => {
        let body: unknown;
        try { body = await request.json(); } catch {
          return Response.json({ error: "Invalid Chat configuration" }, { status: 400 });
        }
        const chat = parseChatConfiguration(body);
        if (!chat) return Response.json({ error: "Use a font size from 8 to 72 px, a hex background color, percentages from 0 to 100 and rotation from -180 to 180 degrees" }, { status: 400 });
        const configuration = configStore.read();
        configuration.chat = chat;
        configStore.write(configuration);
        moduleStatus.setConfiguration("chat", chat);
        return Response.json(chat);
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
    "/team.json": () => new Response(Bun.file(join(pokemonRuntimeDirectory, "team.json"))),
    "/badges.json": () => new Response(Bun.file(join(pokemonRuntimeDirectory, "badges.json"))),
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
        updateSharedChat(chatService, configuration);
        updateDirectChat(directChatService, configuration);
        emoticons.setEnabled(isEnabled("emoticons"));
        moduleStatus.setStreamerDid(profile.did);
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
        if (typeof body.event !== "string" || (!body.event.startsWith("pokemon.") && !body.event.startsWith("emoticons."))) {
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
    "/api/pokemon-blue/pet-counts": {
      DELETE: () => {
        try {
          petMemory.reset();
          logger.log("pokemon.pet-counts-reset");
          return new Response(null, { status: 204 });
        } catch (error) {
          logger.log("pokemon.pet-counts-reset-failed", { error: String(error) });
          return Response.json({ error: "Could not reset pet counts" }, { status: 500 });
        }
      },
    },
    "/api/pokemon-blue/pet-favourite/:id": async request => {
      const pokemonId = request.params.id;
      if (!isEnabled("pokemon-blue") || !pokemonSnapshot?.party.some(pokemon => pokemon.id === pokemonId)) return Response.json(null);
      const favourite = petMemory.favourite(configStore.read().stream.streamerDid, pokemonId);
      if (!favourite) return Response.json(null);
      try {
        const author = await chatService.resolveAuthor(favourite.authorDid);
        return Response.json({ pokemonId, authorDid: author.did, avatar: author.avatar, count: favourite.count }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        logger.log("pokemon.favourite-profile-failed", { authorDid: favourite.authorDid, error: String(error) });
        return Response.json(null);
      }
    },
    "/api/pokemon-blue/config": {
      GET: () => Response.json(configStore.read().pokemonBlue),
      PATCH: async (request) => {
        const body = await request.json() as unknown;
        if (
          !body || typeof body !== "object"
          || typeof (body as typeof defaults.pokemonBlue).components?.team !== "boolean"
          || typeof (body as typeof defaults.pokemonBlue).components?.badges !== "boolean"
          || parseThoughtInterval((body as PokemonBlueConfiguration).thoughtIntervalSeconds) === null
        ) {
          return Response.json({ error: "Invalid Pokémon Blue configuration" }, { status: 400 });
        }
        const configuration = configStore.read();
        configuration.pokemonBlue = body as PokemonBlueConfiguration;
        configStore.write(configuration);
        return Response.json(configuration.pokemonBlue);
      },
    },
    "/api/pokemon-crystal/snapshot": () => crystalSnapshot
      ? Response.json(crystalSnapshot, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Load scripts/mgba-crystal.lua in mGBA with Crystal running" }, { status: 503 }),
    "/api/pokemon-crystal/pet-counts": {
      DELETE: () => {
        try {
          crystalPetMemory.reset();
          logger.log("pokemon.pet-counts-reset", { moduleId: "pokemon-crystal" });
          return new Response(null, { status: 204 });
        } catch (error) {
          logger.log("pokemon.pet-counts-reset-failed", { moduleId: "pokemon-crystal", error: String(error) });
          return Response.json({ error: "Could not reset pet counts" }, { status: 500 });
        }
      },
    },
    "/api/pokemon-crystal/pet-favourite/:id": async request => {
      const pokemonId = request.params.id;
      if (!isEnabled("pokemon-crystal") || !crystalSnapshot?.party.some(pokemon => pokemon.id === pokemonId)) return Response.json(null);
      const favourite = crystalPetMemory.favourite(configStore.read().stream.streamerDid, pokemonId);
      if (!favourite) return Response.json(null);
      try {
        const author = await chatService.resolveAuthor(favourite.authorDid);
        return Response.json({ pokemonId, authorDid: author.did, avatar: author.avatar, count: favourite.count }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        logger.log("pokemon.favourite-profile-failed", { moduleId: "pokemon-crystal", error: String(error) });
        return Response.json(null);
      }
    },
    "/api/pokemon-crystal/config": {
      GET: () => Response.json(configStore.read().pokemonCrystal ?? { components: { team: true, badges: true } }),
      PATCH: async request => {
        const body = await request.json() as PokemonBlueConfiguration;
        if (!body || typeof body.components?.team !== "boolean" || typeof body.components?.badges !== "boolean"
          || parseThoughtInterval(body.thoughtIntervalSeconds) === null) {
          return Response.json({ error: "Invalid Pokémon Crystal configuration" }, { status: 400 });
        }
        const configuration = configStore.read();
        configuration.pokemonCrystal = body;
        configStore.write(configuration);
        return Response.json(configuration.pokemonCrystal);
      },
    },
    "/api/modules/:id/events": (request, server) => {
      if (!findModule(request.params.id)) return new Response("Unknown module", { status: 404 });
      server.timeout(request, 0);
      return moduleStatus.events(request, request.params.id);
    },
    "/api/modules/:id": {
      PATCH: async (request) => {
        const module = findModule(request.params.id);
        if (!module) return Response.json({ error: "Unknown module" }, { status: 404 });
        const body = await request.json() as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") {
          return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
        }
        const configuration = configStore.setModuleEnabled(module.id, body.enabled);
        updateSharedChat(chatService, configuration);
        updateDirectChat(directChatService, configuration);
        moduleStatus.setEnabled(module.id, body.enabled);
        if (module.id === "emoticons") emoticons.setEnabled(body.enabled);
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
  fetch: () => new Response("Not found", { status: 404 }),
  websocket: {
    open(socket: Bun.ServerWebSocket<EmoticonSocketData>) {
      socket.data.unsubscribe = emoticons.subscribe(event => {
        try { socket.send(JSON.stringify(event)); } catch { socket.close(); }
      }, socket.data.clientId, socket.data.overlay);
    },
    message() { /* This feed is read-only. */ },
    close(socket: Bun.ServerWebSocket<EmoticonSocketData>) { socket.data.unsubscribe?.(); },
  },
});

logger.log("host.started", { port, logPath: logger.path });

for (const module of modules) {
  if (isEnabled(module.id)) supervisor.enable(module);
}
updateSharedChat(chatService, configStore.read());
updateDirectChat(directChatService, configStore.read());
paintService.setEnabled(isEnabled("overlay-paint"));
emoticons.setEnabled(isEnabled("emoticons"));
await pokemonProvider.start((snapshot) => {
  pokemonSnapshot = snapshot;
});
await crystalProvider.start(snapshot => { crystalSnapshot = snapshot; });

const shutDown = () => {
  logger.log("host.stopping");
  supervisor.stopAll(modules);
  chatService.stop();
  directChatService.stop();
  unsubscribePetMemory();
  unsubscribeEmoticons();
  emoticons.stop();
  paintService.stop();
  void pokemonProvider.stop();
  void crystalProvider.stop();
  void server.stop();
};
process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);

console.log(`Overlay host available at ${server.url}`);
console.log(`Overlay log available at ${logger.path}`);
