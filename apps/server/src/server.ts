import { resolve, sep } from "node:path";
import { createOAuth, readSessionCookie, sessionCookie } from "./auth.ts";
import { PdsService, type CloudConfig, collections } from "./pds.ts";
import { Relay } from "./realtime.ts";

const defaultWebRoot = resolve(import.meta.dir, "../../web/dist");
type Dependencies = { origin: string; webRoot: string; secret: string; oauth: ReturnType<typeof createOAuth>; pds: PdsService; relay: Relay };
type SocketData = { peer?: ReturnType<Relay["open"]> };
function json(value: unknown, status = 200, headers: HeadersInit = {}) { return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } }); }
function safeFile(pathname: string, webRoot: string) { let relative = pathname.startsWith("/admin/") ? pathname.slice("/admin/".length) : pathname.slice(1); if (pathname === "/" || pathname === "/admin/") relative = "cloud-admin.html"; if (pathname === "/effect/") relative = "effect.html"; if (pathname === "/board/") relative = "board.html"; try { relative = decodeURIComponent(relative); } catch { return; } if (relative.split("/").includes("..")) return; const root = resolve(webRoot); const path = resolve(root, relative); return path === root || path.startsWith(`${root}${sep}`) ? path : undefined; }
function didFromPath(path: string, suffix: string) { const match = new RegExp(`^/api/accounts/(did:[^/]+)/${suffix}$`).exec(path); return match ? decodeURIComponent(match[1]) : undefined; }
function sameOrigin(request: Request, origin: string) { try { return new URL(request.headers.get("origin") ?? "").origin === new URL(origin).origin; } catch { return false; } }
async function boundedBody(request: Request, maximum: number) { const declared = Number(request.headers.get("content-length") ?? 0); if (declared > maximum) throw new RangeError("Body too large"); const reader = request.body?.getReader(); if (!reader) return new Uint8Array(); const chunks: Uint8Array[] = []; let length = 0; while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) { await reader.cancel(); throw new RangeError("Body too large"); } chunks.push(value); } const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes; }

export async function handleRequest(request: Request, deps: Dependencies) {
  const url = new URL(request.url); const path = url.pathname;
  if (path === "/health") return json({ status: "ok" });
  if (path === "/oauth/client-metadata.json") return json(deps.oauth.clientMetadata);
  if (path === "/oauth/login") { const handle = url.searchParams.get("handle")?.trim(); if (!handle || handle.length > 253) return Response.redirect(new URL("/admin/?error=oauth-start-failed", url), 302); try { return Response.redirect(await deps.oauth.authorize(handle, { state: crypto.randomUUID() }), 302); } catch { return Response.redirect(new URL("/admin/?error=oauth-start-failed", url), 302); } }
  if (path === "/oauth/callback") { try { const { session } = await deps.oauth.callback(url.searchParams); const cookie = await sessionCookie(session.did, deps.secret); return new Response(null, { status: 302, headers: { Location: "/admin/", "Set-Cookie": `stream_overlay_session=${cookie}; Path=/; HttpOnly;${deps.origin.startsWith("https:") ? " Secure;" : ""} SameSite=Lax; Max-Age=604800` } }); } catch { return Response.redirect(new URL("/admin/?error=oauth-callback-failed", url), 302); } }
  if (path === "/oauth/logout" && request.method === "POST") { if (!sameOrigin(request, deps.origin)) return json({ error: "invalid-origin" }, 403); return new Response(null, { status: 204, headers: { "Set-Cookie": `stream_overlay_session=; Path=/; HttpOnly;${deps.origin.startsWith("https:") ? " Secure;" : ""} SameSite=Lax; Max-Age=0` } }); }
  if (path === "/api/session") { const did = await readSessionCookie(request, deps.secret); return did ? json({ did }) : json({ authenticated: false }, 401); }
  const configDid = didFromPath(path, "config");
  if (configDid && request.method === "GET") { try { return json(await deps.pds.publicConfig(configDid, url.searchParams.get("refresh") === "1")); } catch { return json({ error: "configuration-unavailable" }, 502); } }
  if (configDid && request.method === "PUT") { if (!sameOrigin(request, deps.origin)) return json({ error: "invalid-origin" }, 403); const authDid = await readSessionCookie(request, deps.secret); if (authDid !== configDid) return json({ error: "forbidden" }, 403); try { const body = await request.json() as CloudConfig; if (!body || !Array.isArray(body.commands) || body.commands.length > 100 || typeof body.streamerDid !== "string" || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(body.streamerDid)) return json({ error: "invalid-configuration" }, 400); const saved = await deps.pds.save(configDid, body); deps.relay.configChanged(configDid, saved.revision); return json(saved); } catch { return json({ error: "save-failed" }, 400); } }
  const uploadDid = didFromPath(path, "media");
  if (uploadDid && request.method === "POST") { if (!sameOrigin(request, deps.origin)) return json({ error: "invalid-origin" }, 403); const authDid = await readSessionCookie(request, deps.secret); if (authDid !== uploadDid) return json({ error: "forbidden" }, 403); try { const bytes = await boundedBody(request, 10_000_000); return json(await deps.pds.upload(uploadDid, bytes, request.headers.get("content-type") ?? "")); } catch (error) { return error instanceof RangeError ? json({ error: "upload-too-large" }, 413) : json({ error: "upload-failed" }, 400); } }
  if (path === "/api/meta") return json({ namespace: Object.values(collections(process.env.LEXICON_NAMESPACE ?? "invalid.streamoverlay.dev")), oauthConfigured: deps.secret.length >= 32 });
  if (path === "/") return Response.redirect(new URL("/admin/", url), 302);
  const filePath = safeFile(path, deps.webRoot); if (filePath) { const file = Bun.file(filePath); if (await file.exists()) return new Response(file); }
  return new Response("Not found", { status: 404 });
}

export function createDependencies(env = process.env): Dependencies {
  const origin = (env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${env.PORT ?? "3010"}`).replace(/\/$/, ""); const parsedOrigin = new URL(origin); const local = parsedOrigin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsedOrigin.hostname); if (parsedOrigin.protocol !== "https:" && !local) throw new Error("PUBLIC_ORIGIN must use HTTPS outside local development"); const dataDir = env.AUTH_DATA_DIR ?? resolve(import.meta.dir, "../../../runtime/cloud-auth"); const namespace = env.LEXICON_NAMESPACE ?? "invalid.streamoverlay.dev";
  const secret = env.SESSION_SECRET ?? "development-only-secret-change-me-000000"; if (!local && (secret === "development-only-secret-change-me-000000" || Buffer.byteLength(secret) < 32)) throw new Error("SESSION_SECRET must contain at least 32 bytes"); if (!local && namespace === "invalid.streamoverlay.dev") throw new Error("LEXICON_NAMESPACE must be configured for deployment"); const scope = `atproto repo:${namespace}.settings repo:${namespace}.command blob:image/* blob:audio/* blob:video/*`;
  const oauth = createOAuth(origin, dataDir, scope); return { origin, webRoot: env.WEB_DIST ?? resolve(process.cwd(), "apps/web/dist"), secret, oauth, pds: new PdsService(oauth, namespace), relay: new Relay() };
}

if (import.meta.main) {
  const deps = createDependencies(); const port = Number(process.env.PORT ?? 3010);
  const server = Bun.serve<SocketData>({ hostname: "0.0.0.0", port,
    fetch(request, server) { const url = new URL(request.url); if (url.pathname === "/relay") { if (!sameOrigin(request, deps.origin)) return new Response("Forbidden", { status: 403 }); if (server.upgrade(request, { data: {} })) return; } return handleRequest(request, deps); },
    websocket: { open(socket) { socket.data.peer = deps.relay.open(socket); }, message(socket, message) { deps.relay.message(socket.data.peer!, String(message)); }, close(socket) { if (socket.data.peer) deps.relay.close(socket.data.peer); } },
  });
  const cleanup = setInterval(() => deps.relay.cleanup(), 60_000); const shutdown = () => { clearInterval(cleanup); server.stop(true); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown); console.log(`Stream Overlay server listening on ${server.hostname}:${server.port}`);
}
