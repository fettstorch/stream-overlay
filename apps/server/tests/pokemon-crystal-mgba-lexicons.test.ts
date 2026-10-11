import { expect, test } from "bun:test";
import { Lexicons, jsonToLex, lexToJson, type LexiconDoc } from "@atproto/lexicon";
import definitions from "../../../lexicons/live.streamface.pokemonCrystalMgba.defs.json";
import schema from "../../../lexicons/live.streamface.pokemonCrystalMgba.media.json";

const lexicons = new Lexicons([definitions, schema] as LexiconDoc[]);
const timestamp = "2026-10-11T12:00:00.000Z";
const record = (media: unknown) => ({
  $type: schema.id,
  media,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const validate = (value: unknown) => lexicons.assertValidRecord(schema.id, jsonToLex(value));

test("Crystal mGBA mappings roundtrip external images and native PDS blobs", () => {
  for (const media of [
    { $type: `${definitions.id}#externalMedia`, url: "https://media.example/pikachu.gif" },
    {
      $type: `${definitions.id}#uploadedMedia`,
      blob: {
        $type: "blob",
        ref: { $link: "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i" },
        mimeType: "image/gif",
        size: 123,
      },
    },
  ]) {
    const value = record(media);
    expect(() => validate(value)).not.toThrow();
    expect(lexToJson(jsonToLex(value))).toEqual(value);
  }
});

test("Crystal mGBA mappings reject foreign union types, missing media and invalid references", () => {
  for (const media of [
    { $type: "live.streamface.emoticons.defs#externalMedia", url: "https://media.example/a.gif" },
    { $type: `${definitions.id}#externalMedia`, url: "not a URI" },
    { $type: `${definitions.id}#externalMedia`, url: `https://media.example/${"a".repeat(2048)}` },
    { $type: `${definitions.id}#uploadedMedia` },
  ]) expect(() => validate(record(media))).toThrow();
  expect(() => validate({ $type: schema.id, createdAt: timestamp, updatedAt: timestamp })).toThrow();
});

test("Crystal mGBA record declares only media and record timestamps", () => {
  expect(Object.keys(schema.defs.main.record.properties).sort()).toEqual([
    "createdAt", "media", "updatedAt",
  ]);
  expect(schema.defs.main.record.properties.media.refs.every(ref =>
    ref.includes("live.streamface.pokemonCrystalMgba.defs#"),
  )).toBe(true);
});
