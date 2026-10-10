import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cloudIdleTimeout,
  cloudWebSocketKeepalive,
  createDependencies,
  handleRequest,
} from "../src/server.ts";
import { sessionCookie } from "../src/auth.ts";
import { ChatPermissionRequiredError, CloudConfigConflictError, CloudConfigMissingError } from "../src/pds.ts";
import { StructuredLogger } from "../src/logger.ts";
import { JsonStore } from "../src/store.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function webRoot() {
  const root = mkdtempSync(join(tmpdir(), "stream-overlay-web-"));
  roots.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<h1>Admin</h1>");
  writeFileSync(join(root, "cloud-admin.html"), "<h1>Admin</h1>");
  writeFileSync(join(root, "assets/app.js"), "console.log('ready')");
  return root;
}

describe("cloud server boundary", () => {
  test("serves new Emotes paths and legacy OBS aliases from the same pages", async () => {
    const root = webRoot();
    writeFileSync(join(root, "effect.html"), "<h1>Emotes overlay</h1>");
    writeFileSync(join(root, "board.html"), "<h1>Emotes listings</h1>");
    const deps = dependencies(root);
    for (const [path, heading] of [["/emotes/", "Emotes overlay"], ["/effect/", "Emotes overlay"], ["/emote-listings/", "Emotes listings"], ["/board/", "Emotes listings"]]) {
      const response = await handleRequest(new Request(`https://overlay.example${path}?did=did:plc:alice`), deps);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`<h1>${heading}</h1>`);
    }
  });
  test("user chat requires owner cookie and origin, validates text and explains permission failures", async () => {
    const deps = dependencies(webRoot()), calls: unknown[] = [];
    deps.pds.sendChat = async (...args) => { calls.push(args); return "at://sent"; };
    const url = "https://overlay.example/api/accounts/did:plc:alice/chat/message";
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const send = (text: unknown, origin = deps.origin, auth = cookie) => handleRequest(new Request(url, {
      method: "POST", headers: { Origin: origin, Cookie: `stream_overlay_session=${auth}` }, body: JSON.stringify({ text }),
    }), deps);
    expect((await send("hi", "https://evil.example")).status).toBe(403);
    expect((await send("hi", deps.origin, await sessionCookie("did:plc:other", deps.secret))).status).toBe(401);
    for (const text of ["", "a".repeat(301), null]) expect((await send(text)).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect((await send(" !hi ")).status).toBe(200);
    expect((calls[0] as any[]).slice(0, 2)).toEqual(["did:plc:alice", "!hi"]);
    deps.pds.sendChat = async () => { throw new ChatPermissionRequiredError(); };
    const rejected = await send("hi");
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).error).toBe("chat-permission-required");
    expect(deps.oauth.clientMetadata.scope).toContain("repo:place.stream.chat.message");
  });
  test("bot source URL is owner-only and trigger requires its scoped token", async () => {
    const deps = dependencies(webRoot());
    const root = "https://overlay.example/api/accounts/did:plc:alice/bot";
    expect((await handleRequest(new Request(`${root}/source`), deps)).status).toBe(401);
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const source = await handleRequest(new Request(`${root}/source`, { headers: { Cookie: `stream_overlay_session=${cookie}` } }), deps);
    expect(source.status).toBe(200);
    const url = new URL((await source.json()).url);
    expect(url.pathname).toBe("/bot/"); expect(url.searchParams.get("did")).toBe("did:plc:alice");
    expect(url.searchParams.get("token")).toHaveLength(64);
    expect((await handleRequest(new Request(`${root}/trigger`, { method: "POST", headers: { Origin: "https://overlay.example" }, body: JSON.stringify({ token: "forged", uri: "at://fake" }) }), deps)).status).toBe(403);
    expect((await handleRequest(new Request(`${root}/trigger`, { method: "POST", headers: { Origin: "https://other.example" }, body: JSON.stringify({ token: url.searchParams.get("token") }) }), deps)).status).toBe(403);
    expect((await handleRequest(new Request(`${root}/routine`, { method: "POST", headers: { Origin: deps.origin }, body: JSON.stringify({ token: "forged", routineId: "routine-1" }) }), deps)).status).toBe(403);
    const calls: unknown[] = [];
    const sourceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const post = (action: string, data: object) => handleRequest(new Request(`${root}/${action}`, {
      method: "POST", headers: { Origin: deps.origin }, body: JSON.stringify({ token: url.searchParams.get("token"), ...data }),
    }), deps);
    expect((await post("routine", { sourceId, routineId: "routine-1" })).status).toBe(409);
    expect((await (await post("lease", { sourceId })).json()).active).toBe(true);
    const standbyId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect((await (await post("lease", { sourceId: standbyId })).json()).active).toBe(false);
    expect((await post("trigger", { sourceId: standbyId, uri: "at://fake" })).status).toBe(409);
    deps.pds.publicConfig = async () => ({ streamerDid: "did:plc:alice", enabled: true, commands: [], revision: "1" });
    deps.botCommands!.routine = async (...args) => { calls.push(args); return { sent: true }; };
    const result = await handleRequest(new Request(`${root}/routine`, { method: "POST", headers: { Origin: deps.origin },
      body: JSON.stringify({ token: url.searchParams.get("token"), sourceId, routineId: "routine-1", text: "untrusted browser text" }),
    }), deps);
    expect(result.status).toBe(200);
    expect((calls[0] as unknown[])[1]).toBe("routine-1");
    expect(JSON.stringify(calls)).not.toContain("untrusted browser text");
  });
  test("Giphy browser configuration exposes only the configured key without logging it", async () => {
    const logged: unknown[] = [];
    const deps = { ...dependencies(webRoot()), giphyApiKey: "test-browser-key", logger: new StructuredLogger(undefined, entry => logged.push(entry)) };
    const response = await handleRequest(new Request("https://overlay.example/api/giphy"), deps);
    expect(await response.json()).toEqual({ apiKey: "test-browser-key" });
    expect(JSON.stringify(logged)).not.toContain("test-browser-key");
    expect(JSON.stringify(logged)).toContain("cloud.giphy.configuration");
  });
  test("blocks stale Pets files and encoded aliases unless explicitly enabled", async () => {
    const root = webRoot();
    mkdirSync(join(root, "pets/upstream"), { recursive: true });
    writeFileSync(join(root, "pets.html"), "Pets wrapper");
    writeFileSync(join(root, "pets/upstream/pets.js"), "upstream code");
    const deps = dependencies(root);
    for (const path of [
      "/pets/",
      "/pets.html",
      "/admin/pets.html",
      "/pets/upstream/pets.js",
      "/admin/%70ets/upstream/pets.js",
    ]) {
      expect(
        (await handleRequest(new Request(`https://overlay.example${path}`), deps)).status,
      ).toBe(404);
    }
    const enabled = { ...deps, enablePets: true };
    expect(
      (await handleRequest(new Request("https://overlay.example/pets/"), enabled)).status,
    ).toBe(200);
    expect(
      (await handleRequest(new Request("https://overlay.example/pets/upstream/pets.js"), enabled))
        .status,
    ).toBe(200);
  });
  test("returns HTTP 409 for stale configurations without publishing a change", async () => {
    const deps = dependencies(webRoot());
    (deps as any).pds = {
      save: async () => {
        throw new CloudConfigConflictError();
      },
    };
    deps.relay.configChanged = () => {
      throw new Error("A rejected save must not publish");
    };
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const response = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/config", {
        method: "PUT",
        headers: {
          origin: "https://overlay.example",
          cookie: `stream_overlay_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          streamerDid: "did:plc:alice",
          commands: [],
          revision: "stale",
        }),
      }),
      deps,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("configuration-changed");
  });
  test("disables HTTP/SSE and WebSocket idle deadlines while retaining automatic pings", () => {
    expect(cloudIdleTimeout).toBe(0);
    expect(cloudWebSocketKeepalive).toEqual({ idleTimeout: 0, sendPings: true });
  });
  test("keeps the real paint SSE transport open until its 15-second heartbeat", async () => {
    const deps = dependencies(webRoot());
    (deps as any).pds = {
      publicConfig: async () => ({
        enabled: true,
        streamerDid: "did:plc:alice",
        commands: [],
        revision: "1",
      }),
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: cloudIdleTimeout,
      fetch: (request) => handleRequest(request, deps),
    });
    const controller = new AbortController();
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/accounts/did%3Aplc%3Aalice/paint/events`,
        { signal: controller.signal },
      );
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"state"');
      const heartbeat = await reader.read();
      expect(heartbeat.done).toBe(false);
      expect(new TextDecoder().decode(heartbeat.value)).toContain(": keepalive");
      await reader.cancel();
    } finally {
      controller.abort();
      server.stop(true);
    }
  }, 18000);
  test("uses a temporary file locally, stdout in production, and honors file overrides", () => {
    expect(createDependencies({}).logger.filePath).toBe(
      join(tmpdir(), "stream-overlay", "cloud.log"),
    );
    expect(createDependencies({ NODE_ENV: "production" }).logger.filePath).toBeUndefined();
    expect(
      createDependencies({ NODE_ENV: "production", CLOUD_LOG_FILE: "/tmp/custom-cloud.log" }).logger
        .filePath,
    ).toBe("/tmp/custom-cloud.log");
  });
  function dependencies(webRoot: string) {
    const deps = createDependencies({
      PUBLIC_ORIGIN: "https://overlay.example",
      SESSION_SECRET: "test-secret-with-at-least-thirty-two-bytes",
      LEXICON_NAMESPACE: "com.example.streamoverlay",
      AUTH_DATA_DIR: join(webRoot, "auth"),
    });
    deps.oauth.hasStoredSession = async () => true;
    return { ...deps, webRoot, logger: new StructuredLogger(undefined, () => {}) };
  }
  test("expires stale cookies on admin session checks and mutations without touching PDS", async () => {
    const deps = dependencies(webRoot());
    const directory = join(webRoot(), "auth");
    deps.oauth = createDependencies({
      PUBLIC_ORIGIN: deps.origin,
      SESSION_SECRET: deps.secret,
      AUTH_DATA_DIR: directory,
    }).oauth;
    const stored = new JsonStore(directory, "oauth-session");
    await stored.set("did:plc:alice", { testSession: true });
    expect(await deps.oauth.hasStoredSession("did:plc:alice")).toBe(true);
    await stored.del("did:plc:alice");
    deps.pds.save = async () => {
      throw new Error("Must not write with a missing session");
    };
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    for (const [path, method] of [
      ["/api/session", "GET"],
      ["/api/accounts/did:plc:alice/config", "PUT"],
      ["/api/accounts/did:plc:alice/media", "POST"],
      ["/api/accounts/did:plc:alice/test/wave", "POST"],
    ]) {
      const response = await handleRequest(
        new Request(`https://overlay.example${path}`, {
          method,
          headers: { cookie: `stream_overlay_session=${cookie}`, origin: deps.origin },
        }),
        deps,
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe("session-expired");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
    const publicConfig = {
      enabled: true,
      streamerDid: "did:plc:alice",
      commands: [],
      revision: "1",
    };
    deps.pds.publicConfig = async () => publicConfig;
    const overlay = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/config", {
        headers: { cookie: `stream_overlay_session=${cookie}` },
      }),
      deps,
    );
    expect(overlay.status).toBe(200);
  });
  test("reports health without reading web files", async () => {
    const response = await handleRequest(
      new Request("http://localhost/health"),
      dependencies("/missing"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
  test("paint writes require the matching account session and reach only that account's SSE state", async () => {
    const deps = dependencies(webRoot());
    const did = "did:plc:alice",
      config = { enabled: true, streamerDid: did, commands: [], revision: "1" };
    (deps as any).pds = { publicConfig: async () => config };
    const url = `${deps.origin}/api/accounts/${encodeURIComponent(did)}/paint/segments`;
    const body = JSON.stringify({ segments: [{ x: 0.5, y: 0.5, fromX: 0.1, fromY: 0.1 }] });
    const headers = {
      origin: deps.origin,
      "Content-Type": "application/json",
      cookie: `stream_overlay_session=${await sessionCookie(did, deps.secret)}`,
    };
    expect(
      (
        await handleRequest(
          new Request(url, { method: "POST", body, headers: { origin: deps.origin } }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleRequest(
          new Request(url, {
            method: "POST",
            body,
            headers: { ...headers, origin: "https://evil.example" },
          }),
          deps,
        )
      ).status,
    ).toBe(403);
    const response = await handleRequest(new Request(url, { method: "POST", body, headers }), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).accepted).toBe(true);
    const sse = await handleRequest(new Request(url.replace("/segments", "/events")), deps);
    expect(sse.headers.get("content-type")).toBe("text/event-stream");
    const reader = sse.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain('"x":0.5');
    await reader.cancel();
    expect(deps.paint.service("did:plc:bob", config).service.snapshot().segments).toEqual([]);
    for (const account of [did, "did:plc:bob"])
      deps.paint.configure(account, {
        ...config,
        modules: { chat: false, paint: false, pets: false },
      });
  });

  test("authenticates command tests, validates configuration, and reports disconnected sources", async () => {
    const deps = dependencies(webRoot()),
      did = "did:plc:alice";
    let enabled = true,
      reads = 0;
    (deps as any).pds = {
      publicConfig: async () => {
        reads++;
        return { enabled, commands: [{ id: "wave", mode: "effect" }], eventMappings: [{ event: "teleport-arrival", commandId: "wave", text: "Welcome!" }] };
      },
    };
    const url = `${deps.origin}/api/accounts/${encodeURIComponent(did)}/test/wave`;
    const headers = {
      origin: deps.origin,
      cookie: `stream_overlay_session=${await sessionCookie(did, deps.secret)}`,
    };
    expect(
      (
        await handleRequest(
          new Request(url, { method: "POST", headers: { origin: deps.origin } }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleRequest(
          new Request(url, {
            method: "POST",
            headers: { ...headers, origin: "https://evil.example" },
          }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(reads).toBe(0);
    const disconnected = await handleRequest(new Request(url, { method: "POST", headers }), deps);
    expect(await disconnected.json()).toMatchObject({
      delivered: 0,
      message: expect.stringContaining("No effect source"),
    });
    const sent: string[] = [];
    deps.relay.message(
      deps.relay.open({
        send: (value: string) => {
          sent.push(value);
          return 1;
        },
      } as any),
      JSON.stringify({ type: "hello", did, page: "effect", channel: "live" }),
    );
    const connected = await handleRequest(new Request(url, { method: "POST", headers }), deps);
    expect(await connected.json()).toMatchObject({ delivered: 1 });
    expect(JSON.parse(sent.at(-1)!)).toMatchObject({
      type: "test-command",
      commandId: "wave",
      requestId: connected.headers.get("x-request-id"),
    });
    expect(
      (
        await handleRequest(
          new Request(url.replace("/wave", "/missing"), { method: "POST", headers }),
          deps,
        )
      ).status,
    ).toBe(404);
    enabled = false;
    expect((await handleRequest(new Request(url, { method: "POST", headers }), deps)).status).toBe(
      409,
    );
    expect(sent).toHaveLength(2);
    enabled = true;
    const eventTest = await handleRequest(new Request(`${url}?event=teleport-arrival`, { method: "POST", headers }), deps);
    expect(eventTest.status).toBe(200);
    expect(JSON.parse(sent.at(-1)!)).toMatchObject({ type: "test-command", commandId: "wave", eventId: "teleport-arrival", eventText: "Welcome!" });
    expect((await handleRequest(new Request(`${url}?event=stream-started`, { method: "POST", headers }), deps)).status).toBe(409);
    expect(sent).toHaveLength(3);
  });

  test("serves the user application at root with root assets and legacy asset aliases", async () => {
    const root = webRoot();
    const index = await handleRequest(new Request("http://localhost/"), dependencies(root));
    expect(index.status).toBe(200);
    expect(index.headers.get("location")).toBeNull();
    const rootAsset = await handleRequest(
      new Request("http://localhost/assets/app.js"),
      dependencies(root),
    );
    expect(await rootAsset.text()).toContain("ready");
    const asset = await handleRequest(
      new Request("http://localhost/admin/assets/app.js"),
      dependencies(root),
    );
    expect(await index.text()).toBe("<h1>Admin</h1>");
    expect(await asset.text()).toContain("ready");
    const html = await handleRequest(
      new Request("http://localhost/index.html"),
      dependencies(root),
    );
    expect(await html.text()).toBe("<h1>Admin</h1>");
  });

  test("old admin bookmarks redirect to root, preserving query parameters", async () => {
    for (const path of ["/admin", "/admin/"]) {
      const response = await handleRequest(
        new Request(`http://localhost${path}?error=oauth-start-failed`),
        dependencies(webRoot()),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("http://localhost/?error=oauth-start-failed");
    }
  });

  test("OAuth success and failures return users to root rather than an admin panel", async () => {
    const deps = dependencies(webRoot());
    deps.oauth.callback = (async () => ({ session: { did: "did:plc:alice" } })) as any;
    const callback = await handleRequest(
      new Request("https://overlay.example/oauth/callback"),
      deps,
    );
    expect(callback.headers.get("location")).toBe("/");
    expect(callback.headers.get("set-cookie")).toContain("stream_overlay_session=");
    deps.oauth.callback = async () => {
      throw new Error("fixture failure");
    };
    const failed = await handleRequest(new Request("https://overlay.example/oauth/callback"), deps);
    expect(failed.headers.get("location")).toBe(
      "https://overlay.example/?error=oauth-callback-failed",
    );
    const invalid = await handleRequest(new Request("https://overlay.example/oauth/login"), deps);
    expect(invalid.headers.get("location")).toBe(
      "https://overlay.example/?error=oauth-start-failed",
    );
    deps.oauth.authorize = async () => {
      throw new Error("fixture failure");
    };
    const rejected = await handleRequest(
      new Request("https://overlay.example/oauth/login?handle=alice.example"),
      deps,
    );
    expect(rejected.headers.get("location")).toBe(
      "https://overlay.example/?error=oauth-start-failed",
    );
  });

  test("does not expose files outside the built web directory", async () => {
    const root = webRoot();
    const response = await handleRequest(new Request("http://localhost/other"), dependencies(root));
    expect(response.status).toBe(404);
  });

  test("rejects cross-origin authenticated writes before touching the PDS", async () => {
    const root = webRoot();
    const deps = dependencies(root);
    let saved = false;
    (deps as any).pds = {
      save: async () => {
        saved = true;
      },
    };
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const response = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/config", {
        method: "PUT",
        headers: {
          origin: "https://evil.example",
          cookie: `stream_overlay_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: true, streamerDid: "did:plc:alice", commands: [] }),
      }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(saved).toBe(false);
  });

  test("routes browser-encoded DIDs for GIF uploads and configuration reads/writes", async () => {
    const deps = dependencies(webRoot()),
      did = "did:plc:alice";
    const config = { enabled: false, streamerDid: did, commands: [], revision: "test" };
    const blob = { $type: "blob", ref: { $link: "bafktest" }, mimeType: "image/gif", size: 6 };
    const uploaded: unknown[][] = [],
      saved: unknown[][] = [],
      read: string[] = [],
      lines: string[] = [];
    deps.logger = new StructuredLogger(undefined, (line) => lines.push(line));
    (deps as any).pds = {
      upload: async (...args: unknown[]) => {
        uploaded.push(args);
        return blob;
      },
      publicConfig: async (account: string) => {
        read.push(account);
        return config;
      },
      save: async (...args: unknown[]) => {
        saved.push(args);
        return config;
      },
    };
    const headers = {
      origin: deps.origin,
      cookie: `stream_overlay_session=${await sessionCookie(did, deps.secret)}`,
    };
    const base = `${deps.origin}/api/accounts/${encodeURIComponent(did)}`;
    const upload = await handleRequest(
      new Request(`${base}/media`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/gif" },
        body: new TextEncoder().encode("GIF89a"),
      }),
      deps,
    );
    expect(upload.status).toBe(200);
    expect(await upload.json()).toEqual(blob);
    expect(uploaded[0][0]).toBe(did);
    expect(uploaded[0][1]).toEqual(new TextEncoder().encode("GIF89a"));
    expect(uploaded[0][2]).toBe("image/gif");
    const load = await handleRequest(new Request(`${base}/config`), deps);
    expect(load.status).toBe(200);
    expect(await load.json()).toEqual(config);
    expect(read).toEqual([did]);
    const save = await handleRequest(
      new Request(`${base}/config`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }),
      deps,
    );
    expect(save.status).toBe(200);
    expect(saved[0][0]).toBe(did);
    expect(saved[0][1]).toEqual(config);
    expect(
      lines
        .map((line) => JSON.parse(line))
        .filter((event) => event.event === "cloud.http.request-received")
        .map((event) => event.route),
    ).toEqual(["accounts.media", "accounts.config", "accounts.config"]);
  });

  test("rejects malformed or encoded path separators without invoking the PDS", async () => {
    const deps = dependencies(webRoot());
    (deps as any).pds = {
      publicConfig: () => {
        throw new Error("must not reach PDS");
      },
    };
    for (const segment of ["did%ZZ", "did%3Aplc%3Aalice%2Fother", "not-a-did"]) {
      const response = await handleRequest(
        new Request(`${deps.origin}/api/accounts/${segment}/config`),
        deps,
      );
      expect(response.status).toBe(404);
    }
  });

  test("accepts localhost and 127.0.0.1 as the same local write origin", async () => {
    const root = webRoot();
    const deps = createDependencies({
      PUBLIC_ORIGIN: "http://127.0.0.1:3010",
      SESSION_SECRET: "test-secret-with-at-least-thirty-two-bytes",
      LEXICON_NAMESPACE: "com.example.streamoverlay",
      AUTH_DATA_DIR: join(root, "auth"),
    });
    (deps as any).pds = { save: async (_did: string, body: unknown) => body };
    deps.oauth.hasStoredSession = async () => true;
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const response = await handleRequest(
      new Request("http://localhost:3010/api/accounts/did:plc:alice/config", {
        method: "PUT",
        headers: {
          origin: "http://localhost:3010",
          cookie: `stream_overlay_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
          streamerDid: "did:plc:alice",
          revision: "old",
          commands: [],
        }),
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).enabled).toBe(false);
  });

  test("returns sanitized actionable PDS save failures", async () => {
    const root = webRoot();
    const deps = dependencies(root);
    (deps as any).pds = {
      save: async () => {
        throw Object.assign(new Error("token rejected: secret detail"), {
          status: 403,
          error: "Forbidden",
        });
      },
    };
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const response = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/config", {
        method: "PUT",
        headers: {
          origin: "https://overlay.example",
          cookie: `stream_overlay_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false, streamerDid: "did:plc:alice", commands: [] }),
      }),
      deps,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "pds-write-not-authorized",
      message: "Your ATProto session does not grant access to write these records.",
      requestId: expect.any(String),
    });
    expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  });

  test("explains missing PDS blobs without leaking upstream payloads", async () => {
    const deps = dependencies(webRoot());
    deps.pds.save = async () => {
      throw Object.assign(new Error("private upstream payload"), {
        status: 400,
        error: "BlobNotFound",
      });
    };
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const response = await handleRequest(
      new Request(`${deps.origin}/api/accounts/did:plc:alice/config`, {
        method: "PUT",
        headers: {
          origin: deps.origin,
          cookie: `stream_overlay_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false, streamerDid: "did:plc:alice", commands: [] }),
      }),
      deps,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("pds-blob-missing");
    expect(body.message).toContain("Attach it again");
    expect(JSON.stringify(body)).not.toContain("private upstream payload");
  });
  test("returns sanitized actionable media upload failures", async () => {
    const root = webRoot();
    const deps = dependencies(root);
    (deps as any).pds = {
      upload: async () => {
        throw Object.assign(new Error("token secret rejected"), {
          status: 403,
          error: "Forbidden",
        });
      },
    };
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const response = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/media", {
        method: "POST",
        headers: {
          origin: "https://overlay.example",
          cookie: `stream_overlay_session=${cookie}`,
          "content-type": "image/gif",
        },
        body: new Uint8Array([1, 2, 3]),
      }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "pds-upload-not-authorized",
      message: "Your ATProto session cannot upload media. Sign in again to grant media access.",
      requestId: expect.any(String),
    });
  });

  test("correlates upload ingress, body read, failure, and response without logging credentials", async () => {
    const root = webRoot(),
      lines: string[] = [];
    const deps = dependencies(root);
    deps.logger = new StructuredLogger(undefined, (line) => lines.push(line));
    (deps as any).pds = {
      upload: async () => {
        throw Object.assign(new Error("Bearer super-secret-token"), {
          status: 403,
          error: "Forbidden",
        });
      },
    };
    const cookie = await sessionCookie("did:plc:alice", deps.secret);
    const response = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/media?code=oauth-secret", {
        method: "POST",
        headers: {
          origin: "https://overlay.example",
          cookie: `stream_overlay_session=${cookie}`,
          authorization: "Bearer hidden",
          "content-type": "image/gif",
        },
        body: new Uint8Array([1, 2, 3]),
      }),
      deps,
    );
    const requestId = response.headers.get("x-request-id")!;
    const events = lines.map((line) => JSON.parse(line));
    expect(
      events.filter((entry) => entry.requestId === requestId).map((entry) => entry.event),
    ).toEqual([
      "cloud.http.request-received",
      "cloud.upload.request-received",
      "cloud.upload.body-read-started",
      "cloud.upload.body-read-completed",
      "cloud.upload.request-failed",
      "cloud.http.request-completed",
    ]);
    expect(lines.join("\n")).not.toContain("super-secret");
    expect(lines.join("\n")).not.toContain("oauth-secret");
    expect(lines.join("\n")).not.toContain(cookie);
  });

  test("distinguishes a missing cloud configuration from an unavailable PDS", async () => {
    const root = webRoot();
    const deps = dependencies(root);
    (deps as any).pds = {
      publicConfig: async () => {
        throw new CloudConfigMissingError();
      },
    };
    const missing = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/config"),
      deps,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "configuration-not-found" });
    (deps as any).pds = {
      publicConfig: async () => {
        throw new Error("offline");
      },
    };
    const unavailable = await handleRequest(
      new Request("https://overlay.example/api/accounts/did:plc:alice/config"),
      deps,
    );
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ error: "configuration-unavailable" });
  });

  test("separates local defaults from deploy configuration and keeps origin aligned with PORT", () => {
    expect(createDependencies({}).origin).toBe("http://127.0.0.1:3010");
    expect(createDependencies({ PORT: "4567" }).origin).toBe("http://127.0.0.1:4567");
    expect(
      createDependencies({
        PUBLIC_ORIGIN: "https://overlay.example",
        SESSION_SECRET: "test-secret-with-at-least-thirty-two-bytes",
      }).origin,
    ).toBe("https://overlay.example");
  });
});
