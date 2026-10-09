import { NodeOAuthClient, requestLocalLock, type NodeSavedSession, type NodeSavedState } from "@atproto/oauth-client-node";
import { timingSafeEqual } from "node:crypto";
import { JsonStore } from "./store.ts";

export function createOAuth(origin: string, dataDir: string, scope: string) {
  const local = new URL(origin).protocol === "http:";
  const clientId = local ? `http://localhost?redirect_uri=${encodeURIComponent(`${origin}/oauth/callback`)}&scope=${encodeURIComponent(scope)}` : `${origin}/oauth/client-metadata.json`;
  return new NodeOAuthClient({
    clientMetadata: {
      client_id: clientId, client_name: "Stream Overlay", client_uri: origin,
      redirect_uris: [`${origin}/oauth/callback`], scope, grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], application_type: local ? "native" : "web", token_endpoint_auth_method: "none", dpop_bound_access_tokens: true,
    },
    stateStore: new JsonStore<NodeSavedState>(dataDir, "oauth-state"),
    sessionStore: new JsonStore<NodeSavedSession>(dataDir, "oauth-session"),
    requestLock: requestLocalLock,
  });
}

export async function sessionCookie(did: string, secret: string) {
  const expires = Date.now() + 7 * 86_400_000; const body = `${did}|${expires}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))).toString("base64url");
  return Buffer.from(`${body}|${signature}`).toString("base64url");
}
export async function readSessionCookie(request: Request, secret: string) {
  const encoded = /(?:^|; )stream_overlay_session=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1]; if (!encoded) return;
  let decoded: string; try { decoded = Buffer.from(encoded, "base64url").toString(); } catch { return; }
  const parts = decoded.split("|"); if (parts.length !== 3 || Number(parts[1]) < Date.now()) return;
  const expected = await sessionCookieFor(parts[0], parts[1], secret); const actualBytes = Buffer.from(parts[2]); const expectedBytes = Buffer.from(expected); if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return; return parts[0];
}
async function sessionCookieFor(did: string, expires: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${did}|${expires}`))).toString("base64url"); }
