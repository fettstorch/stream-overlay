import { describe, expect, mock, test } from "bun:test";
import { resolveStreamerIdentity } from "../src/identity.ts";

describe("resolveStreamerIdentity", () => {
  test("keeps an existing DID without making a request", async () => {
    const fetcher = mock(() => Promise.reject(new Error("unexpected request")));
    expect(await resolveStreamerIdentity(" did:plc:abc123 ", fetcher as typeof fetch)).toBe("did:plc:abc123");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("normalizes and resolves an ATProto handle", async () => {
    const fetcher = mock(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe("https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=alice.bsky.social");
      return Response.json({ did: "did:plc:resolved" });
    });
    expect(await resolveStreamerIdentity(" @Alice.Bsky.Social ", fetcher as typeof fetch)).toBe("did:plc:resolved");
  });

  test("rejects invalid handles before making a request", async () => {
    const fetcher = mock(() => Promise.reject(new Error("unexpected request")));
    expect(resolveStreamerIdentity("not a handle", fetcher as typeof fetch)).rejects.toThrow("valid DID or ATProto handle");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("reports handles that cannot be resolved", async () => {
    const fetcher = mock(async () => new Response(null, { status: 404 }));
    expect(resolveStreamerIdentity("missing.bsky.social", fetcher as typeof fetch)).rejects.toThrow("Could not resolve");
  });
});
