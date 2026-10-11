import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudCrystal, crystalIngestOrigin, crystalScript } from "../src/cloud-crystal.ts";
import { Relay } from "../src/realtime.ts";
import { StructuredLogger } from "../src/logger.ts";
import { parseCrystalIngest } from "../../../modules/pokemon-crystal/src/cloud-contracts.ts";
import { createDependencies, handleRequest } from "../src/server.ts";

const payload = (sequence = 1, hp = 20) => ({
  version: 1,
  session: "source-a",
  sequence,
  team: [
    {
      id: "0001-0002",
      number: 25,
      name: "PIKA",
      level: 5,
      hp,
      maxHp: 20,
      experience: 125,
      experienceAtLevel: 125,
      experienceAtNextLevel: 216,
      isEgg: false,
    },
  ],
  badges: { mask: 257 },
});
class Socket {
  sent: string[] = [];
  closed?: number;
  send(value: string) {
    this.sent.push(value);
  }
  close(code?: number) {
    this.closed = code;
  }
}
test("Crystal relays only to its account overlays, never stores or replays game state", () => {
  const relay = new Relay();
  const register = (did: string, page = "pokemon-crystal-mgba", channel = "live") => {
    const socket = new Socket();
    relay.message(relay.open(socket as any), JSON.stringify({ type: "hello", did, page, channel }));
    return socket;
  };
  const a = register("did:plc:a"),
    preview = register("did:plc:a", undefined, "preview"),
    other = register("did:plc:b"),
    effect = register("did:plc:a", "effect");
  expect(relay.crystal("did:plc:a", parseCrystalIngest(payload()).snapshot)).toBe(2);
  expect(JSON.parse(a.sent.at(-1)!)).toMatchObject({
    type: "pokemon-crystal-mgba",
    snapshot: { party: [{ hp: 20 }] },
  });
  expect(preview.sent).toHaveLength(2);
  expect(other.sent).toHaveLength(1);
  expect(effect.sent).toHaveLength(1);
  expect(relay.accounts.get("did:plc:a")!.snapshots.size).toBe(0);
  expect(register("did:plc:a").sent).toHaveLength(1);
  relay.crystal("did:plc:a", parseCrystalIngest(payload(2, 7)).snapshot);
  expect(JSON.parse(a.sent.at(-1)!).snapshot.party[0].hp).toBe(7);
});
test("private downloaded source rotates and revokes; leases retain metadata only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crystal-test-"));
  const lines: string[] = [];
  let now = 1000;
  const source = new CloudCrystal(
    directory,
    crystalIngestOrigin("http://localhost:3010"),
    new Relay(),
    new StructuredLogger(undefined, (line) => lines.push(line)),
    () => now,
  );
  const token = (script: string) => /token=([a-f0-9]{64})/.exec(script)![1]!;
  try {
    const first = await source.download("did:plc:a", "download");
    const secret = token(first),
      hash = await source.authorize("did:plc:a", secret);
    expect(hash).toBeDefined();
    expect(await source.authorize("did:plc:b", secret)).toBeUndefined();
    expect(first).not.toContain("local function atomicWrite");
    expect(first).not.toContain("io.open");
    expect(first).toContain("tostring({})");
    expect(source.relaySnapshot("did:plc:a", hash!, payload(), "ingest").status).toBe(200);
    expect(source.relaySnapshot("did:plc:a", hash!, payload(2), "ingest").status).toBe(429);
    now += 500;
    expect(
      source.relaySnapshot("did:plc:a", hash!, { ...payload(2), session: "source-b" }, "ingest")
        .status,
    ).toBe(409);
    expect(source.relaySnapshot("did:plc:a", hash!, payload(), "ingest").status).toBe(409);
    expect(source.relaySnapshot("did:plc:a", hash!, payload(2, 5), "ingest").status).toBe(200);
    expect(JSON.stringify([...(source as any).leases.values()])).not.toContain("PIKA");
    const files = await readdir(directory);
    const stored = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
    expect(stored.join("")).not.toContain(secret);
    expect(stored.join("")).not.toContain("PIKA");
    const second = await source.download("did:plc:a", "rotate");
    expect(await source.authorize("did:plc:a", secret)).toBeUndefined();
    expect(await source.authorize("did:plc:a", token(second))).toBeDefined();
    await source.revoke("did:plc:a", "revoke");
    expect(await source.authorize("did:plc:a", token(second))).toBeUndefined();
    expect(lines.join("")).not.toContain(secret);
    expect(lines.join("")).not.toContain("PIKA");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("pet witnesses authenticate a live party, expire, and are revoked with the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crystal-pet-witness-"));
  let now = 1000;
  const relay = new Relay(),
    socket = new Socket();
  relay.message(
    relay.open(socket as any),
    JSON.stringify({
      type: "hello",
      did: "did:plc:a",
      page: "pokemon-crystal-mgba",
      channel: "preview",
    }),
  );
  const source = new CloudCrystal(
    directory,
    crystalIngestOrigin("http://localhost"),
    relay,
    new StructuredLogger(undefined, () => {}),
    () => now,
  );
  try {
    const script = await source.download("did:plc:a", "download");
    const hash = await source.authorize("did:plc:a", /token=([a-f0-9]{64})/.exec(script)![1]);
    source.relaySnapshot("did:plc:a", hash!, payload(), "ingest");
    const witness = JSON.parse(socket.sent.at(-1)!).petWitness;
    expect(await source.petTarget("did:plc:a", witness, "pika")).toBe("0001-0002");
    await expect(source.petTarget("did:plc:b", witness, "PIKA")).rejects.toThrow();
    await expect(source.petTarget("did:plc:a", witness + "x", "PIKA")).rejects.toThrow();
    await expect(source.petTarget("did:plc:a", witness, "OTHER")).rejects.toThrow();
    now += 16000;
    await expect(source.petTarget("did:plc:a", witness, "PIKA")).rejects.toThrow("expired");
    now = 1000;
    await source.revoke("did:plc:a", "revoke");
    await expect(source.petTarget("did:plc:a", witness, "PIKA")).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("rejects invalid gameplay and unsafe native HTTP origins", () => {
  for (const value of [
    { ...payload(), team: Array(7).fill(payload().team[0]) },
    { ...payload(), badges: { mask: 65536 } },
    payload(1, 21),
    { ...payload(), sequence: 0 },
  ])
    expect(() => parseCrystalIngest(value)).toThrow();
  for (const origin of [
    "https://example.com",
    "http://user:secret@example.com",
    "http://example.com/path",
  ])
    expect(() => crystalIngestOrigin(origin)).toThrow();
  expect(crystalScript(new URL("http://localhost/ingest?token=test"), "session")).toContain(
    "frames % 30",
  );
});
test("real native HTTP ingest immediately reaches a real WebSocket overlay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crystal-transport-"));
  const deps = createDependencies({
    PUBLIC_ORIGIN: "http://127.0.0.1:3010",
    AUTH_DATA_DIR: directory,
  });
  deps.pds.publicConfig = async () => {
    throw new Error("No PDS calls during gameplay");
  };
  const server = Bun.serve<{ peer?: ReturnType<Relay["open"]> }>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/relay" && server.upgrade(request, { data: {} }))
        return;
      return handleRequest(request, deps);
    },
    websocket: {
      open(socket) {
        socket.data.peer = deps.relay.open(socket);
      },
      message(socket, message) {
        deps.relay.message(socket.data.peer!, String(message));
      },
      close(socket) {
        deps.relay.close(socket.data.peer!);
      },
    },
  });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/relay`);
  const next = () =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Overlay timeout")), 2000);
      ws.addEventListener(
        "message",
        (event) => {
          clearTimeout(timer);
          resolve(JSON.parse(String(event.data)));
        },
        { once: true },
      );
    });
  try {
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    const hello = next();
    ws.send(
      JSON.stringify({
        type: "hello",
        did: "did:plc:a",
        page: "pokemon-crystal-mgba",
        channel: "live",
      }),
    );
    await hello;
    const script = await deps.crystal!.download("did:plc:a", "test-download");
    const token = /token=([a-f0-9]{64})/.exec(script)![1]!;
    const received = next();
    const result = await fetch(
      `http://127.0.0.1:${server.port}/api/accounts/did:plc:a/pokemon-crystal-mgba/ingest?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(1, 8)),
      },
    );
    expect(result.status).toBe(200);
    const live = await received;
    expect(live.snapshot.party[0].hp).toBe(8);
    expect(deps.relay.accounts.get("did:plc:a")!.snapshots.size).toBe(0);
    const uri = "at://did:plc:petter/place.stream.chat.message/abc";
    const saved: unknown[] = [];
    deps.pds.crystalPetMessage = async () => ({ author: "did:plc:petter", name: "PIKA", uri });
    deps.pds.recordCrystalPet = async (...args) => { saved.push(args.slice(0, 4)); return { count: 1, duplicate: false }; };
    const petUrl = `http://127.0.0.1:${server.port}/api/accounts/did:plc:a/pokemon-crystal-mgba/pet`;
    const pet = (witness: string, origin = "http://127.0.0.1:3010") => fetch(petUrl, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ witness, uri }),
    });
    expect((await pet(live.petWitness, "https://other.example")).status).toBe(403);
    expect((await pet("forged")).status).toBe(400);
    expect(saved).toHaveLength(0);
    expect((await pet(live.petWitness)).status).toBe(200);
    expect(saved).toEqual([["did:plc:a", "0001-0002", "did:plc:petter", uri]]);
  } finally {
    ws.close();
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
