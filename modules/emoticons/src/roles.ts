export type CommandRoles = {
  following?: boolean;
  followers: boolean;
  mutuals: boolean;
  moderators: boolean;
  users: { did: string; handle?: string }[];
};
export const openCommandRoles: CommandRoles = { following: false, followers: false, mutuals: false, moderators: false, users: [] };
export function rolesRestricted(roles?: CommandRoles) {
  return Boolean(roles && (roles.following || roles.followers || roles.mutuals || roles.moderators || roles.users.length));
}
export function validateCommandRoles(value: unknown): asserts value is CommandRoles {
  const roles = value as CommandRoles;
  if (!roles || typeof roles.followers !== "boolean" || typeof roles.mutuals !== "boolean"
    || (roles.following !== undefined && typeof roles.following !== "boolean")
    || typeof roles.moderators !== "boolean" || !Array.isArray(roles.users) || roles.users.length > 200)
    throw new Error("Invalid command roles.");
  const seen = new Set<string>();
  for (const user of roles.users) {
    if (!user || typeof user.did !== "string" || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(user.did)
      || user.did.length > 2048 || seen.has(user.did)
      || (user.handle !== undefined && (typeof user.handle !== "string" || user.handle.length > 253)))
      throw new Error("Use at most 200 unique accounts for command roles.");
    seen.add(user.did);
  }
}

/** Shared by the OBS effects browser and the server's verified Bot path. */
export function createRoleAuthorizer(fetcher: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { expires: number; pending: Promise<{ following: boolean; followedBy: boolean }> }>();
  return async (streamerDid: string, author: { did?: string; isModerator?: boolean } | undefined, roles?: CommandRoles): Promise<boolean> => {
    if (!rolesRestricted(roles)) return true;
    if (!roles || !author?.did) return false;
    if (roles.users.some(user => user.did === author.did) || (roles.moderators && author.isModerator)) return true;
    if (!roles.following && !roles.followers && !roles.mutuals) return false;
    const key = `${streamerDid}:${author.did}`;
    for (const [id, item] of cache) if (item.expires <= now()) cache.delete(id);
    let item = cache.get(key);
    if (!item) {
      if (cache.size >= 1000) throw new Error("Role lookup capacity reached");
      const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.graph.getRelationships");
      url.searchParams.set("actor", streamerDid);
      url.searchParams.append("others", author.did);
      const pending = (async () => {
        const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Role lookup unavailable");
        const data = await response.json();
        const relationship = data.relationships?.find((entry: { did?: string }) => entry.did === author.did);
        if (data.actor !== streamerDid || !relationship) throw new Error("Role relationship unavailable");
        return { following: typeof relationship.following === "string", followedBy: typeof relationship.followedBy === "string" };
      })();
      item = { expires: now() + 60000, pending };
      cache.set(key, item);
      void pending.catch(() => { if (cache.get(key)?.pending === pending) cache.delete(key); });
    }
    const relationship = await item.pending;
    return Boolean((roles.following && relationship.following) || (roles.followers && relationship.followedBy)
      || (roles.mutuals && relationship.following && relationship.followedBy));
  };
}
