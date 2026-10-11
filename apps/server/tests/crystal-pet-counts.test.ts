import { expect, test } from "bun:test";
import { Lexicons, type LexiconDoc } from "@atproto/lexicon";
import { PdsService, crystalPetCollection, ChatPermissionRequiredError } from "../src/pds.ts";
import { StructuredLogger } from "../src/logger.ts";
import schema from "../../../lexicons/live.streamface.pokemonCrystalMgba.petCount.json";

const did = "did:plc:streamer",
  author = "did:plc:petter";
function fixture(
  scope = `repo:${crystalPetCollection}`,
  records = new Map<string, { cid: string; value: any }>(),
) {
  const logs: string[] = [];
  let writes = 0;
  const service = new PdsService(
    { restore: async () => ({ getTokenInfo: async () => ({ scope }) }) } as any,
    "live.streamface",
    0,
    0,
    {
      agent: () =>
        ({
          com: {
            atproto: {
              repo: {
                deleteRecord: async ({ rkey }: any) => { records.delete(rkey); },
                getRecord: async ({ rkey }: any) => {
                  const data = records.get(rkey);
                  if (!data) throw { error: "RecordNotFound" };
                  return { data };
                },
                putRecord: async ({ rkey, record, swapRecord }: any) => {
                  expect(swapRecord).toBe(records.get(rkey)?.cid ?? null);
                  new Lexicons([schema as LexiconDoc]).assertValidRecord(
                    crystalPetCollection,
                    record,
                  );
                  records.set(rkey, { cid: String(++writes), value: record });
                },
              },
            },
          },
        }) as any,
      resolvePds: async () => "https://pds.example",
      fetch: (async () =>
        Response.json({
          value: {
            $type: "place.stream.chat.message",
            streamer: did,
            text: "!pet PIKA",
            createdAt: new Date().toISOString(),
          },
        })) as unknown as typeof fetch,
    },
  );
  const diagnostics = {
    logger: new StructuredLogger(undefined, (line) => logs.push(line)),
    requestId: "pet-test",
  };
  return { service, records, logs, diagnostics };
}
test("pet counts can be individually removed and fully reset", async () => {
  const f = fixture();
  await f.service.recordCrystalPet(did, "0001-0002", author, `at://${author}/place.stream.chat.message/a`, f.diagnostics);
  await f.service.recordCrystalPet(did, "0003-0004", author, `at://${author}/place.stream.chat.message/b`, f.diagnostics);
  f.service.crystalPetCounts = async () => [...f.records.values()].map(item => ({ pokemonId: item.value.pokemonId, petterDid: item.value.petterDid, count: item.value.count }));
  expect(await f.service.removeCrystalPetCounts(did, "0001-0002", author)).toBe(1);
  expect(f.records.size).toBe(1);
  expect(await f.service.removeCrystalPetCounts(did)).toBe(1);
  expect(f.records.size).toBe(0);
});
test("pet counts deduplicate concurrent preview/OBS reports and survive service restart", async () => {
  const f = fixture();
  const uri = `at://${author}/place.stream.chat.message/a`;
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      f.service.recordCrystalPet(did, "0001-0002", author, uri, f.diagnostics),
    ),
  );
  expect(results.map((r) => r.count)).toEqual([1, 1, 1, 1]);
  expect([...f.records.values()][0]!.value.count).toBe(1);
  const restarted = fixture(`repo:${crystalPetCollection}`, f.records);
  expect(
    await restarted.service.recordCrystalPet(did, "0001-0002", author, uri, restarted.diagnostics),
  ).toEqual({ count: 1, duplicate: true });
  expect(
    await f.service.recordCrystalPet(did, "0001-0002", author, `${uri}b`, f.diagnostics),
  ).toEqual({ count: 2, duplicate: false });
  const stored = JSON.stringify([...f.records.values()]);
  expect(stored).not.toContain("PIKA");
  expect(stored).not.toContain("hp");
  expect(stored).not.toContain("badges");
  expect(f.logs.join()).toContain("cloud.crystal.pet-count-saved");
  expect(f.logs.join()).not.toContain(uri);
});
test("pet counts are separated by individual Pokémon and petter, and require dedicated permission", async () => {
  const f = fixture();
  for (const [id, petter] of [
    ["0001-0002", author],
    ["0003-0004", author],
    ["0001-0002", "did:plc:other"],
  ])
    await f.service.recordCrystalPet(
      did,
      id!,
      petter!,
      `at://${petter}/place.stream.chat.message/a`,
      f.diagnostics,
    );
  expect(f.records.size).toBe(3);
  const denied = fixture("repo:place.stream.chat.message");
  await expect(
    denied.service.recordCrystalPet(did, "0001-0002", author, "at://pet/a", denied.diagnostics),
  ).rejects.toBeInstanceOf(ChatPermissionRequiredError);
  expect(denied.records.size).toBe(0);
});
test("pet commands are independently verified from the author's PDS", async () => {
  const f = fixture();
  const uri = `at://${author}/place.stream.chat.message/a`;
  expect(await f.service.crystalPetMessage(did, uri)).toEqual({ author, name: "PIKA", uri });
  await expect(f.service.crystalPetMessage("did:plc:other", uri)).rejects.toThrow();
  await expect(f.service.crystalPetMessage(did, "https://pds.example/arbitrary")).rejects.toThrow();
});
