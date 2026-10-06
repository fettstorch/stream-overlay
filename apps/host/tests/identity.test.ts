import { describe, expect, mock, spyOn, test } from "bun:test";
import { getActorProfile, resolveStreamerIdentity, searchActors } from "../src/identity.ts";

describe("resolveStreamerIdentity", () => {
  test("aborts stalled handle resolution with a five-second request deadline", async () => {
    const controller = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetcher = mock((_input: URL | RequestInfo, options?: RequestInit) => new Promise<Response>((_, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    try {
      const pending = resolveStreamerIdentity("alice.bsky.social", fetcher as typeof fetch);
      controller.abort(new Error("deadline"));
      await expect(pending).rejects.toThrow("deadline");
      expect(timeout).toHaveBeenCalledWith(5000);
    } finally { timeout.mockRestore(); }
  });
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

  test("searches public profiles without authentication", async () => {
    const fetcher = mock(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=alice&limit=6");
      return Response.json({ actors: [{
        did: "did:plc:alice",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://cdn.example/alice.jpg",
      }] });
    });
    expect(await searchActors("@alice", fetcher as typeof fetch)).toEqual([{
      did: "did:plc:alice",
      handle: "alice.bsky.social",
      displayName: "Alice",
      avatar: "https://cdn.example/alice.jpg",
    }]);
  });

  test("loads the canonical public profile", async () => {
    const fetcher = mock(async () => Response.json({ did: "did:plc:alice", handle: "alice.test" }));
    expect(await getActorProfile("did:plc:alice", fetcher as typeof fetch)).toEqual({
      did: "did:plc:alice", handle: "alice.test", displayName: "", avatar: "",
    });
  });
});
