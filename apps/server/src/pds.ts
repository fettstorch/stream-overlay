import { Agent, type ComAtprotoRepoApplyWrites } from "@atproto/api";
import { lexToJson } from "@atproto/lexicon";
import { createDidResolver, type NodeOAuthClient } from "@atproto/oauth-client-node";
import { safeError, type StructuredLogger } from "./logger.ts";
import {
  LEGACY_NAMESPACE,
  STREAMFACE_NAMESPACE,
  moduleCollections,
  parseModuleRecords,
  recordRevision,
  serializeModuleRecords,
  type StoredRecord,
} from "./module-records.ts";
import {
  moduleSettings,
  type CloudModuleSettings,
} from "../../../packages/protocol/src/cloud-settings.ts";

import type { CloudMedia, CloudCommand } from "../../../modules/emoticons/src/cloud-contracts.ts";
import type { CloudConfig } from "../../../packages/protocol/src/cloud-config.ts";
import { validateCloudCommand as validateCommand } from "../../../modules/emoticons/src/validation.ts";
export { validateMediaUrl } from "../../../modules/emoticons/src/validation.ts";
export type { CloudMedia, CloudCommand, CloudConfig };
type AgentLike = Pick<Agent, "com" | "uploadBlob">;
type PdsDependencies = {
  resolvePds?: typeof resolvePds;
  fetch?: typeof fetch;
  agent?: (session: Awaited<ReturnType<NodeOAuthClient["restore"]>>) => AgentLike;
};
type Diagnostics = { logger: StructuredLogger; requestId: string };
export class CloudConfigMissingError extends Error {}
export class ChatPermissionRequiredError extends Error {}
export class ChatRateLimitError extends Error {}
export class CloudConfigConflictError extends Error {
  constructor() {
    super("The configuration changed since it was loaded. Reload before saving.");
  }
}
export function collections(namespace: string) {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,}$/.test(namespace))
    throw new Error("Invalid LEXICON_NAMESPACE");
  return { settings: `${namespace}.settings`, command: `${namespace}.command` };
}
export function normalizeMediaType(value: string) {
  const type = value.split(";", 1)[0].trim().toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  if (type === "application/ogg") return "audio/ogg";
  return /^(image|audio|video)\/[a-z0-9.+-]+$/.test(type) ? type : undefined;
}
export function parseConfig(
  settings: unknown,
  records: unknown[],
  namespace: string,
): CloudConfig | null {
  if (!settings || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  if (
    s.$type !== collections(namespace).settings ||
    typeof s.enabled !== "boolean" ||
    typeof s.streamerDid !== "string" ||
    !s.streamerDid.startsWith("did:")
  )
    return null;
  const commands: CloudCommand[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (
      r.$type !== collections(namespace).command ||
      typeof r.id !== "string" ||
      typeof r.command !== "string" ||
      !/^[a-z0-9_-]{1,40}$/.test(r.command)
    )
      return null;
    const command = {
      ...r,
      durationSeconds:
        typeof r.durationMilliseconds === "number"
          ? r.durationMilliseconds / 1000
          : r.durationSeconds,
      volume: typeof r.volumePercent === "number" ? r.volumePercent / 100 : r.volume,
    } as unknown as CloudCommand;
    validateCommand(command, false);
    commands.push(command);
  }
  const settingsValue = { ...s } as CloudModuleSettings;
  const storedPaint = s.paint as
    | { color: string; decayMilliseconds?: number; decaySeconds?: number }
    | undefined;
  if (storedPaint?.decayMilliseconds !== undefined)
    settingsValue.paint = {
      color: storedPaint.color,
      decaySeconds: storedPaint.decayMilliseconds / 1000,
    };
  return {
    ...moduleSettings(settingsValue),
    enabled: s.enabled,
    streamerDid: s.streamerDid,
    commands,
    revision: typeof s.updatedAt === "string" ? s.updatedAt : "unknown",
  };
}
export async function listAllRecords(
  load: (cursor?: string) => Promise<{ records: any[]; cursor?: string }>,
  maximum = 200,
) {
  const records: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    records.push(...page.records);
    if (records.length > maximum) throw new Error("Too many command records");
    cursor = page.cursor;
  } while (cursor);
  return records;
}

export class PdsService {
  private cache = new Map<string, { config: CloudConfig; loadedAt: number; accessedAt: number }>();
  private remember(did: string, config: CloudConfig) {
    this.cleanup();
    this.cache.delete(did);
    // A public overlay URL can introduce new accounts; never grow without a bound.
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    const now = Date.now();
    this.cache.set(did, { config, loadedAt: now, accessedAt: now });
  }
  cleanup(now = Date.now()) {
    for (const [did, entry] of this.cache)
      if (now - entry.accessedAt >= 3_600_000) this.cache.delete(did);
  }
  private readonly resolvePdsFn;
  private readonly fetchFn;
  private readonly agentFactory;
  private chatAttempts = new Map<string, number>();
  async sendChat(did: string, text: string, diagnostics: Diagnostics) {
    const session = await this.oauth.restore(did);
    const { scope } = await session.getTokenInfo();
    if (!scope.split(" ").some(value => value === "repo:place.stream.chat.message" || value === "transition:generic"))
      throw new ChatPermissionRequiredError("Authorize chat posting first.");
    const now = Date.now();
    for (const [account, until] of this.chatAttempts) if (until <= now) this.chatAttempts.delete(account);
    if (this.chatAttempts.has(did) || this.chatAttempts.size >= 1000) throw new ChatRateLimitError();
    this.chatAttempts.set(did, now + 2000);
    diagnostics.logger.log("info", "cloud.chat.send-started", { requestId: diagnostics.requestId });
    const result = await this.agentFactory(session).com.atproto.repo.createRecord({
      repo: did, collection: "place.stream.chat.message",
      record: { $type: "place.stream.chat.message", text, streamer: did, createdAt: new Date(now).toISOString() },
    });
    diagnostics.logger.log("info", "cloud.chat.send-completed", { requestId: diagnostics.requestId });
    return result.data.uri;
  }
  constructor(
    private oauth: NodeOAuthClient,
    private namespace: string,
    private cacheMs = 60_000,
    private minimumRefreshMs = 15_000,
    dependencies: PdsDependencies = {},
  ) {
    this.resolvePdsFn = dependencies.resolvePds ?? resolvePds;
    this.fetchFn = dependencies.fetch ?? fetch;
    this.agentFactory = dependencies.agent ?? ((session) => new Agent(session));
  }
  private async readModuleSnapshot(
    did: string,
    load: (collection: string, cursor?: string) => Promise<{ records: any[]; cursor?: string }>,
  ) {
    const groups = await Promise.all(
      Object.values(moduleCollections).map(async (collection) =>
        (await listAllRecords((cursor) => load(collection, cursor))).map(
          (item) =>
            ({
              collection,
              rkey: item.uri.slice(item.uri.lastIndexOf("/") + 1),
              value: lexToJson(item.value) as Record<string, any>,
            }) as StoredRecord,
        ),
      ),
    );
    const records = groups.flat();
    if (records.length)
      return { records, config: parseModuleRecords(did, records), migrated: false };
    // Public legacy reads need no expanded OAuth permissions. Preserve old records as backup.
    const service = await this.resolvePdsFn(did);
    let settings: any;
    try {
      settings = await xrpc(this.fetchFn, service, "com.atproto.repo.getRecord", {
        repo: did,
        collection: `${LEGACY_NAMESPACE}.settings`,
        rkey: "self",
      });
    } catch (error) {
      if (error instanceof XrpcResponseError && [400, 404].includes(error.status))
        return { records, config: undefined, migrated: false };
      throw error;
    }
    const commands = await listAllRecords(
      async (cursor) =>
        (await xrpc(this.fetchFn, service, "com.atproto.repo.listRecords", {
          repo: did,
          collection: `${LEGACY_NAMESPACE}.command`,
          limit: "100",
          ...(cursor ? { cursor } : {}),
        })) as any,
    );
    const config = parseConfig(
      settings.value,
      commands.map((item) => item.value),
      LEGACY_NAMESPACE,
    );
    if (!config) throw new Error("Invalid legacy PDS configuration");
    const legacyRecords: StoredRecord[] = [
      { collection: `${LEGACY_NAMESPACE}.settings`, rkey: "self", value: settings.value },
      ...commands.map((item) => ({
        collection: `${LEGACY_NAMESPACE}.command`,
        rkey: item.uri.slice(item.uri.lastIndexOf("/") + 1),
        value: item.value,
      })),
    ];
    config.streamerDid = did;
    config.revision = recordRevision(legacyRecords);
    return { records, config, migrated: true };
  }
  async publicConfig(did: string, force = false) {
    this.cleanup();
    const cached = this.cache.get(did);
    if (cached) {
      cached.accessedAt = Date.now();
      this.cache.delete(did);
      this.cache.set(did, cached);
    }
    if (cached && Date.now() - cached.loadedAt < (force ? this.minimumRefreshMs : this.cacheMs))
      return cached.config;
    try {
      const service = await this.resolvePdsFn(did);
      if (this.namespace === STREAMFACE_NAMESPACE) {
        const snapshot = await this.readModuleSnapshot(
          did,
          async (collection, cursor) =>
            (await xrpc(this.fetchFn, service, "com.atproto.repo.listRecords", {
              repo: did,
              collection,
              limit: "100",
              ...(cursor ? { cursor } : {}),
            })) as any,
        );
        if (!snapshot.config) throw new CloudConfigMissingError("Cloud configuration not found");
        for (const command of snapshot.config.commands)
          for (const media of [command.image, command.audio, command.video])
            if (media?.blob) media.url = blobUrl(service, did, media.blob);
        this.remember(did, snapshot.config);
        return snapshot.config;
      }
      const c = collections(this.namespace);
      const [settings, commandRecords] = await Promise.all([
        xrpc(this.fetchFn, service, "com.atproto.repo.getRecord", {
          repo: did,
          collection: c.settings,
          rkey: "self",
        }).catch((error) => {
          if (error instanceof XrpcResponseError && [400, 404].includes(error.status))
            throw new CloudConfigMissingError("Cloud configuration not found");
          throw error;
        }),
        listAllRecords(async (cursor) => {
          const page = (await xrpc(this.fetchFn, service, "com.atproto.repo.listRecords", {
            repo: did,
            collection: c.command,
            limit: "100",
            ...(cursor ? { cursor } : {}),
          })) as any;
          return { records: page.records ?? [], cursor: page.cursor };
        }),
      ]);
      const parsed = parseConfig(
        (settings as any).value,
        commandRecords.map((item: any) => item.value),
        this.namespace,
      );
      if (!parsed) throw new Error("Invalid PDS configuration");
      parsed.streamerDid = did;
      for (const command of parsed.commands)
        for (const media of [command.image, command.audio, command.video])
          if (media?.blob && !media.url) media.url = blobUrl(service, did, media.blob);
      this.remember(did, parsed);
      return parsed;
    } catch (error) {
      if (cached) return cached.config;
      throw error;
    }
  }
  async save(did: string, config: CloudConfig, diagnostics?: Diagnostics) {
    if (
      !config ||
      typeof config.enabled !== "boolean" ||
      typeof config.revision !== "string" ||
      !Array.isArray(config.commands)
    )
      throw new Error("Invalid configuration");
    for (const command of config.commands) validateCommand(command);
    if (
      new Set(config.commands.map((command) => command.id)).size !== config.commands.length ||
      new Set(config.commands.map((command) => command.command)).size !== config.commands.length
    )
      throw new Error("Duplicate commands");
    diagnostics?.logger.log("info", "cloud.pds.session-restore-started", {
      requestId: diagnostics.requestId,
      operation: "save",
    });
    let session;
    try {
      session = await this.oauth.restore(did);
      diagnostics?.logger.log("info", "cloud.pds.session-restore-completed", {
        requestId: diagnostics.requestId,
        operation: "save",
      });
    } catch (error) {
      diagnostics?.logger.log("error", "cloud.pds.session-restore-failed", {
        requestId: diagnostics.requestId,
        operation: "save",
        ...safeError(error),
      });
      throw error;
    }
    const agent = this.agentFactory(session);
    if (this.namespace === STREAMFACE_NAMESPACE)
      return this.saveModules(did, config, agent, diagnostics);
    const c = collections(this.namespace);
    const [latest, settings, existing] = await Promise.all([
      agent.com.atproto.sync.getLatestCommit({ did }),
      agent.com.atproto.repo
        .getRecord({ repo: did, collection: c.settings, rkey: "self" })
        .catch((error: any) =>
          error?.status === 400 || error?.status === 404 ? undefined : Promise.reject(error),
        ),
      listAllRecords(async (cursor) => {
        const page = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection: c.command,
          limit: 100,
          cursor,
        });
        return page.data;
      }),
    ]);
    const currentRevision = settings
      ? ((settings.data.value as { updatedAt?: string } | undefined)?.updatedAt ?? "unknown")
      : "new";
    if (config.revision !== currentRevision) {
      diagnostics?.logger.log("warn", "cloud.pds.save-conflict", {
        requestId: diagnostics.requestId,
      });
      throw new CloudConfigConflictError();
    }
    // Two saves within one millisecond must still get distinct revisions.
    const previousTime = Date.parse(currentRevision);
    const updatedAt = new Date(
      Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0),
    ).toISOString();
    config = { ...config, streamerDid: did };
    const appearance = moduleSettings(config);
    // Resolve before committing: a resolver failure must not report a successful write as failed.
    const blobService = config.commands.some((command) =>
      [command.image, command.audio, command.video].some((media) => media?.blob),
    )
      ? await this.resolvePdsFn(did)
      : undefined;
    const existingKeys = new Set(
      existing.map((record) => record.uri.slice(record.uri.lastIndexOf("/") + 1)),
    );
    const wanted = new Set(config.commands.map((command) => command.id));
    const writes: ComAtprotoRepoApplyWrites.InputSchema["writes"] = [
      {
        $type: settings
          ? "com.atproto.repo.applyWrites#update"
          : "com.atproto.repo.applyWrites#create",
        collection: c.settings,
        rkey: "self",
        value: {
          $type: c.settings,
          ...appearance,
          paint: {
            color: appearance.paint.color,
            decayMilliseconds: Math.round(appearance.paint.decaySeconds * 1000),
          },
          enabled: config.enabled,
          streamerDid: config.streamerDid,
          updatedAt,
        },
      },
    ];
    for (const rkey of existingKeys)
      if (!wanted.has(rkey))
        writes.push({
          $type: "com.atproto.repo.applyWrites#delete",
          collection: c.command,
          rkey,
        });
    for (const command of config.commands) {
      const { volume, durationSeconds, ...record } = structuredClone(command);
      for (const kind of ["image", "audio", "video"] as const)
        if (record[kind]?.blob) record[kind] = { blob: record[kind]!.blob };
      writes.push({
        $type: existingKeys.has(command.id)
          ? "com.atproto.repo.applyWrites#update"
          : "com.atproto.repo.applyWrites#create",
        collection: c.command,
        rkey: command.id,
        value: {
          $type: c.command,
          ...record,
          durationMilliseconds: Math.round(durationSeconds * 1000),
          volumePercent: Math.round(volume * 100),
          updatedAt,
        },
      });
    }
    if (writes.length > 200) throw new Error("Too many record writes");
    diagnostics?.logger.log("info", "cloud.pds.save-started", {
      requestId: diagnostics.requestId,
      writes: writes.length,
    });
    try {
      await agent.com.atproto.repo.applyWrites({
        repo: did,
        validate: false,
        swapCommit: latest.data.cid,
        writes,
      });
      diagnostics?.logger.log("info", "cloud.pds.save-completed", {
        requestId: diagnostics.requestId,
        writes: writes.length,
      });
    } catch (error) {
      diagnostics?.logger.log("error", "cloud.pds.save-failed", {
        requestId: diagnostics.requestId,
        writes: writes.length,
        ...safeError(error),
      });
      throw error;
    }
    const saved = { ...config, ...moduleSettings(config), revision: updatedAt };
    // Cached configurations must contain playable URLs immediately after saving, too.
    const hydrated = structuredClone(saved);
    if (
      hydrated.commands.some((command) =>
        [command.image, command.audio, command.video].some((media) => media?.blob),
      )
    ) {
      const service = blobService!;
      for (const command of hydrated.commands)
        for (const media of [command.image, command.audio, command.video])
          if (media?.blob) media.url = blobUrl(service, did, media.blob);
    }
    this.remember(did, hydrated);
    return hydrated;
  }
  private async saveModules(
    did: string,
    config: CloudConfig,
    agent: AgentLike,
    diagnostics?: Diagnostics,
  ) {
    const context = {
      requestId: diagnostics?.requestId,
      pdsValidation: "known-schemas",
      localValidation: true,
    };
    diagnostics?.logger.log("info", "cloud.pds.module-save-started", context);
    try {
      const latest = await agent.com.atproto.sync.getLatestCommit({ did });
      const snapshot = await this.readModuleSnapshot(
        did,
        async (collection, cursor) =>
          (await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, cursor }))
            .data,
      );
      if (config.revision !== (snapshot.config?.revision ?? "new")) {
        diagnostics?.logger.log("warn", "cloud.pds.save-conflict", context);
        throw new CloudConfigConflictError();
      }
      const latestTime = Math.max(
        0,
        ...snapshot.records.map((record) => Date.parse(record.value.updatedAt) || 0),
      );
      const updatedAt = new Date(Math.max(Date.now(), latestTime + 1)).toISOString();
      const records = serializeModuleRecords(
        { ...config, streamerDid: did },
        snapshot.records,
        updatedAt,
      );
      const service = await this.resolvePdsFn(did);
      const identity = (record: StoredRecord) => `${record.collection}/${record.rkey}`;
      const existing = new Set(snapshot.records.map(identity)),
        wanted = new Set(records.map(identity));
      const writes: ComAtprotoRepoApplyWrites.InputSchema["writes"] = records.map((record) => ({
        $type: existing.has(identity(record))
          ? "com.atproto.repo.applyWrites#update"
          : "com.atproto.repo.applyWrites#create",
        collection: record.collection,
        rkey: record.rkey,
        value: record.value,
      }));
      for (const record of snapshot.records)
        if (!wanted.has(identity(record)))
          writes.push({
            $type: "com.atproto.repo.applyWrites#delete",
            collection: record.collection,
            rkey: record.rkey,
          });
      if (writes.length > 200) throw new Error("Too many record writes");
      // Leave validation unset: Bluesky PDS only knows built-in schemas and does not
      // dynamically resolve custom lexicons yet. Local SDK validation is mandatory.
      await agent.com.atproto.repo.applyWrites({
        repo: did,
        swapCommit: latest.data.cid,
        writes,
      });
      const saved = parseModuleRecords(did, records);
      for (const command of saved.commands)
        for (const media of [command.image, command.audio, command.video])
          if (media?.blob) media.url = blobUrl(service, did, media.blob);
      this.remember(did, saved);
      diagnostics?.logger.log("info", "cloud.pds.module-save-completed", {
        ...context,
        writes: writes.length,
        migrated: snapshot.migrated,
        preferencesChanged:
          config.preferences !== undefined &&
          config.preferences.confirmDeletion !== snapshot.config?.preferences?.confirmDeletion,
        moderationRules: saved.moderation?.length ?? 0,
        moderationChanged: JSON.stringify(saved.moderation ?? []) !== JSON.stringify(snapshot.config?.moderation ?? []),
      });
      return saved;
    } catch (error) {
      diagnostics?.logger.log("error", "cloud.pds.module-save-failed", {
        ...context,
        ...safeError(error),
      });
      throw error;
    }
  }
  async upload(did: string, bytes: Uint8Array, type: string, diagnostics?: Diagnostics) {
    const normalized = normalizeMediaType(type);
    if (!bytes.byteLength) throw new Error("Empty media upload");
    if (bytes.byteLength > 10_000_000) throw new RangeError("Media is larger than 10 MB");
    if (!normalized) throw new TypeError("Unsupported media type");
    diagnostics?.logger.log("info", "cloud.pds.session-restore-started", {
      requestId: diagnostics.requestId,
      operation: "upload",
    });
    let session;
    try {
      session = await this.oauth.restore(did);
      diagnostics?.logger.log("info", "cloud.pds.session-restore-completed", {
        requestId: diagnostics.requestId,
        operation: "upload",
      });
    } catch (error) {
      diagnostics?.logger.log("error", "cloud.pds.session-restore-failed", {
        requestId: diagnostics.requestId,
        operation: "upload",
        ...safeError(error),
      });
      throw error;
    }
    const agent = this.agentFactory(session);
    diagnostics?.logger.log("info", "cloud.pds.upload-started", {
      requestId: diagnostics.requestId,
      bytes: bytes.byteLength,
      contentType: normalized,
    });
    try {
      const blob = (await agent.uploadBlob(bytes, { encoding: normalized })).data.blob;
      diagnostics?.logger.log("info", "cloud.pds.upload-completed", {
        requestId: diagnostics.requestId,
        bytes: bytes.byteLength,
        contentType: normalized,
        blobSize: blob.size,
        blobType: blob.mimeType,
      });
      return blob;
    } catch (error) {
      diagnostics?.logger.log("error", "cloud.pds.upload-failed", {
        requestId: diagnostics.requestId,
        bytes: bytes.byteLength,
        contentType: normalized,
        ...safeError(error),
      });
      throw error;
    }
  }
}
const didResolver = createDidResolver({});
async function resolvePds(did: string) {
  const document = await didResolver.resolve(did as `did:${string}:${string}`);
  const endpoint = document.service?.find((item) => item.id === "#atproto_pds")?.serviceEndpoint;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://"))
    throw new Error("PDS missing");
  return endpoint;
}
function blobUrl(service: string, did: string, blob: CloudMedia["blob"]) {
  const url = new URL("/xrpc/com.atproto.sync.getBlob", service);
  url.searchParams.set("did", did);
  url.searchParams.set("cid", blob!.ref.$link);
  return url.toString();
}
class XrpcResponseError extends Error {
  constructor(
    readonly status: number,
    method: string,
  ) {
    super(`${method} failed (${status})`);
  }
}
async function xrpc(
  fetchFn: typeof fetch,
  service: string,
  method: string,
  params: Record<string, string>,
) {
  const url = new URL(`/xrpc/${method}`, service);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchFn(url);
  if (!response.ok) throw new XrpcResponseError(response.status, method);
  return response.json();
}
