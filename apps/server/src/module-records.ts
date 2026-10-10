import { createHash } from "node:crypto";
import { Lexicons, jsonToLex, type LexiconDoc } from "@atproto/lexicon";
import chatSchema from "../../../lexicons/live.streamface.chat.settings.json";
import emoticonsSchema from "../../../lexicons/live.streamface.emoticons.settings.json";
import commandSchema from "../../../lexicons/live.streamface.emoticons.command.json";
import mediaSchema from "../../../lexicons/live.streamface.emoticons.defs.json";
import paintSchema from "../../../lexicons/live.streamface.paint.settings.json";
import petsSchema from "../../../lexicons/live.streamface.pets.settings.json";
import preferencesSchema from "../../../lexicons/live.streamface.preferences.json";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
import type { CloudConfig } from "../../../packages/protocol/src/cloud-config.ts";
import type { CloudCommand, CloudMedia } from "../../../modules/emoticons/src/cloud-contracts.ts";
import { validateCloudCommand } from "../../../modules/emoticons/src/validation.ts";
import { validateModeration } from "../../../modules/emoticons/src/moderation.ts";

export const STREAMFACE_NAMESPACE = "live.streamface";
export const LEGACY_NAMESPACE = "invalid.streamoverlay.dev";
export const moduleCollections = {
  preferences: preferencesSchema.id,
  chat: chatSchema.id,
  emoticons: emoticonsSchema.id,
  paint: paintSchema.id,
  pets: petsSchema.id,
  command: commandSchema.id,
};
export const lexicons = new Lexicons([
  chatSchema,
  emoticonsSchema,
  commandSchema,
  mediaSchema,
  paintSchema,
  petsSchema,
  preferencesSchema,
] as LexiconDoc[]);
export type StoredRecord = { collection: string; rkey: string; value: Record<string, any> };
export function validateRecord(record: StoredRecord) {
  if (record.value.$type !== record.collection) throw new Error("Record collection mismatch");
  if (!/^[A-Za-z0-9._:~-]{1,128}$/.test(record.rkey) || [".", ".."].includes(record.rkey))
    throw new Error("Invalid record key");
  if (record.collection !== moduleCollections.command && record.rkey !== "self")
    throw new Error("Settings must use the self record key");
  lexicons.assertValidRecord(record.collection, jsonToLex(record.value));
}
// Include every record, not only settings timestamps: outside clients may edit commands.
export function recordRevision(records: StoredRecord[]) {
  if (!records.length) return "new";
  const canonical = (value: any): any =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical(
          [...records].sort((a, b) =>
            `${a.collection}/${a.rkey}`.localeCompare(`${b.collection}/${b.rkey}`),
          ),
        ),
      ),
    )
    .digest("hex");
}
export function parseModuleRecords(did: string, records: StoredRecord[]): CloudConfig {
  for (const record of records) validateRecord(record);
  const get = (collection: string) =>
    records.find((record) => record.collection === collection)?.value;
  const chat = get(moduleCollections.chat),
    paint = get(moduleCollections.paint);
  const commands = records
    .filter((record) => record.collection === moduleCollections.command)
    .map((record) => {
      const r = record.value;
      const media = (value: any): CloudMedia | undefined =>
        value
          ? value.$type.endsWith("#uploadedMedia")
            ? { blob: value.blob }
            : value.$type.endsWith("#giphyMedia") ? { giphyId: value.id }
            : { url: value.url }
          : undefined;
      const command: CloudCommand = {
        id: record.rkey,
        command: r.command,
        mode: r.mode,
        durationSeconds: r.durationMilliseconds / 1000,
        cooldownSeconds: r.cooldownMilliseconds / 1000,
        volume: r.volumePercent / 100,
        width: r.width,
        height: r.height,
        mirrored: r.mirrored,
        ...(r.image ? { image: media(r.image) } : {}),
        ...(r.audio ? { audio: media(r.audio) } : {}),
        ...(r.video ? { video: media(r.video) } : {}),
      };
      validateCloudCommand(command);
      return command;
    });
  if (new Set(commands.map((command) => command.command)).size !== commands.length)
    throw new Error("Duplicate commands");
  const moderation = (get(moduleCollections.emoticons)?.moderation ?? []).map((rule: any) => ({
    did: rule.did, blocked: rule.blocked, cooldownSeconds: rule.cooldownMilliseconds / 1000,
    ...(rule.handle !== undefined ? { handle: rule.handle } : {}),
  }));
  validateModeration(moderation);
  return {
    ...moduleSettings({
      modules: {
        chat: chat?.enabled ?? true,
        paint: paint?.enabled ?? true,
        pets: get(moduleCollections.pets)?.enabled ?? true,
      },
      ...(chat
        ? {
            chat: {
              fadeOut: chat.topFadePercent,
              fontSize: chat.fontSize,
              backgroundColor: chat.backgroundColor,
              backgroundOpacity: chat.backgroundOpacity,
              rotationX: chat.rotationX,
              rotationY: chat.rotationY,
              perspectiveStrength: chat.perspectiveStrength,
            },
          }
        : {}),
      ...(paint
        ? { paint: { color: paint.color, decaySeconds: paint.decayMilliseconds / 1000 } }
        : {}),
    }),
    enabled: get(moduleCollections.emoticons)?.enabled ?? true,
    streamerDid: did,
    commands,
    moderation,
    revision: recordRevision(records),
    ...(get(moduleCollections.preferences)
      ? { preferences: { confirmDeletion: get(moduleCollections.preferences)!.confirmDeletion } }
      : {}),
  };
}
export function serializeModuleRecords(
  config: CloudConfig,
  previous: StoredRecord[],
  updatedAt: string,
): StoredRecord[] {
  const appearance = moduleSettings(config);
  const record = (
    collection: string,
    rkey: string,
    fields: Record<string, unknown>,
  ): StoredRecord => ({
    collection,
    rkey,
    value: {
      $type: collection,
      ...fields,
      createdAt:
        previous.find((item) => item.collection === collection && item.rkey === rkey)?.value
          .createdAt ?? updatedAt,
      updatedAt,
    },
  });
  const { fadeOut, ...chat } = appearance.chat;
  // Older clients must not erase moderation rules they do not understand.
  const moderation = config.moderation ?? parseModuleRecords(config.streamerDid, previous).moderation ?? [];
  validateModeration(moderation);
  const records = [
    record(moduleCollections.chat, "self", {
      ...chat,
      topFadePercent: fadeOut,
      enabled: appearance.modules.chat,
    }),
    record(moduleCollections.emoticons, "self", {
      enabled: config.enabled,
      moderation: moderation.map(rule => ({
        did: rule.did, blocked: rule.blocked,
        cooldownMilliseconds: Math.round(rule.cooldownSeconds * 1000),
        ...(rule.handle !== undefined ? { handle: rule.handle } : {}),
      })),
    }),
    record(moduleCollections.paint, "self", {
      color: appearance.paint.color,
      decayMilliseconds: Math.round(appearance.paint.decaySeconds * 1000),
      enabled: appearance.modules.paint,
    }),
    record(moduleCollections.pets, "self", { enabled: appearance.modules.pets }),
  ];
  const preferences =
    config.preferences ??
    previous.find((item) => item.collection === moduleCollections.preferences)?.value;
  if (preferences !== undefined) {
    records.push(
      record(moduleCollections.preferences, "self", {
        confirmDeletion: preferences.confirmDeletion,
      }),
    );
  }
  for (const command of config.commands) {
    validateCloudCommand(command);
    const media = (value: CloudMedia) =>
      value.giphyId
        ? { $type: `${mediaSchema.id}#giphyMedia`, id: value.giphyId }
        : value.blob
        ? { $type: `${mediaSchema.id}#uploadedMedia`, blob: value.blob }
        : { $type: `${mediaSchema.id}#externalMedia`, url: value.url };
    records.push(
      record(moduleCollections.command, command.id, {
        command: command.command,
        mode: command.mode,
        durationMilliseconds: Math.round(command.durationSeconds * 1000),
        cooldownMilliseconds: Math.round(command.cooldownSeconds * 1000),
        volumePercent: Math.round(command.volume * 100),
        width: command.width,
        height: command.height,
        mirrored: command.mirrored,
        ...(command.image ? { image: media(command.image) } : {}),
        ...(command.audio ? { audio: media(command.audio) } : {}),
        ...(command.video ? { video: media(command.video) } : {}),
      }),
    );
  }
  // Decode too, to enforce app semantics beyond Lexicon's structural checks.
  parseModuleRecords(config.streamerDid, records);
  return records;
}
