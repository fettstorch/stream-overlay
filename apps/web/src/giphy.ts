import { GiphyFetch } from "@giphy/js-fetch-api";

let clientPromise: Promise<GiphyFetch> | undefined;
async function bounded<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Giphy request timed out.")), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function client() {
  return (clientPromise ??= configureClient().catch((error) => {
    clientPromise = undefined;
    throw error;
  }));
}
async function configureClient() {
  const response = await fetch("/api/giphy", {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Giphy configuration is unavailable.");
  const { apiKey } = await response.json();
  if (typeof apiKey !== "string" || !apiKey)
    throw new Error("Giphy search is not configured yet. Set GIPHY_API_KEY on the server.");
  return new GiphyFetch(apiKey);
}
export type GiphyChoice = { id: string; title: string; preview: string; url: string };
export async function searchGiphy(query: string): Promise<GiphyChoice[]> {
  if (query.length > 50) throw new Error("Giphy search terms can contain at most 50 characters.");
  const api = await client();
  let result;
  try {
    result = await bounded(api.search(query, { limit: 18, rating: "pg-13" }));
  } catch {
    throw new Error(
      "Giphy search failed or its request limit was reached. Please try again later.",
    );
  }
  return result.data.map((gif) => ({
    id: String(gif.id),
    title: gif.title || "GIF",
    preview: gif.images.fixed_height.url,
    url: gif.images.original.url,
  }));
}
export async function resolveGiphy(id: string): Promise<string> {
  if (!/^[A-Za-z0-9]{1,128}$/.test(id)) throw new Error("Invalid Giphy ID.");
  const gif = await bounded((await client()).gif(id));
  const url = gif.data.images.original.url;
  if (!url.startsWith("https://")) throw new Error("Giphy returned no playable GIF.");
  return url;
}
/** Session-only loaded HTML images. No fetched blobs, object URLs, or persistent cache. */
export function createGiphyPreloader() {
  const entries = new Map<
    string,
    { ready: Promise<string>; image?: HTMLImageElement; cancel?: () => void }
  >();
  function load(id: string): Promise<string> {
    const existing = entries.get(id);
    if (existing) return existing.ready;
    const entry = {
      ready: undefined as unknown as Promise<string>,
      image: undefined as HTMLImageElement | undefined,
      cancel: undefined as (() => void) | undefined,
    };
    entries.set(id, entry);
    entry.ready = resolveGiphy(id)
      .then((url) => {
        if (entries.get(id) !== entry) throw new Error("Giphy preload cancelled.");
        return new Promise<string>((resolve, reject) => {
          const image = new Image();
          entry.image = image;
          const finish = (ok: boolean) => {
            clearTimeout(timer);
            image.onload = image.onerror = null;
            entry.cancel = undefined;
            if (ok) resolve(url);
            else {
              image.src = "";
              reject(new Error("Giphy image could not load."));
            }
          };
          const timer = setTimeout(() => finish(false), 15000);
          entry.cancel = () => {
            finish(false);
            image.src = "";
          };
          image.onload = () => finish(true);
          image.onerror = () => finish(false);
          image.src = url;
        });
      })
      .catch((error) => {
        if (entries.get(id) === entry) entries.delete(id);
        throw error;
      });
    return entry.ready;
  }
  function remove(id: string) {
    const entry = entries.get(id);
    entries.delete(id);
    entry?.cancel?.();
    if (entry?.image) entry.image.src = "";
  }
  return {
    load,
    retain(ids: Set<string>) {
      for (const id of entries.keys()) if (!ids.has(id)) remove(id);
    },
    clear() {
      for (const id of entries.keys()) remove(id);
    },
  };
}
