export interface StreamDimensions { width: number; height: number }

export function parseStreamDimensions(value: unknown): StreamDimensions | null {
  if (!value || typeof value !== "object") return null;
  const segments = (value as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return null;
  for (const segment of segments) {
    const video = segment?.record?.video;
    if (!Array.isArray(video)) continue;
    for (const track of video) {
      if (Number.isSafeInteger(track?.width) && Number.isSafeInteger(track?.height)
        && track.width > 0 && track.height > 0) {
        return { width: track.width, height: track.height };
      }
    }
  }
  return null;
}

export async function getStreamDimensions(did: string, fetcher: typeof fetch = fetch) {
  if (!did) return null;
  const url = new URL("https://stream.place/xrpc/place.stream.live.getSegments");
  url.searchParams.set("userDID", did);
  url.searchParams.set("limit", "1");
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Could not read Stream.place video dimensions");
  return parseStreamDimensions(await response.json());
}
