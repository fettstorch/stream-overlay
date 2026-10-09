import type { Agent } from "@atproto/api";
import type { ActorSuggestion } from "./actor-combobox.ts";

let publicAgent: Promise<Agent> | undefined;

function getPublicAgent(): Promise<Agent> {
  publicAgent ??= import("@atproto/api").then(({ Agent }) => new Agent({ service: "https://public.api.bsky.app" }));
  return publicAgent;
}

export async function searchPublicActors(query: string, signal: AbortSignal): Promise<ActorSuggestion[]> {
  const normalized = query.trim().replace(/^@/, "");
  if (normalized.length < 2 || normalized.length > 100) return [];
  const agent = await getPublicAgent();
  const response = await agent.app.bsky.actor.searchActors({ q: normalized, limit: 6 }, { signal });
  return response.data.actors.flatMap(actor => {
    if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(actor.did) || !actor.handle) return [];
    return [{ did: actor.did, handle: actor.handle, displayName: actor.displayName ?? "", avatar: actor.avatar?.startsWith("https://") ? actor.avatar : "" }];
  }).slice(0, 6);
}
