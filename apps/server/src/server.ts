import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createOAuth, readSessionCookie, sessionCookie } from "./auth.ts";
import { CloudConfigMissingError, PdsService, type CloudConfig, collections } from "./pds.ts";
import { Relay } from "./realtime.ts";
import { safeError, StructuredLogger } from "./logger.ts";

const defaultWebRoot = resolve(import.meta.dir, "../../web/dist");
type Dependencies = { origin: string; webRoot: string; secret: string; oauth: ReturnType<typeof createOAuth>; pds: PdsService; relay: Relay; logger: StructuredLogger };
type SocketData = { peer?: ReturnType<Relay["open"]> };
function json(value: unknown, status = 200, headers: HeadersInit = {}) { return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } }); }
function routeName(path: string) { if (path === "/health") return "health"; if (path.startsWith("/oauth/")) return `oauth.${path.slice(7).replaceAll("/", ".")}`; if (didFromPath(path, "media")) return "accounts.media"; if (didFromPath(path, "config")) return "accounts.config"; if (path === "/api/session") return "session"; if (path === "/relay") return "relay"; return path.startsWith("/api/") ? "api.other" : "static"; }
function safeFile(pathname: string, webRoot: string) { let relative = pathname.startsWith("/admin/") ? pathname.slice("/admin/".length) : pathname.slice(1); if (pathname === "/" || pathname === "/admin/") relative = "cloud-admin.html"; if (pathname === "/effect/") relative = "effect.html"; if (pathname === "/board/") relative = "board.html"; try { relative = decodeURIComponent(relative); } catch { return; } if (relative.split("/").includes("..")) return; const root = resolve(webRoot); const path = resolve(root, relative); return path === root || path.startsWith(`${root}${sep}`) ? path : undefined; }
function didFromPath(path: string, suffix: string) {
  const match = new RegExp(`^/api/accounts/([^/]+)/${suffix}$`).exec(path);
  if (!match) return;
  try {
    // Browser clients encode the whole DID, including its colon separators.
    const did = decodeURIComponent(match[1]);
    return /^did:[a-z0-9]+:[^/?#\s]+$/.test(did) ? did : undefined;
  } catch { return; }
}
function sameOrigin(request: Request, origin: string) {
  try {
    const actual = new URL(request.headers.get("origin") ?? ""), expected = new URL(origin);
    if (actual.origin === expected.origin) return true;
    const loopback = (hostname: string) => ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
    return actual.protocol === "http:" && expected.protocol === "http:" && actual.port === expected.port && loopback(actual.hostname) && loopback(expected.hostname);
  } catch { return false; }
}
function saveFailure(error: unknown) {
  const value = error as { status?: number; error?: string; message?: string };
  const detail = `${value?.error ?? ""} ${value?.message ?? ""}`.toLowerCase();
  if (value?.status === 401 || value?.status === 403 || /unauthor|forbidden|scope|permission/.test(detail)) return { error: "pds-write-not-authorized", message: "Your ATProto session does not grant access to write these records." };
  if (/invalidswap|swap|concurrent/.test(detail)) return { error: "configuration-changed", message: "The PDS configuration changed since it was loaded. Reload and try again." };
  if (/lexicon|record|schema|validation/.test(detail)) return { error: "pds-rejected-record", message: "Your PDS rejected the Stream Overlay record format." };
  return { error: "save-failed", message: "Your PDS could not save the configuration." };
}
function uploadFailure(error: unknown) {
  const value = error as { status?: number; error?: string; message?: string };
  const detail = `${value?.error ?? ""} ${value?.message ?? ""}`.toLowerCase();
  if (error instanceof RangeError || value?.status === 413 || /too large|size limit|payload/.test(detail)) return { status: 413, body: { error: "upload-too-large", message: "This file is larger than the 10 MB upload limit." } };
  if (error instanceof TypeError || /unsupported media|mime|content.?type/.test(detail)) return { status: 415, body: { error: "unsupported-media", message: "This media type is not supported. Choose an image, GIF, audio, MP4, MOV, or WebM file." } };
  if (value?.status === 401 || value?.status === 403 || /unauthor|forbidden|scope|permission|session/.test(detail)) return { status: 403, body: { error: "pds-upload-not-authorized", message: "Your ATProto session cannot upload media. Sign in again to grant media access." } };
  if (value?.status === 429 || /rate.?limit/.test(detail)) return { status: 429, body: { error: "pds-upload-rate-limited", message: "Your PDS is temporarily rate limiting uploads. Wait a moment and try again." } };
  if (/empty media/.test(detail)) return { status: 400, body: { error: "empty-upload", message: "The selected file is empty." } };
  return { status: 502, body: { error: "pds-upload-failed", message: "Your PDS rejected the media upload. Try another supported file or sign in again." } };
}
async function boundedBody(request: Request, maximum: number) { const declared = Number(request.headers.get("content-length") ?? 0); if (declared > maximum) throw new RangeError("Body too large"); const reader = request.body?.getReader(); if (!reader) return new Uint8Array(); const chunks: Uint8Array[] = []; let length = 0; while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) { await reader.cancel(); throw new RangeError("Body too large"); } chunks.push(value); } const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes; }

async function handleRequestInner(request: Request, deps: Dependencies, requestId: string) {
  const url = new URL(request.url); const path = url.pathname;
  if (path === "/health") return json({ status: "ok" });
  if (path === "/oauth/client-metadata.json") return json(deps.oauth.clientMetadata);
  if (path === "/oauth/login") { const handle = url.searchParams.get("handle")?.trim(); if (!handle || handle.length > 253) return Response.redirect(new URL("/admin/?error=oauth-start-failed", url), 302); deps.logger.log("info", "cloud.oauth.authorize-started", { requestId }); try { const redirect = await deps.oauth.authorize(handle, { state: crypto.randomUUID() }); deps.logger.log("info", "cloud.oauth.authorize-completed", { requestId }); return Response.redirect(redirect, 302); } catch (error) { deps.logger.log("error", "cloud.oauth.authorize-failed", { requestId, ...safeError(error) }); return Response.redirect(new URL("/admin/?error=oauth-start-failed", url), 302); } }
  if (path === "/oauth/callback") { deps.logger.log("info", "cloud.oauth.callback-started", { requestId }); try { const { session } = await deps.oauth.callback(url.searchParams); const cookie = await sessionCookie(session.did, deps.secret); deps.logger.log("info", "cloud.oauth.callback-completed", { requestId }); return new Response(null, { status: 302, headers: { Location: "/admin/", "Set-Cookie": `stream_overlay_session=${cookie}; Path=/; HttpOnly;${deps.origin.startsWith("https:") ? " Secure;" : ""} SameSite=Lax; Max-Age=604800` } }); } catch (error) { deps.logger.log("error", "cloud.oauth.callback-failed", { requestId, ...safeError(error) }); return Response.redirect(new URL("/admin/?error=oauth-callback-failed", url), 302); } }
  if (path === "/oauth/logout" && request.method === "POST") { if (!sameOrigin(request, deps.origin)) return json({ error: "invalid-origin" }, 403); return new Response(null, { status: 204, headers: { "Set-Cookie": `stream_overlay_session=; Path=/; HttpOnly;${deps.origin.startsWith("https:") ? " Secure;" : ""} SameSite=Lax; Max-Age=0` } }); }
  if (path === "/api/session") { const did = await readSessionCookie(request, deps.secret); return did ? json({ did }) : json({ authenticated: false }, 401); }
  const testDid = didFromPath(path, "test/[^/]+");
  if (testDid && request.method === "POST") {
    if (!sameOrigin(request, deps.origin) || await readSessionCookie(request, deps.secret) !== testDid) {
      deps.logger.log("warn", "cloud.command.test-rejected", { requestId, reason: "forbidden" });
      return json({ message: "Sign in to test your commands from the admin page.", requestId }, 403);
    }
    try {
      const commandId = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
      const config = await deps.pds.publicConfig(testDid);
      if (!config.commands.some(command => command.id === commandId)) return json({ message: "This command no longer exists. Reload the configuration.", requestId }, 404);
      if (!config.enabled) return json({ message: "Enable Emoticons before testing commands.", requestId }, 409);
      const delivered = deps.relay.testCommand(testDid, commandId, requestId);
      return json({ delivered, message: delivered ? "Test sent to connected effect sources. Playback follows their queue and cooldown rules." : "No effect source is connected. Open your Emoticons effects OBS URL first.", requestId });
    } catch (error) {
      deps.logger.log("error", "cloud.command.test-failed", { requestId, ...safeError(error) });
      return json({ message: "Could not test the command. Try again.", requestId }, 502);
    }
  }
  const configDid = didFromPath(path, "config");
  if (configDid && request.method === "GET") { try { return json(await deps.pds.publicConfig(configDid, url.searchParams.get("refresh") === "1")); } catch (error) { return error instanceof CloudConfigMissingError ? json({ error: "configuration-not-found" }, 404) : json({ error: "configuration-unavailable" }, 502); } }
  if (configDid && request.method === "PUT") { if (!sameOrigin(request, deps.origin)) { deps.logger.log("warn", "cloud.config.origin-rejected", { requestId }); return json({ error: "invalid-origin", message: "Open the admin from the same origin shown in its OAuth metadata." }, 403); } const authDid = await readSessionCookie(request, deps.secret); if (authDid !== configDid) { deps.logger.log("warn", "cloud.config.auth-rejected", { requestId }); return json({ error: "forbidden", message: "Sign in again before saving." }, 403); } try { const body = await request.json() as CloudConfig; if (!body || !Array.isArray(body.commands) || body.commands.length > 100 || typeof body.streamerDid !== "string" || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(body.streamerDid)) return json({ error: "invalid-configuration", message: "The configuration contains invalid values." }, 400); const saved = await deps.pds.save(configDid, body, { logger: deps.logger, requestId }); deps.relay.configChanged(configDid, saved.revision); return json(saved); } catch (error) { deps.logger.log("error", "cloud.config.failed", { requestId, ...safeError(error) }); return json({ ...saveFailure(error), requestId }, 400); } }
  const uploadDid = didFromPath(path, "media");
  if (uploadDid && request.method === "POST") { const contentType = request.headers.get("content-type") ?? ""; const declaredBytes = Number(request.headers.get("content-length") ?? 0) || undefined; deps.logger.log("info", "cloud.upload.request-received", { requestId, contentType, declaredBytes }); if (!sameOrigin(request, deps.origin)) { deps.logger.log("warn", "cloud.upload.origin-rejected", { requestId }); return json({ error: "invalid-origin", message: "Open the admin from the same local address shown in its OAuth metadata.", requestId }, 403); } const authDid = await readSessionCookie(request, deps.secret); if (authDid !== uploadDid) { deps.logger.log("warn", "cloud.upload.auth-rejected", { requestId }); return json({ error: "forbidden", message: "Sign in again before uploading media.", requestId }, 403); } try { deps.logger.log("info", "cloud.upload.body-read-started", { requestId, contentType, declaredBytes }); const bytes = await boundedBody(request, 10_000_000); deps.logger.log("info", "cloud.upload.body-read-completed", { requestId, contentType, bytes: bytes.byteLength }); return json(await deps.pds.upload(uploadDid, bytes, contentType, { logger: deps.logger, requestId })); } catch (error) { const failure = uploadFailure(error); deps.logger.log("error", "cloud.upload.request-failed", { requestId, stage: error instanceof RangeError ? "body-read" : "pds-upload", ...safeError(error) }); return json({ ...failure.body, requestId }, failure.status); } }
  if (path === "/api/meta") return json({ namespace: Object.values(collections(process.env.LEXICON_NAMESPACE ?? "invalid.streamoverlay.dev")), oauthConfigured: deps.secret.length >= 32 });
  if (path === "/") return Response.redirect(new URL("/admin/", url), 302);
  const filePath = safeFile(path, deps.webRoot); if (filePath) { const file = Bun.file(filePath); if (await file.exists()) return new Response(file); }
  return new Response("Not found", { status: 404 });
}

export async function handleRequest(request: Request, deps: Dependencies) {
  const requestId = crypto.randomUUID(), startedAt = Date.now(), path = new URL(request.url).pathname, route = routeName(path), shouldLog = route !== "static";
  if (shouldLog) deps.logger.log("info", "cloud.http.request-received", { requestId, method: request.method, route });
  try { const response = await handleRequestInner(request, deps, requestId); response.headers.set("X-Request-ID", requestId); if (shouldLog) deps.logger.log(response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info", "cloud.http.request-completed", { requestId, method: request.method, route, status: response.status, durationMs: Date.now() - startedAt }); return response; }
  catch (error) { deps.logger.log("error", "cloud.http.request-failed", { requestId, method: request.method, route, durationMs: Date.now() - startedAt, ...safeError(error) }); throw error; }
}

export function createDependencies(env = process.env): Dependencies {
  const origin = (env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${env.PORT ?? "3010"}`).replace(/\/$/, ""); const parsedOrigin = new URL(origin); const local = parsedOrigin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsedOrigin.hostname); if (parsedOrigin.protocol !== "https:" && !local) throw new Error("PUBLIC_ORIGIN must use HTTPS outside local development"); const dataDir = env.AUTH_DATA_DIR ?? resolve(import.meta.dir, "../../../runtime/cloud-auth"); const namespace = env.LEXICON_NAMESPACE ?? "invalid.streamoverlay.dev";
  const secret = env.SESSION_SECRET ?? "development-only-secret-change-me-000000"; if (!local && (secret === "development-only-secret-change-me-000000" || Buffer.byteLength(secret) < 32)) throw new Error("SESSION_SECRET must contain at least 32 bytes"); if (!local && namespace === "invalid.streamoverlay.dev") throw new Error("LEXICON_NAMESPACE must be configured for deployment"); const scope = `atproto repo:${namespace}.settings repo:${namespace}.command blob:image/* blob:audio/* blob:video/*`;
  const logger = new StructuredLogger(env.CLOUD_LOG_FILE ?? (local && env.NODE_ENV !== "production" ? join(tmpdir(), "stream-overlay", "cloud.log") : undefined)); const oauth = createOAuth(origin, dataDir, scope); return { origin, webRoot: env.WEB_DIST ?? resolve(process.cwd(), "apps/web/dist"), secret, oauth, pds: new PdsService(oauth, namespace), relay: new Relay(() => Date.now(), 3_600_000, 12, logger), logger };
}

if (import.meta.main) {
  const deps = createDependencies(); const port = Number(process.env.PORT ?? 3010);
  deps.logger.log("info", "cloud.server.starting", { port, origin: deps.origin, logFile: deps.logger.filePath });
  const server = Bun.serve<SocketData>({ hostname: "0.0.0.0", port,
    fetch(request, server) { const url = new URL(request.url); if (url.pathname === "/relay") { if (!sameOrigin(request, deps.origin)) return new Response("Forbidden", { status: 403 }); if (server.upgrade(request, { data: {} })) return; } return handleRequest(request, deps); },
    websocket: { open(socket) { socket.data.peer = deps.relay.open(socket); }, message(socket, message) { deps.relay.message(socket.data.peer!, String(message)); }, close(socket) { if (socket.data.peer) deps.relay.close(socket.data.peer); } },
  });
  const cleanup = setInterval(() => deps.relay.cleanup(), 60_000); const shutdown = () => { clearInterval(cleanup); server.stop(true); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown); console.log(`Stream Overlay server listening on ${server.hostname}:${server.port}`);
}
