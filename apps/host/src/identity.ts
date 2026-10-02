const didPattern = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/;
const handlePattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export interface ActorProfile {
  did: string;
  handle: string;
  displayName: string;
  avatar: string;
}

function actorProfile(value: unknown): ActorProfile | null {
  if (!value || typeof value !== "object") return null;
  const actor = value as Record<string, unknown>;
  if (typeof actor.did !== "string" || !didPattern.test(actor.did) || typeof actor.handle !== "string") return null;
  return {
    did: actor.did,
    handle: actor.handle,
    displayName: typeof actor.displayName === "string" ? actor.displayName : "",
    avatar: typeof actor.avatar === "string" ? actor.avatar : "",
  };
}

export async function resolveStreamerIdentity(input: string, fetcher: typeof fetch = fetch) {
  const value = input.trim();
  if (!value || didPattern.test(value)) return value;

  const handle = value.replace(/^@/, "").toLowerCase();
  if (handle.length > 253 || !handlePattern.test(handle)) {
    throw new Error("Enter a valid DID or ATProto handle");
  }

  const url = new URL("https://bsky.social/xrpc/com.atproto.identity.resolveHandle");
  url.searchParams.set("handle", handle);
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Could not resolve @${handle}`);

  const result = await response.json() as { did?: unknown };
  if (typeof result.did !== "string" || !didPattern.test(result.did)) {
    throw new Error(`Could not resolve @${handle}`);
  }
  return result.did;
}

export async function getActorProfile(actor: string, fetcher: typeof fetch = fetch) {
  const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile");
  url.searchParams.set("actor", actor);
  const response = await fetcher(url);
  if (!response.ok) throw new Error("Could not load this Bluesky profile");
  const profile = actorProfile(await response.json());
  if (!profile) throw new Error("Bluesky returned an invalid profile");
  return profile;
}

export async function searchActors(query: string, fetcher: typeof fetch = fetch) {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  const response = await fetcher(url);
  if (!response.ok) throw new Error("Could not search Bluesky profiles");
  const result = await response.json() as { actors?: unknown };
  if (!Array.isArray(result.actors)) throw new Error("Bluesky returned invalid search results");
  return result.actors.map(actorProfile).filter((actor): actor is ActorProfile => actor !== null);
}
