import { cached } from "@fettstorch/jule";

export function createStickerAssetCache() {
  const resources = new Map<string, { controller: AbortController; url?: string }>();
  const load = cached(async (source: string) => {
    const resource = { controller: new AbortController(), url: undefined as string | undefined };
    resources.set(source, resource);
    try {
      const response = await fetch(source, { signal: resource.controller.signal });
      if (!response.ok) throw new Error(`Media load failed (${response.status})`);
      const blob = await response.blob();
      if (resource.controller.signal.aborted) throw new Error("Media load cancelled");
      resource.url = URL.createObjectURL(blob);
      return resource.url;
    } catch (error) {
      if (resources.get(source) === resource) { resources.delete(source); load.evict(source); }
      throw error;
    }
  });
  function evict(source: string) {
    const resource = resources.get(source);
    resource?.controller.abort();
    if (resource?.url) URL.revokeObjectURL(resource.url);
    resources.delete(source); load.evict(source);
  }
  return {
    load,
    retain(sources: Set<string>) { for (const source of resources.keys()) if (!sources.has(source)) evict(source); },
    clear() { for (const source of resources.keys()) evict(source); load.clear(); },
  };
}
