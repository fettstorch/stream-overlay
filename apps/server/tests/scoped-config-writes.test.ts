import { expect, test } from "bun:test";
import { PdsService } from "../src/pds.ts";
import {
  moduleCollections as collections,
  parseModuleRecords,
  serializeModuleRecords,
  type StoredRecord,
} from "../src/module-records.ts";
import type { CloudConfig } from "../../../packages/protocol/src/cloud-config.ts";
import { defaultChatConfiguration } from "../../../modules/chat/src/config.ts";

const did = "did:plc:scopedwrites";
const command = {
  id: "clip",
  command: "clip",
  mode: "effect" as const,
  image: { url: "https://example.test/clip.gif" },
  durationSeconds: 5,
  cooldownSeconds: 10,
  volume: 0.5,
  width: "",
  height: "",
  mirrored: false,
};
const roles = { followers: false, following: false, mutuals: false, moderators: false, users: [] };
const initial: CloudConfig = {
  streamerDid: did,
  revision: "new",
  enabled: true,
  modules: { chat: true, paint: true, pets: true },
  chat: { ...defaultChatConfiguration },
  paint: { color: "#ff0000", decaySeconds: 3 },
  commands: [command, { ...command, id: "other", command: "other" }],
  roles,
  moderation: [],
  eventMappings: [{ event: "stream-started", commandId: "clip" }],
  bot: {
    enabled: true,
    rules: [{ command: "hello", response: "Hello", cooldownSeconds: 5 }],
    routines: [{ id: "notice", response: "Notice", intervalSeconds: 60, enabled: true }],
    roles,
    moderation: [],
  },
  customModules: [
    { id: "one", name: "One", enabled: true, html: "<p>One</p>", css: "p {color:red}" },
    { id: "two", name: "Two", enabled: true, html: "<p>Two</p>", css: "" },
  ],
  pokemonCrystalMgbaEnabled: true,
  pokemonCrystalMgbaThoughtIntervalSeconds: 120,
  pokemonCrystalMgbaMedia: [
    { number: 25, url: "https://example.test/25.png" },
    { number: 133, url: "https://example.test/133.png" },
  ],
  preferences: {
    confirmDeletion: true,
    vimControls: false,
    overlayLayout: [
      {
        id: "emoticons-board",
        x: 7400,
        y: 200,
        width: 2500,
        height: 3000,
        order: 15,
        hidden: false,
      },
    ],
  },
};
function harness() {
  let records = serializeModuleRecords(structuredClone(initial), [], "2026-10-15T10:00:00.000Z");
  const calls: any[] = [];
  const list = (collection: string) =>
    records
      .filter((r) => r.collection === collection)
      .map((r) => ({
        uri: `at://${did}/${r.collection}/${r.rkey}`,
        value: JSON.parse(JSON.stringify(r.value)),
      }));
  const agent: any = {
    com: {
      atproto: {
        sync: { getLatestCommit: async () => ({ data: { cid: "head" } }) },
        repo: {
          listRecords: async ({ collection }: any) => ({ data: { records: list(collection) } }),
          applyWrites: async (input: any) => {
            calls.push(input);
            for (const write of input.writes) {
              records = records.filter(
                (r) => r.collection !== write.collection || r.rkey !== write.rkey,
              );
              if (write.value)
                records.push({
                  collection: write.collection,
                  rkey: write.rkey,
                  value: write.value,
                });
            }
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
      const url = new URL(input);
      return Response.json({ records: list(url.searchParams.get("collection")!) });
    }) as typeof fetch,
  });
  return {
    service,
    calls,
    loaded: parseModuleRecords(did, JSON.parse(JSON.stringify(records))),
    records: () => records,
  };
}
type Case = { label: string; patch: (config: CloudConfig) => void; expected: string[] };
const cases: Case[] = [];
function fields(collection: string, rkey: string, changes: Record<string, unknown>) {
  for (const [path, value] of Object.entries(changes))
    cases.push({
      label: path,
      expected: [`${collection}/${rkey}`],
      patch(config) {
        const parts = path.split(".");
        let target: any = config;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)!] = structuredClone(value);
      },
    });
}
fields(collections.emoticons, "self", {
  enabled: false,
  "roles.followers": true,
  moderation: [{ did: "did:plc:blocked", blocked: true, cooldownSeconds: 0 }],
  eventMappings: [{ event: "teleport-arrival", commandId: "clip", text: "Thanks" }],
});
fields(collections.chat, "self", {
  "modules.chat": false,
  "chat.fontSize": 32,
  "chat.fadeOut": 30,
  "chat.backgroundColor": "#112233",
  "chat.backgroundOpacity": 40,
  "chat.rotationX": 25,
  "chat.rotationY": 35,
  "chat.perspectiveStrength": 60,
});
fields(collections.paint, "self", {
  "modules.paint": false,
  "paint.color": "#123456",
  "paint.decaySeconds": 5,
});
fields(collections.pets, "self", { "modules.pets": false });
fields(collections.bot, "self", {
  "bot.enabled": false,
  "bot.rules.0.response": "Changed",
  "bot.rules.0.command": "welcome",
  "bot.rules.0.cooldownSeconds": 10,
  "bot.routines.0.enabled": false,
  "bot.routines.0.response": "Updated notice",
  "bot.routines.0.intervalSeconds": 90,
  "bot.roles.moderators": true,
  "bot.moderation": [{ did: "did:plc:blocked", blocked: true, cooldownSeconds: 0 }],
});
fields(collections.customModule, "one", {
  "customModules.0.name": "Renamed",
  "customModules.0.enabled": false,
  "customModules.0.displayMode": "page",
  "customModules.0.html": "<h1>Changed</h1>",
  "customModules.0.css": "h1 {color:blue}",
  "customModules.0.javascript": "document.body.dataset.ready = 'yes';",
  "customModules.0.bundle": { name: "app.zip", blob: { $type: "blob", ref: { $link: "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i" }, mimeType: "application/zip", size: 100 } },
});
fields(collections.crystalSettings, "self", {
  pokemonCrystalMgbaEnabled: false,
  pokemonCrystalMgbaThoughtIntervalSeconds: 60,
});
fields(collections.crystalMedia, "25", {
  "pokemonCrystalMgbaMedia.0.url": "https://example.test/new-25.png",
});
fields(collections.preferences, "self", {
  "preferences.confirmDeletion": false,
  "preferences.vimControls": true,
  "preferences.overlayLayout.0.hidden": true,
  "preferences.overlayLayout.0.order": 25,
  "preferences.overlayLayout.0.x": 7000,
  "preferences.overlayLayout.0.width": 2000,
});
fields(collections.command, "clip", {
  "commands.0.command": "renamed",
  "commands.0.image.url": "https://example.test/new.gif",
  "commands.0.durationSeconds": 7,
  "commands.0.cooldownSeconds": 20,
  "commands.0.volume": 0.75,
  "commands.0.width": "20vw",
  "commands.0.height": "20vh",
  "commands.0.mirrored": true,
});
cases.push(
  {
    label: "add command",
    patch: (c) => {
      c.commands.push({ ...command, id: "new", command: "new" });
    },
    expected: [`${collections.command}/new`],
  },
  {
    label: "delete command and its dependent event mapping",
    patch: (c) => {
      c.commands = c.commands.filter((v) => v.id !== "clip");
    },
    expected: [`${collections.command}/clip`, `${collections.emoticons}/self`],
  },
  {
    label: "delete unrelated command",
    patch: (c) => {
      c.commands = c.commands.filter((v) => v.id !== "other");
    },
    expected: [`${collections.command}/other`],
  },
  {
    label: "add custom module",
    patch: (c) => {
      c.customModules!.push({ ...c.customModules![0]!, id: "three" });
    },
    expected: [`${collections.customModule}/three`],
  },
  {
    label: "delete custom module",
    patch: (c) => {
      c.customModules = c.customModules!.filter((v) => v.id !== "one");
    },
    expected: [`${collections.customModule}/one`],
  },
  {
    label: "add Crystal artwork",
    patch: (c) => {
      c.pokemonCrystalMgbaMedia!.push({ number: 1, url: "https://example.test/1.png" });
    },
    expected: [`${collections.crystalMedia}/1`],
  },
  {
    label: "delete Crystal artwork",
    patch: (c) => {
      c.pokemonCrystalMgbaMedia = c.pokemonCrystalMgbaMedia!.filter((v) => v.number !== 25);
    },
    expected: [`${collections.crystalMedia}/25`],
  },
);
const blob = {
  $type: "blob" as const,
  ref: { $link: "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i" },
  mimeType: "image/png",
  size: 4,
};
fields(collections.command, "clip", {
  "commands.0.image": { blob },
});
fields(collections.customModule, "one", {
  "customModules.0.media": [{ id: "picture", blob }],
});
fields(collections.crystalMedia, "25", {
  "pokemonCrystalMgbaMedia.0": { number: 25, blob },
});
cases.push({
  label: "change an event clip to a sticker and remove its dependent event mapping",
  patch: (config) => {
    config.commands[0]!.mode = "sticker";
  },
  expected: [`${collections.command}/clip`, `${collections.emoticons}/self`],
});
test.each(cases)("$label writes only its owning records", async ({ patch, expected }) => {
  const h = harness(),
    before = structuredClone(h.records());
  const candidate = structuredClone(h.loaded);
  patch(candidate);
  await h.service.save(did, candidate);
  expect(h.calls).toHaveLength(1);
  const writes = h.calls[0].writes;
  expect(writes.map((w: any) => `${w.collection}/${w.rkey}`).sort()).toEqual([...expected].sort());
  for (const old of before)
    if (!expected.includes(`${old.collection}/${old.rkey}`))
      expect(
        h.records().find((r) => r.collection === old.collection && r.rkey === old.rkey),
      ).toEqual(old);
});
test("saving unchanged config makes no PDS write at all", async () => {
  const h = harness(),
    before = structuredClone(h.records());
  const saved = await h.service.save(did, structuredClone(h.loaded));
  expect(h.calls).toHaveLength(0);
  expect(h.records()).toEqual(before);
  expect(saved.revision).toBe(h.loaded.revision);
});
