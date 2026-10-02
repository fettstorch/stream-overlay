const didPattern = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/;
const handlePattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

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
