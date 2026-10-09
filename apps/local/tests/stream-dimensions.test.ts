import { describe, expect, test } from "bun:test";
import { getStreamDimensions, parseStreamDimensions } from "../../../packages/stream-chat/src/stream-dimensions.ts";

describe("Stream video dimensions", () => {
  test("reads the video track from the official segment view", () => {
    expect(parseStreamDimensions({ segments: [{ record: { video: [{ width: 1080, height: 1920 }] } }] }))
      .toEqual({ width: 1080, height: 1920 });
  });

  test("ignores missing, malformed, zero and fractional dimensions", () => {
    for (const value of [null, {}, { segments: [null] }, { segments: [{ record: { video: [null,
      { width: 0, height: 10 }, { width: 10.5, height: 20 }, { width: "1920", height: 1080 },
    ] } }] }]) expect(parseStreamDimensions(value)).toBeNull();
  });

  test("requests the most recent segment for the configured DID", async () => {
    let requested: URL | undefined;
    const result = await getStreamDimensions("did:plc:test", (async input => {
      requested = new URL(String(input));
      return Response.json({ segments: [{ record: { video: [{ width: 1280, height: 720 }] } }] });
    }) as typeof fetch);
    expect(requested!.searchParams.get("userDID")).toBe("did:plc:test");
    expect(requested!.searchParams.get("limit")).toBe("1");
    expect(result).toEqual({ width: 1280, height: 720 });
  });

  test("does not fetch without an account and reports upstream errors", async () => {
    expect(await getStreamDimensions("", (() => { throw new Error("Unexpected request"); }) as typeof fetch)).toBeNull();
    await expect(getStreamDimensions("did:plc:test", (async () => new Response(null, { status: 503 })) as typeof fetch)).rejects.toThrow();
  });
});
