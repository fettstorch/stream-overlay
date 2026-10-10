import { expect, test } from "bun:test";
import {
  CloudConfigConflictError,
  CloudConfigMissingError,
  PdsService,
  type CloudConfig,
} from "../src/pds.ts";
import {
  moduleCollections,
  parseModuleRecords,
  serializeModuleRecords,
  recordRevision,
  type StoredRecord,
} from "../src/module-records.ts";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";
import { StructuredLogger } from "../src/logger.ts";
import { jsonToLex, lexToJson } from "@atproto/lexicon";

const did = "did:plc:alice",
  timestamp = "2026-10-09T12:00:00.000Z";
test("custom media persists native blob references without delivery URLs, and Vim preferences survive older clients", () => {
  const blob = {
    $type: "blob" as const,
    ref: { $link: "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i" },
    mimeType: "video/mp4",
    size: 123,
  };
  const module = {
    id: "video",
    name: "Video",
    enabled: true,
    html: '<video src="streamface-media:clip"></video>',
    css: "",
    media: [{ id: "clip", blob, url: "blob:preview" }],
  };
  const records = serializeModuleRecords(
    {
      ...config,
      customModules: [module],
      preferences: { confirmDeletion: true, vimControls: true },
    },
    [],
    timestamp,
  );
  const saved = records.find((record) => record.collection === moduleCollections.customModule)!;
  expect(saved.value.media).toEqual([{ id: "clip", blob }]);
  expect(lexToJson(jsonToLex(saved.value))).toEqual(saved.value);
  const parsed = parseModuleRecords(did, records);
  expect(parsed.customModules![0].media).toEqual([{ id: "clip", blob }]);
  expect(parsed.preferences?.vimControls).toBe(true);
  const older = serializeModuleRecords(
    { ...parsed, preferences: { confirmDeletion: false } },
    records,
    timestamp,
  );
  expect(parseModuleRecords(did, older).preferences).toEqual({
    confirmDeletion: false,
    vimControls: true,
  });
  expect(() =>
    serializeModuleRecords(
      {
        ...config,
        customModules: [
          { ...module, media: [{ id: "clip", blob: { ...blob, mimeType: "image/svg+xml" } }] },
        ],
      },
      [],
      timestamp,
    ),
  ).toThrow();
});
test("public Custom Module media URLs resolve against the owning PDS", async () => {
  const blob = {
    $type: "blob" as const,
    ref: { $link: "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i" },
    mimeType: "image/png",
    size: 4,
  };
  const records = serializeModuleRecords(
    {
      ...config,
      customModules: [
        {
          id: "one",
          name: "Media",
          enabled: true,
          html: '<img src="streamface-media:pic">',
          css: "",
          media: [{ id: "pic", blob }],
        },
      ],
    },
    [],
    timestamp,
  );
  const pds = new PdsService({} as any, "live.streamface", 0, 0, {
    resolvePds: async () => "https://pds.example",
    fetch: (async (input: RequestInfo | URL) => {
      const collection = new URL(String(input)).searchParams.get("collection");
      return Response.json({
        records: records
          .filter((record) => record.collection === collection)
          .map((record) => ({
            uri: `at://${did}/${record.collection}/${record.rkey}`,
            value: record.value,
          })),
      });
    }) as typeof fetch,
  });
  const loaded = await pds.publicConfig(did);
  const url = new URL(loaded.customModules![0].media![0].url!);
  expect(url.origin).toBe("https://pds.example");
  expect(url.pathname).toBe("/xrpc/com.atproto.sync.getBlob");
  expect(url.searchParams.get("did")).toBe(did);
  expect(url.searchParams.get("cid")).toBe(blob.ref.$link);
});
test("Custom Module roundtrips and older clients do not erase its source", () => {
  const customModule = {
    id: "one",
    name: "Scoreboard",
    enabled: true,
    html: "<h1>My room</h1>",
    css: "h1 { color: red }",
  };
  const records = serializeModuleRecords(
    { ...config, customModules: [customModule] },
    [],
    timestamp,
  );
  const parsed = parseModuleRecords(did, records);
  expect(parsed.customModules).toEqual([customModule]);
  const { customModules: omitted, ...olderClient } = parsed;
  expect(
    parseModuleRecords(did, serializeModuleRecords(olderClient, records, timestamp)).customModules,
  ).toEqual([customModule]);
  expect(
    parseModuleRecords(
      did,
      serializeModuleRecords(
        { ...parsed, customModules: [{ ...customModule, enabled: false, html: "" }] },
        records,
        timestamp,
      ),
    ).customModules,
  ).toEqual([{ ...customModule, enabled: false, html: "" }]);
  expect(() =>
    serializeModuleRecords(
      { ...config, customModules: [{ ...customModule, css: "x".repeat(50001) }] },
      [],
      timestamp,
    ),
  ).toThrow();
  const legacy = records.find((record) => record.collection === moduleCollections.customModule)!;
  legacy.value.width = 1280;
  legacy.value.height = 720;
  expect(parseModuleRecords(did, records).customModules).toEqual([customModule]);
  const updated = serializeModuleRecords(
    { ...config, customModules: [customModule] },
    records,
    timestamp,
  );
  const saved = updated.find((record) => record.collection === moduleCollections.customModule)!;
  expect(saved.value.width).toBeUndefined();
  expect(saved.value.height).toBeUndefined();
});
test("custom modules have independent identities, rename, delete and migrate the retired singleton", () => {
  const first = { id: "first", name: "Score", enabled: true, html: "<h1>Score</h1>", css: "" };
  const second = { ...first, id: "second", name: "Banner", html: "<h1>Banner</h1>" };
  const records = serializeModuleRecords(
    { ...config, customModules: [first, second] },
    [],
    timestamp,
  );
  const edited = serializeModuleRecords(
    { ...config, customModules: [{ ...second, name: "Renamed" }] },
    records,
    timestamp,
  );
  expect(parseModuleRecords(did, edited).customModules).toEqual([{ ...second, name: "Renamed" }]);
  expect(
    edited
      .filter((record) => record.collection === moduleCollections.customModule)
      .map((record) => record.rkey),
  ).toEqual(["second"]);
  const legacy = {
    collection: moduleCollections.legacyCustomModule,
    rkey: "self",
    value: {
      $type: moduleCollections.legacyCustomModule,
      enabled: true,
      html: first.html,
      css: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  const migrated = parseModuleRecords(did, [legacy]);
  expect(migrated.customModules).toEqual([{ ...first, id: "legacy-self", name: "My overlay" }]);
  const saved = serializeModuleRecords(migrated, [legacy], timestamp);
  expect(saved.some((record) => record.collection === moduleCollections.legacyCustomModule)).toBe(
    false,
  );
  expect(parseModuleRecords(did, saved).customModules).toEqual(migrated.customModules);
});
test("more than 200 custom modules roundtrip and unchanged modules retain their timestamps", () => {
  const customModules = Array.from({ length: 250 }, (_, id) => ({
    id: `module-${id}`,
    name: `Module ${id}`,
    enabled: false,
    html: "",
    css: "",
  }));
  const records = serializeModuleRecords({ ...config, customModules }, [], timestamp);
  const nextTime = "2026-10-10T12:00:00.000Z";
  const next = serializeModuleRecords(
    {
      ...config,
      customModules: customModules.map((module, index) =>
        index === 0 ? { ...module, name: "Renamed" } : module,
      ),
    },
    records,
    nextTime,
  );
  expect(parseModuleRecords(did, next).customModules).toHaveLength(250);
  const modules = next.filter((record) => record.collection === moduleCollections.customModule);
  expect(modules[0].value.updatedAt).toBe(nextTime);
  expect(modules[1].value.updatedAt).toBe(timestamp);
});
test("event mappings roundtrip, survive older clients and clear on command deletion", () => {
  const eventMappings = [
    { event: "teleport-arrival" as const, commandId: "stable-key", text: "Welcome!" },
  ];
  const records = serializeModuleRecords(
    {
      ...config,
      commands: config.commands.map((command) => ({ ...command, mode: "effect" })),
      eventMappings,
    },
    [],
    timestamp,
  );
  const parsed = parseModuleRecords(did, records);
  expect(parsed.eventMappings).toEqual(eventMappings);
  const { eventMappings: omitted, ...legacy } = parsed;
  expect(
    parseModuleRecords(did, serializeModuleRecords(legacy, records, timestamp)).eventMappings,
  ).toEqual(eventMappings);
  expect(
    parseModuleRecords(did, serializeModuleRecords({ ...parsed, commands: [] }, records, timestamp))
      .eventMappings,
  ).toEqual([]);
  expect(
    parseModuleRecords(
      did,
      serializeModuleRecords({ ...parsed, eventMappings: [] }, records, timestamp),
    ).eventMappings,
  ).toEqual([]);
  expect(() =>
    serializeModuleRecords(
      { ...config, eventMappings: [{ event: "unsupported" as any, commandId: "stable-key" }] },
      [],
      timestamp,
    ),
  ).toThrow();
  const settings = records.find((record) => record.collection === moduleCollections.emoticons)!;
  settings.value.eventMappings = [
    ...eventMappings,
    { event: "teleport-canceled", commandId: "stable-key" },
    { event: "stream-ended", commandId: "stable-key" },
  ];
  expect(parseModuleRecords(did, records).eventMappings).toEqual(eventMappings);
  expect(
    parseModuleRecords(did, serializeModuleRecords({ ...config, eventMappings }, [], timestamp))
      .eventMappings,
  ).toEqual([]);
  expect(() =>
    serializeModuleRecords(
      { ...parsed, eventMappings: [{ ...eventMappings[0], text: "x".repeat(501) }] },
      records,
      timestamp,
    ),
  ).toThrow();
});
test("roles round trip separately for Bot and Emotes and survive older clients", () => {
  const roles = {
    followers: true,
    mutuals: false,
    moderators: true,
    users: [{ did: "did:plc:viewer", handle: "viewer.example" }],
  };
  const botRoles = { ...roles, followers: false, mutuals: true };
  const candidate = { ...config, roles, bot: { enabled: true, rules: [], roles: botRoles } };
  const records = serializeModuleRecords(candidate, [], timestamp);
  const parsed = parseModuleRecords(did, records);
  expect(parsed.roles).toEqual(roles);
  expect(parsed.bot?.roles).toEqual(botRoles);
  const { roles: omitted, ...legacy } = parsed;
  const updated = parseModuleRecords(
    did,
    serializeModuleRecords({ ...legacy, bot: { enabled: true, rules: [] } }, records, timestamp),
  );
  expect(updated.roles).toEqual(roles);
  expect(updated.bot?.roles).toEqual(botRoles);
});
const config: CloudConfig = {
  enabled: true,
  streamerDid: did,
  revision: "new",
  modules: { chat: true, paint: false, pets: true },
  chat: { ...defaultChatConfiguration, fadeOut: 25, fontSize: 24 },
  paint: { color: "#abcdef", decaySeconds: 3.5 },
  commands: [
    {
      id: "stable-key",
      command: "wave",
      mode: "sticker",
      image: { url: "https://cdn.example/wave.gif" },
      durationSeconds: 1.5,
      cooldownSeconds: 2.5,
      volume: 0.55,
      width: "5vw",
      height: "",
      mirrored: true,
    },
  ],
};
test("Giphy records persist only IDs and roundtrip independently of media URLs", () => {
  const records = serializeModuleRecords(
    { ...config, commands: [{ ...config.commands[0]!, image: { giphyId: "abc123" } }] },
    [],
    timestamp,
  );
  const record = records.find((item) => item.collection === moduleCollections.command)!;
  expect(record.value.image).toEqual({
    $type: "live.streamface.emoticons.defs#giphyMedia",
    id: "abc123",
  });
  expect(parseModuleRecords(did, records).commands[0]!.image).toEqual({ giphyId: "abc123" });
});
test("moderation rules roundtrip, retain fractional seconds and survive older clients", () => {
  const moderation = [
    { did: "did:plc:viewer", handle: "viewer.example", blocked: false, cooldownSeconds: 30.5 },
  ];
  const records = serializeModuleRecords({ ...config, moderation }, [], timestamp);
  expect(records[1].value.moderation[0].cooldownMilliseconds).toBe(30500);
  expect(parseModuleRecords(did, records).moderation).toEqual(moderation);
  expect(
    parseModuleRecords(did, serializeModuleRecords(config, records, timestamp)).moderation,
  ).toEqual(moderation);
  expect(
    parseModuleRecords(
      did,
      serializeModuleRecords({ ...config, moderation: [] }, records, timestamp),
    ).moderation,
  ).toEqual([]);
  for (const invalid of [
    [...moderation, ...moderation],
    [{ ...moderation[0], did: "not-a-did" }],
    [{ ...moderation[0], cooldownSeconds: -1 }],
    [{ ...moderation[0], cooldownSeconds: 86401 }],
    [{ ...moderation[0], blocked: "yes" }],
  ])
    expect(() =>
      serializeModuleRecords({ ...config, moderation: invalid as any }, [], timestamp),
    ).toThrow();
});
test("account-wide preferences roundtrip, default to confirmation and survive older clients", () => {
  const initial = serializeModuleRecords(config, [], timestamp);
  expect(parseModuleRecords(did, initial).preferences).toBeUndefined();
  const optedOut = serializeModuleRecords(
    { ...config, preferences: { confirmDeletion: false } },
    initial,
    timestamp,
  );
  expect(parseModuleRecords(did, optedOut).preferences).toEqual({ confirmDeletion: false });
  expect(optedOut.find((r) => r.collection === "live.streamface.preferences")?.rkey).toBe("self");
  expect(
    parseModuleRecords(did, serializeModuleRecords(config, optedOut, timestamp)).preferences
      ?.confirmDeletion,
  ).toBe(false);
  expect(() =>
    serializeModuleRecords(
      { ...config, preferences: { confirmDeletion: "no" as any } },
      [],
      timestamp,
    ),
  ).toThrow();
});
test("fresh accounts save without legacy records and a failed transaction does not populate the cache", async () => {
  let writes = 0;
  const agent: any = {
    com: {
      atproto: {
        sync: { getLatestCommit: async () => ({ data: { cid: "head" } }) },
        repo: {
          listRecords: async () => ({ data: { records: [] } }),
          applyWrites: async () => {
            writes++;
            throw new Error("CAS failed");
          },
        },
      },
    },
  };
  const service = new PdsService({ restore: async () => ({}) } as any, "live.streamface", 0, 0, {
    agent: () => agent,
    resolvePds: async () => "https://pds.example",
    fetch: (async (input: any) =>
      String(input).includes("getRecord")
        ? new Response("missing", { status: 404 })
        : Response.json({ records: [] })) as typeof fetch,
  });
  await expect(service.publicConfig(did)).rejects.toBeInstanceOf(CloudConfigMissingError);
  await expect(service.save(did, config)).rejects.toThrow("CAS failed");
  expect(writes).toBe(1);
  await expect(service.publicConfig(did)).rejects.toBeInstanceOf(CloudConfigMissingError);
});
test("module records validate and roundtrip units without redundant owner or command IDs", () => {
  const records = serializeModuleRecords(config, [], timestamp);
  expect(records).toHaveLength(5);
  const command = records.find((record) => record.collection === moduleCollections.command)!;
  expect(command.value.id).toBeUndefined();
  expect(command.value.streamerDid).toBeUndefined();
  expect(command.value.cooldownMilliseconds).toBe(2500);
  expect(command.value.image.$type).toBe("live.streamface.emoticons.defs#externalMedia");
  const parsed = parseModuleRecords(did, records);
  expect(parsed.commands).toEqual(config.commands);
  expect(parsed.chat).toEqual(config.chat);
  expect(parsed.paint).toEqual(config.paint);
  expect(parsed.modules).toEqual(config.modules);
  const next = serializeModuleRecords(
    { ...parsed, commands: [{ ...parsed.commands[0], command: "renamed" }] },
    records,
    "2026-10-09T12:01:00.000Z",
  );
  expect(next[4].rkey).toBe("stable-key");
  expect(next[4].value.createdAt).toBe(timestamp);
  expect(recordRevision(next)).not.toBe(parsed.revision);
  expect(recordRevision([...records].reverse())).toBe(parsed.revision);
});
test("validates schemas, units, cross-field media constraints and record keys", () => {
  const records = serializeModuleRecords(config, [], timestamp);
  for (const mutate of [
    (r: StoredRecord[]) => {
      r[4].value.durationMilliseconds = 1.5;
    },
    (r: StoredRecord[]) => {
      r[4].value.image.url = "http://cdn.example/image.gif";
    },
    (r: StoredRecord[]) => {
      r[4].value.image.$type = "live.streamface.emoticons.defs#unknown";
    },
    (r: StoredRecord[]) => {
      r[4].value.audio = r[4].value.image;
    },
    (r: StoredRecord[]) => {
      r[4].rkey = "bad/key";
    },
    (r: StoredRecord[]) => {
      r[0].value.backgroundColor = "invalid";
    },
  ]) {
    const invalid = structuredClone(records);
    mutate(invalid);
    expect(() => parseModuleRecords(did, invalid)).toThrow();
  }
});
test("uploaded blobs retain their CID without persisting hydrated playback URLs", () => {
  const blob = {
    $type: "blob" as const,
    ref: { $link: "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    mimeType: "image/gif",
    size: 12,
  };
  const records = serializeModuleRecords(
    {
      ...config,
      commands: [{ ...config.commands[0], image: { blob, url: "https://pds.example/hydrated" } }],
    },
    [],
    timestamp,
  );
  expect(records[4].value.image).toEqual({
    $type: "live.streamface.emoticons.defs#uploadedMedia",
    blob,
  });
  expect(parseModuleRecords(did, records).commands[0].image).toEqual({ blob });
  // SDK authenticated reads return Lex values; public reads return ordinary JSON.
  expect(lexToJson(jsonToLex(records[4].value))).toEqual(records[4].value);
});
test("legacy read is non-mutating; save migrates atomically and rejects stale updates", async () => {
  let records: StoredRecord[] = [],
    calls: any[] = [];
  const legacy = {
    $type: "invalid.streamoverlay.dev.settings",
    enabled: true,
    streamerDid: "did:plc:other",
    updatedAt: timestamp,
    modules: config.modules,
    chat: config.chat,
    paint: { color: "#abcdef", decayMilliseconds: 3500 },
  };
  const legacyCommand = {
    ...config.commands[0],
    $type: "invalid.streamoverlay.dev.command",
    durationMilliseconds: 1500,
    volumePercent: 55,
  };
  const lines: string[] = [];
  const list = (collection: string) =>
    records
      .filter((record) => record.collection === collection)
      .map((record) => ({ uri: `at://${did}/${collection}/${record.rkey}`, value: record.value }));
  const agent: any = {
    com: {
      atproto: {
        sync: { getLatestCommit: async () => ({ data: { cid: "head" } }) },
        repo: {
          listRecords: async ({ collection }: any) => ({ data: { records: list(collection) } }),
          applyWrites: async (input: any) => {
            calls.push(input);
            records = input.writes
              .filter((write: any) => write.value)
              .map((write: any) => ({
                collection: write.collection,
                rkey: write.rkey,
                value: write.value,
              }));
            return { data: {} };
          },
        },
      },
    },
  };
  const service = new PdsService({ restore: async () => ({}) } as any, "live.streamface", 0, 0, {
    agent: () => agent,
    resolvePds: async () => "https://pds.example",
    fetch: (async (input: any) => {
      const url = new URL(input),
        collection = url.searchParams.get("collection")!;
      return Response.json(
        url.pathname.endsWith("getRecord")
          ? { value: legacy }
          : {
              records: collection.endsWith("dev.command")
                ? [{ uri: `at://${did}/${collection}/stable-key`, value: legacyCommand }]
                : list(collection),
            },
      );
    }) as typeof fetch,
  });
  const loaded = await service.publicConfig(did);
  expect(loaded.streamerDid).toBe(did);
  expect(loaded.commands).toHaveLength(1);
  expect(calls).toHaveLength(0);
  const saved = await service.save(did, loaded, {
    logger: new StructuredLogger(undefined, (line) => lines.push(line)),
    requestId: "migration-test",
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].swapCommit).toBe("head");
  expect(calls[0]).not.toHaveProperty("validate");
  expect(
    calls[0].writes.every((write: any) => write.collection.startsWith("live.streamface.")),
  ).toBe(true);
  expect(saved.commands).toEqual(config.commands);
  expect(saved.paint).toEqual(loaded.paint);
  expect(lines.join("\n")).toContain('"migrated":true');
  expect(lines.join("\n")).toContain('"pdsValidation":"known-schemas"');
  expect(lines.join("\n")).toContain('"localValidation":true');
  expect((await service.publicConfig(did)).revision).toBe(saved.revision);
  await expect(service.save(did, loaded)).rejects.toBeInstanceOf(CloudConfigConflictError);
  records[4].value.command = "outside-edit";
  await expect(service.save(did, saved)).rejects.toBeInstanceOf(CloudConfigConflictError);
  expect(calls).toHaveLength(1);
});
