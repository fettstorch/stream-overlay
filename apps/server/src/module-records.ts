import { validateOverlayLayout } from "../../../packages/protocol/src/overlay-layout.ts";
import { createHash } from "node:crypto";
import { Lexicons, jsonToLex, type LexiconDoc } from "@atproto/lexicon";
import chatSchema from "../../../lexicons/live.streamface.chat.settings.json";
import crystalMediaSchema from "../../../lexicons/live.streamface.pokemonCrystalMgba.media.json";
import crystalSettingsSchema from "../../../lexicons/live.streamface.pokemonCrystalMgba.settings.json";
import crystalDefsSchema from "../../../lexicons/live.streamface.pokemonCrystalMgba.defs.json";
import {
  crystalMediaDefinitions,
  validateCrystalMedia,
} from "../../../modules/pokemon-crystal/src/cloud-contracts.ts";
import customModuleSchema from "../../../lexicons/live.streamface.custommodule.json";
import {
  customModuleSettings,
  validateCustomModules,
} from "../../../modules/custom-module/src/config.ts";
import botSchema from "../../../lexicons/live.streamface.bot.settings.json";
import { defaultBotSettings, validateBotSettings } from "../../../modules/bot/src/config.ts";
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
import { validateCommandRoles } from "../../../modules/emoticons/src/roles.ts";
import { validateEventMappings } from "../../../modules/emoticons/src/events.ts";

export const STREAMFACE_NAMESPACE = "live.streamface";
export const LEGACY_NAMESPACE = "invalid.streamoverlay.dev";
// Read the retired singleton until the next save migrates it to an individual record.
const legacyCustomModuleSchema = structuredClone(customModuleSchema) as any;
legacyCustomModuleSchema.id = "live.streamface.livingroom.settings";
legacyCustomModuleSchema.defs.main.key = "literal:self";
legacyCustomModuleSchema.defs.main.record.required =
  legacyCustomModuleSchema.defs.main.record.required.filter((key: string) => key !== "name");
export const moduleCollections = {
  crystalSettings: crystalSettingsSchema.id,
  crystalMedia: crystalMediaSchema.id,
  customModule: customModuleSchema.id,
  legacyCustomModule: legacyCustomModuleSchema.id as string,
  bot: botSchema.id,
  preferences: preferencesSchema.id,
  chat: chatSchema.id,
  emoticons: emoticonsSchema.id,
  paint: paintSchema.id,
  pets: petsSchema.id,
  command: commandSchema.id,
};
export const lexicons = new Lexicons([
  crystalSettingsSchema,
  crystalMediaSchema,
  crystalDefsSchema,
  customModuleSchema,
  legacyCustomModuleSchema,
  botSchema,
  chatSchema,
  emoticonsSchema,
  commandSchema,
  mediaSchema,
  paintSchema,
  petsSchema,
  preferencesSchema,
] as LexiconDoc[]);
export type StoredRecord = { collection: string; rkey: string; value: Record<string, any> };
/** Compare persisted content independently of object key order and save timestamps. */
export function sameRecordContent(a: Record<string, unknown>, b: Record<string, unknown>) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, canonical(child)]),
          )
        : value;
  const { updatedAt: _a, ...left } = a;
  const { updatedAt: _b, ...right } = b;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export function validateRecord(record: StoredRecord) {
  if (record.value.$type !== record.collection) throw new Error("Record collection mismatch");
  if (!/^[A-Za-z0-9._:~-]{1,128}$/.test(record.rkey) || [".", ".."].includes(record.rkey))
    throw new Error("Invalid record key");
  if (
    ![
      moduleCollections.command,
      moduleCollections.customModule,
      moduleCollections.crystalMedia,
    ].includes(record.collection) &&
    record.rkey !== "self"
  )
    throw new Error("Settings must use the self record key");
  lexicons.assertValidRecord(record.collection, jsonToLex(record.value));
  if (
    record.collection === moduleCollections.preferences &&
    record.value.overlayLayout !== undefined
  )
    validateOverlayLayout(record.value.overlayLayout);
  if (record.collection === moduleCollections.crystalMedia) {
    if (!/^[1-9][0-9]{0,2}$/.test(record.rkey) || Number(record.rkey) > 251)
      throw new Error("Invalid Crystal species key");
    const media = record.value.media;
    validateCrystalMedia([
      {
        number: Number(record.rkey),
        ...(media.$type === `${crystalMediaDefinitions}#uploadedMedia`
          ? { blob: media.blob }
          : { url: media.url }),
      },
    ]);
  }
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
            : value.$type.endsWith("#giphyMedia")
              ? { giphyId: value.id }
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
    did: rule.did,
    blocked: rule.blocked,
    cooldownSeconds: rule.cooldownMilliseconds / 1000,
    ...(rule.handle !== undefined ? { handle: rule.handle } : {}),
  }));
  validateModeration(moderation);
  const roles = get(moduleCollections.emoticons)?.roles;
  // Retain schema readability for previously saved mappings, but retire these triggers.
  const eventMappings = (get(moduleCollections.emoticons)?.eventMappings ?? []).filter(
    (mapping: any) =>
      !["teleport-canceled", "stream-ended"].includes(mapping.event) &&
      commands.some((command) => command.id === mapping.commandId && command.mode === "effect"),
  );
  validateEventMappings(eventMappings);
  if (roles !== undefined) validateCommandRoles(roles);
  const storedBot = get(moduleCollections.bot);
  const bot = storedBot
    ? {
        enabled: storedBot.enabled,
        rules: storedBot.rules.map((rule: any) => ({
          command: rule.command,
          response: rule.response,
          cooldownSeconds: rule.cooldownMilliseconds / 1000,
        })),
        ...(storedBot.moderation
          ? {
              moderation: storedBot.moderation.map((rule: any) => ({
                did: rule.did,
                blocked: rule.blocked,
                cooldownSeconds: rule.cooldownMilliseconds / 1000,
                ...(rule.handle !== undefined ? { handle: rule.handle } : {}),
              })),
            }
          : {}),
        ...(storedBot.roles ? { roles: storedBot.roles } : {}),
        ...(storedBot.routines
          ? {
              routines: storedBot.routines.map((item: any) => ({
                id: item.id,
                enabled: item.enabled,
                response: item.response,
                intervalSeconds: item.intervalMilliseconds / 1000,
              })),
            }
          : {}),
      }
    : structuredClone(defaultBotSettings);
  validateBotSettings(bot);
  const customModules = records
    .filter((record) => record.collection === moduleCollections.customModule)
    .map((record) => ({
      id: record.rkey,
      name: record.value.name,
      ...customModuleSettings(record.value as any),
    }));
  const legacyModule = get(moduleCollections.legacyCustomModule);
  if (legacyModule && !customModules.some((module) => module.id === "legacy-self"))
    customModules.push({
      id: "legacy-self",
      name: "My overlay",
      ...customModuleSettings(legacyModule as any),
    });
  validateCustomModules(customModules);
  return {
    pokemonCrystalMgbaMedia: records
      .filter((record) => record.collection === moduleCollections.crystalMedia)
      .map((record) => ({
        number: Number(record.rkey),
        ...(record.value.media.$type === `${crystalMediaDefinitions}#uploadedMedia`
          ? { blob: record.value.media.blob }
          : { url: record.value.media.url }),
      })),
    ...(get(moduleCollections.crystalSettings)
      ? {
          pokemonCrystalMgbaEnabled: get(moduleCollections.crystalSettings)!.enabled ?? true,
          pokemonCrystalMgbaThoughtIntervalSeconds: get(moduleCollections.crystalSettings)!
            .thoughtIntervalSeconds,
        }
      : {}),
    customModules,
    bot,
    ...moduleSettings({
      modules: {
        chat: chat?.enabled ?? true,
        paint: paint?.enabled ?? true,
        pets: get(moduleCollections.pets)?.enabled ?? true,
      },
      ...(chat
        ? {
            chat: {
              respectUserChatColor: chat.respectUserChatColor ?? false,
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
    eventMappings,
    moderation,
    ...(roles !== undefined ? { roles } : {}),
    revision: recordRevision(records),
    ...(get(moduleCollections.preferences)
      ? {
          preferences: {
            confirmDeletion: get(moduleCollections.preferences)!.confirmDeletion,
            ...(get(moduleCollections.preferences)!.overlayLayout !== undefined
              ? { overlayLayout: get(moduleCollections.preferences)!.overlayLayout }
              : {}),
            ...(get(moduleCollections.preferences)!.vimControls !== undefined
              ? { vimControls: get(moduleCollections.preferences)!.vimControls }
              : {}),
          },
        }
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
  ): StoredRecord => {
    const old = previous.find((item) => item.collection === collection && item.rkey === rkey);
    const value = {
      $type: collection,
      ...fields,
      createdAt: old?.value.createdAt ?? updatedAt,
      updatedAt,
    };
    if (old && sameRecordContent(old.value, value)) value.updatedAt = old.value.updatedAt;
    return { collection, rkey, value };
  };
  const { fadeOut, ...chat } = appearance.chat;
  // Older clients must not erase moderation rules they do not understand.
  const moderation =
    config.moderation ?? parseModuleRecords(config.streamerDid, previous).moderation ?? [];
  validateModeration(moderation);
  const roles = config.roles ?? parseModuleRecords(config.streamerDid, previous).roles;
  const eventMappings =
    config.eventMappings ?? parseModuleRecords(config.streamerDid, previous).eventMappings ?? [];
  validateEventMappings(eventMappings);
  if (roles !== undefined) validateCommandRoles(roles);
  const records = [
    record(moduleCollections.chat, "self", {
      ...chat,
      topFadePercent: fadeOut,
      enabled: appearance.modules.chat,
    }),
    record(moduleCollections.emoticons, "self", {
      enabled: config.enabled,
      eventMappings: eventMappings.filter((mapping) =>
        config.commands.some(
          (command) => command.id === mapping.commandId && command.mode === "effect",
        ),
      ),
      ...(roles !== undefined ? { roles } : {}),
      moderation: moderation.map((rule) => ({
        did: rule.did,
        blocked: rule.blocked,
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
  // Older clients must not erase rules they do not understand. Do not create an
  // unused collection until the user configures this module.
  const bot = config.bot ?? parseModuleRecords(config.streamerDid, previous).bot!;
  const botModeration =
    bot.moderation ?? parseModuleRecords(config.streamerDid, previous).bot?.moderation;
  const botRoles = bot.roles ?? parseModuleRecords(config.streamerDid, previous).bot?.roles;
  const routines = bot.routines ?? parseModuleRecords(config.streamerDid, previous).bot?.routines;
  if (botRoles !== undefined) validateCommandRoles(botRoles);
  validateModeration(botModeration ?? []);
  validateBotSettings({ ...bot, routines });
  if (
    bot.enabled ||
    bot.rules.length ||
    routines?.length ||
    botModeration?.length ||
    botRoles ||
    previous.some((item) => item.collection === moduleCollections.bot)
  )
    records.push(
      record(moduleCollections.bot, "self", {
        enabled: bot.enabled,
        ...(botRoles ? { roles: botRoles } : {}),
        rules: bot.rules.map((rule) => ({
          command: rule.command,
          response: rule.response,
          cooldownMilliseconds: Math.round(rule.cooldownSeconds * 1000),
        })),
        ...(routines
          ? {
              routines: routines.map((item) => ({
                id: item.id,
                enabled: item.enabled,
                response: item.response,
                intervalMilliseconds: Math.round(item.intervalSeconds * 1000),
              })),
            }
          : {}),
        ...(botModeration
          ? {
              moderation: botModeration.map((rule) => ({
                did: rule.did,
                blocked: rule.blocked,
                cooldownMilliseconds: Math.round(rule.cooldownSeconds * 1000),
                ...(rule.handle !== undefined ? { handle: rule.handle } : {}),
              })),
            }
          : {}),
      }),
    );
  const customModules =
    config.customModules ?? parseModuleRecords(config.streamerDid, previous).customModules ?? [];
  const crystalMedia =
    config.pokemonCrystalMgbaMedia ??
    parseModuleRecords(config.streamerDid, previous).pokemonCrystalMgbaMedia ??
    [];
  validateCrystalMedia(crystalMedia);
  const thoughtIntervalSeconds =
    config.pokemonCrystalMgbaThoughtIntervalSeconds ??
    parseModuleRecords(config.streamerDid, previous).pokemonCrystalMgbaThoughtIntervalSeconds ??
    120;
  if (
    !Number.isInteger(thoughtIntervalSeconds) ||
    thoughtIntervalSeconds < 1 ||
    thoughtIntervalSeconds > 86400
  )
    throw new Error("Invalid thought interval");
  const crystalEnabled = config.pokemonCrystalMgbaEnabled ?? true;
  if (typeof crystalEnabled !== "boolean") throw new Error("Invalid Crystal enabled state");
  if (
    config.pokemonCrystalMgbaEnabled !== undefined ||
    config.pokemonCrystalMgbaThoughtIntervalSeconds !== undefined ||
    previous.some((item) => item.collection === moduleCollections.crystalSettings)
  )
    records.push(
      record(moduleCollections.crystalSettings, "self", {
        enabled: crystalEnabled,
        thoughtIntervalSeconds,
      }),
    );
  for (const item of crystalMedia) {
    const next = record(moduleCollections.crystalMedia, String(item.number), {
      media: item.blob
        ? { $type: `${crystalMediaDefinitions}#uploadedMedia`, blob: item.blob }
        : { $type: `${crystalMediaDefinitions}#externalMedia`, url: item.url },
    });
    records.push(next);
  }
  validateCustomModules(customModules);
  for (const module of customModules) {
    const next = record(moduleCollections.customModule, module.id, {
      name: module.name,
      ...customModuleSettings(module),
      ...(module.media ? { media: module.media.map(({ id, blob }) => ({ id, blob })) } : {}),
      ...(module.bundle ? { bundle: { name: module.bundle.name, blob: module.bundle.blob } } : {}),
    });
    records.push(next);
  }
  const previousPreferences = previous.find(
    (item) => item.collection === moduleCollections.preferences,
  )?.value;
  const preferences = config.preferences
    ? { ...previousPreferences, ...config.preferences }
    : previousPreferences;
  if (preferences !== undefined) {
    records.push(
      record(moduleCollections.preferences, "self", {
        confirmDeletion: preferences.confirmDeletion,
        ...(preferences.overlayLayout !== undefined
          ? { overlayLayout: preferences.overlayLayout }
          : {}),
        ...(preferences.vimControls !== undefined ? { vimControls: preferences.vimControls } : {}),
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
