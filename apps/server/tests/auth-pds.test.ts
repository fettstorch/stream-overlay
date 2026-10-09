import { describe, expect, test } from "bun:test";
import { readSessionCookie, sessionCookie } from "../src/auth.ts";
import {
  CloudConfigConflictError,
  listAllRecords,
  normalizeMediaType,
  parseConfig,
  PdsService,
  validateMediaUrl,
} from "../src/pds.ts";
import { Agent } from "@atproto/api";
import { StructuredLogger } from "../src/logger.ts";
const secret = "a-secret-longer-than-thirty-two-characters";
describe("cloud auth and PDS records", () => {
  test("bounds public configuration cache and expires inactive entries", async () => {
    let reads = 0;
    const namespace = "invalid.streamoverlay.dev";
    const service = new PdsService({} as any, namespace, 60_000, 15_000, {
      resolvePds: async () => "https://pds.example",
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).includes("getRecord")) {
          reads++;
          return Response.json({
            value: { $type: `${namespace}.settings`, enabled: true, streamerDid: "did:plc:alice" },
          });
        }
        return Response.json({ records: [] });
      }) as typeof fetch,
    });
    for (let index = 0; index <= 200; index++)
      await service.publicConfig(`did:plc:account${index}`);
    expect(reads).toBe(201);
    await service.publicConfig("did:plc:account200");
    expect(reads).toBe(201);
    await service.publicConfig("did:plc:account0");
    expect(reads).toBe(202);
    service.cleanup(Date.now() + 3_600_001);
    await service.publicConfig("did:plc:account200");
    expect(reads).toBe(203);
  });
  test("binds legacy streamer settings and future writes to the owning ATProto account", async () => {
    const namespace = "invalid.streamoverlay.dev",
      writes: any[] = [];
    const agent: any = {
      com: {
        atproto: {
          sync: { getLatestCommit: async () => ({ data: { cid: "head" } }) },
          repo: {
            getRecord: async () => ({ data: { value: { updatedAt: "old" } } }),
            listRecords: async () => ({ data: { records: [] } }),
            applyWrites: async (value: any) => {
              writes.push(value);
              return { data: {} };
            },
          },
        },
      },
    };
    const service = new PdsService({ restore: async () => ({}) } as any, namespace, 0, 0, {
      agent: () => agent,
      resolvePds: async () => "https://pds.example",
      fetch: (async (input: RequestInfo | URL) =>
        Response.json(
          String(input).includes("getRecord")
            ? {
                value: {
                  $type: `${namespace}.settings`,
                  enabled: true,
                  streamerDid: "did:plc:other",
                },
              }
            : { records: [] },
        )) as typeof fetch,
    });
    expect((await service.publicConfig("did:plc:alice")).streamerDid).toBe("did:plc:alice");
    const saved = await service.save("did:plc:alice", {
      enabled: true,
      streamerDid: "did:plc:other",
      revision: "old",
      commands: [],
    });
    expect(saved.streamerDid).toBe("did:plc:alice");
    expect(writes[0].writes[0].value.streamerDid).toBe("did:plc:alice");
  });
  test("auth cookie is signed and rejects tampering", async () => {
    const value = await sessionCookie("did:plc:alice", secret);
    expect(
      await readSessionCookie(
        new Request("https://example.test", {
          headers: { cookie: `stream_overlay_session=${value}` },
        }),
        secret,
      ),
    ).toBe("did:plc:alice");
    expect(
      await readSessionCookie(
        new Request("https://example.test", {
          headers: { cookie: `stream_overlay_session=${value}x` },
        }),
        secret,
      ),
    ).toBeUndefined();
  });
  test("parses command records and converts storage units", () => {
    const namespace = "invalid.streamoverlay.dev";
    const result = parseConfig(
      {
        $type: `${namespace}.settings`,
        enabled: true,
        streamerDid: "did:plc:alice",
        updatedAt: "v1",
      },
      [
        {
          $type: `${namespace}.command`,
          id: "one",
          command: "wave",
          mode: "effect",
          image: { url: "https://cdn.example/wave.gif" },
          durationMilliseconds: 1500,
          cooldownSeconds: 20,
          volumePercent: 55,
          width: "",
          height: "",
          mirrored: false,
        },
      ],
      namespace,
    );
    expect(result?.commands[0].durationSeconds).toBe(1.5);
    expect(result?.commands[0].volume).toBe(0.55);
  });
  test("only accepts HTTPS direct URL candidates", () => {
    expect(validateMediaUrl("https://cdn.example/clip.mp4")).toBe("https://cdn.example/clip.mp4");
    expect(validateMediaUrl("http://cdn.example/clip.mp4")).toBeUndefined();
  });
  test("normalizes supported upload MIME values including GIF", () => {
    expect(normalizeMediaType("image/gif; charset=binary")).toBe("image/gif");
    expect(normalizeMediaType("image/jpg")).toBe("image/jpeg");
    expect(normalizeMediaType("application/ogg")).toBe("audio/ogg");
    expect(normalizeMediaType("application/octet-stream")).toBeUndefined();
  });
  test("paginates record reads", async () => {
    const cursors: Array<string | undefined> = [];
    const records = await listAllRecords(async (cursor) => {
      cursors.push(cursor);
      return cursor ? { records: [{ id: 2 }] } : { records: [{ id: 1 }], cursor: "next" };
    });
    expect(cursors).toEqual([undefined, "next"]);
    expect(records.map((item) => item.id)).toEqual([1, 2]);
  });
  test("saves settings, command changes, and deletions in one conflict-checked repo write", async () => {
    const calls: any[] = [];
    const agent: any = {
      com: {
        atproto: {
          sync: {
            getLatestCommit: async () => ({ data: { cid: "bafyhead" } }),
          },
          repo: {
            getRecord: async () => ({ data: { value: { updatedAt: "old" } } }),
            listRecords: async () => ({
              data: {
                records: [
                  {
                    uri: "at://did:plc:alice/invalid.streamoverlay.dev.command/old",
                  },
                ],
              },
            }),
            applyWrites: async (input: any) => {
              calls.push(input);
              return { data: {} };
            },
          },
        },
      },
      uploadBlob: async () => ({ data: { blob: {} } }),
    };
    const service = new PdsService(
      { restore: async () => ({}) } as any,
      "invalid.streamoverlay.dev",
      0,
      0,
      { agent: () => agent },
    );
    const saved = await service.save("did:plc:alice", {
      enabled: true,
      streamerDid: "did:plc:alice",
      revision: "old",
      commands: [
        {
          id: "new",
          command: "wave",
          mode: "effect",
          image: { url: "https://cdn.example/wave.gif" },
          durationSeconds: 1,
          cooldownSeconds: 2,
          volume: 0.5,
          width: "40vw",
          height: "",
          mirrored: false,
        },
      ],
    });
    expect(saved.revision).not.toBe("old");
    expect(calls).toHaveLength(1);
    expect(calls[0].swapCommit).toBe("bafyhead");
    expect(calls[0].writes.map((write: any) => write.$type)).toEqual([
      "com.atproto.repo.applyWrites#update",
      "com.atproto.repo.applyWrites#delete",
      "com.atproto.repo.applyWrites#create",
    ]);
  });
  test("rejects stale and deleted configurations without issuing any writes", async () => {
    let writes = 0;
    let missing = false;
    const lines: string[] = [];
    const agent: any = {
      com: {
        atproto: {
          sync: { getLatestCommit: async () => ({ data: { cid: "head" } }) },
          repo: {
            getRecord: async () => {
              if (missing) throw Object.assign(new Error("RecordNotFound"), { status: 400 });
              return { data: { value: { updatedAt: "newer" } } };
            },
            listRecords: async () => ({
              data: {
                records: [
                  { uri: "at://did:plc:alice/invalid.streamoverlay.dev.command/new-command" },
                ],
              },
            }),
            applyWrites: async () => {
              writes++;
            },
          },
        },
      },
    };
    const service = new PdsService(
      { restore: async () => ({}) } as any,
      "invalid.streamoverlay.dev",
      0,
      0,
      { agent: () => agent },
    );
    const candidate = {
      enabled: true,
      streamerDid: "did:plc:alice",
      revision: "older",
      commands: [],
    };
    const diagnostics = {
      logger: new StructuredLogger(undefined, (line) => lines.push(line)),
      requestId: "conflict-1",
    };
    await expect(service.save("did:plc:alice", candidate, diagnostics)).rejects.toBeInstanceOf(
      CloudConfigConflictError,
    );
    missing = true;
    await expect(service.save("did:plc:alice", candidate, diagnostics)).rejects.toBeInstanceOf(
      CloudConfigConflictError,
    );
    expect(writes).toBe(0);
    expect(lines.some((line) => JSON.parse(line).event === "cloud.pds.save-conflict")).toBe(true);
  });
  test("first save can toggle enabled with no command or media records", async () => {
    const calls: any[] = [];
    const missing = Object.assign(new Error("RecordNotFound"), { status: 400 });
    const agent: any = {
      com: {
        atproto: {
          sync: {
            getLatestCommit: async () => ({ data: { cid: "bafyhead" } }),
          },
          repo: {
            getRecord: async () => {
              throw missing;
            },
            listRecords: async () => ({ data: { records: [] } }),
            applyWrites: async (input: any) => {
              calls.push(input);
              return { data: {} };
            },
          },
        },
      },
      uploadBlob: async () => ({ data: { blob: {} } }),
    };
    const service = new PdsService(
      { restore: async () => ({}) } as any,
      "invalid.streamoverlay.dev",
      0,
      0,
      { agent: () => agent },
    );
    const saved = await service.save("did:plc:alice", {
      enabled: false,
      streamerDid: "did:plc:alice",
      revision: "new",
      commands: [],
    });
    expect(saved.enabled).toBe(false);
    expect(calls[0].writes).toHaveLength(1);
    expect(calls[0].writes[0].$type).toBe("com.atproto.repo.applyWrites#create");
  });
  test("uploads GIF bytes with the normalized SDK request shape", async () => {
    const calls: any[] = [];
    const blob = {
      $type: "blob",
      ref: { $link: "bafygif" },
      mimeType: "image/gif",
      size: 4,
    };
    const agent: any = {
      com: {},
      uploadBlob: async (bytes: Uint8Array, options: unknown) => {
        calls.push({ bytes, options });
        return { data: { blob } };
      },
    };
    const service = new PdsService(
      { restore: async () => ({}) } as any,
      "invalid.streamoverlay.dev",
      0,
      0,
      { agent: () => agent },
    );
    expect(
      (await service.upload(
        "did:plc:alice",
        new Uint8Array([1, 2, 3, 4]),
        "image/gif; charset=binary",
      )) as any,
    ).toEqual(blob);
    expect(calls[0].options).toEqual({ encoding: "image/gif" });
  });
  test("sends GIF bytes through the real SDK XRPC transport and logs correlated stages", async () => {
    const calls: any[] = [],
      lines: string[] = [];
    const cid = "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i";
    const agent = new Agent({
      did: "did:plc:alice",
      fetchHandler: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: init?.body,
        });
        return Response.json({
          blob: {
            $type: "blob",
            ref: { $link: cid },
            mimeType: "image/gif",
            size: 4,
          },
        });
      },
    } as any);
    const service = new PdsService(
      { restore: async () => ({}) } as any,
      "invalid.streamoverlay.dev",
      0,
      0,
      { agent: () => agent },
    );
    const logger = new StructuredLogger(undefined, (line) => lines.push(line));
    const blob = await service.upload(
      "did:plc:alice",
      new Uint8Array([71, 73, 70, 56]),
      "image/gif",
      { logger, requestId: "request-1" },
    );
    expect(blob.mimeType).toBe("image/gif");
    expect(calls[0].url).toContain("/xrpc/com.atproto.repo.uploadBlob");
    expect(calls[0].headers.get("content-type")).toBe("image/gif");
    expect(new Uint8Array(await new Response(calls[0].body).arrayBuffer())).toEqual(
      new Uint8Array([71, 73, 70, 56]),
    );
    expect(lines.map((line) => JSON.parse(line).event)).toEqual([
      "cloud.pds.session-restore-started",
      "cloud.pds.session-restore-completed",
      "cloud.pds.upload-started",
      "cloud.pds.upload-completed",
    ]);
  });
});
