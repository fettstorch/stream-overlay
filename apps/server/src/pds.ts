import { Agent, type ComAtprotoRepoApplyWrites } from "@atproto/api";
import { createDidResolver, type NodeOAuthClient } from "@atproto/oauth-client-node";

export type CloudMedia = { url?: string; blob?: { $type: "blob"; ref: { $link: string }; mimeType: string; size: number } };
export type CloudCommand = { id: string; command: string; mode: "effect"|"sticker"; image?: CloudMedia; audio?: CloudMedia; video?: CloudMedia; durationSeconds: number; cooldownSeconds: number; volume: number; width: string; height: string; mirrored: boolean };
export type CloudConfig = { enabled: boolean; streamerDid: string; commands: CloudCommand[]; revision: string };
type AgentLike = Pick<Agent, "com" | "uploadBlob">;
type PdsDependencies = { resolvePds?: typeof resolvePds; fetch?: typeof fetch; agent?: (session: Awaited<ReturnType<NodeOAuthClient["restore"]>>) => AgentLike };
export class CloudConfigMissingError extends Error {}
export function collections(namespace: string) { if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(namespace)) throw new Error("Invalid LEXICON_NAMESPACE"); return { settings: `${namespace}.settings`, command: `${namespace}.command` }; }
export function validateMediaUrl(value: unknown) { if (typeof value !== "string" || value.length > 2048) return; try { const url = new URL(value); if (url.protocol !== "https:") return; return url.toString(); } catch { return; } }
export function normalizeMediaType(value: string) { const type = value.split(";", 1)[0].trim().toLowerCase(); if (type === "image/jpg") return "image/jpeg"; if (type === "application/ogg") return "audio/ogg"; return /^(image|audio|video)\/[a-z0-9.+-]+$/.test(type) ? type : undefined; }
function validateMedia(value: CloudMedia | undefined) { if (!value) return; if (value.url && value.blob) throw new Error("Media must use one source"); if (value.url) { if (!validateMediaUrl(value.url)) throw new Error("Media URLs must use HTTPS"); return; } const blob = value.blob; if (!blob || blob.$type !== "blob" || typeof blob.ref?.$link !== "string" || !/^[a-z0-9]+$/i.test(blob.ref.$link) || typeof blob.mimeType !== "string" || !/^(image|audio|video)\/[A-Za-z0-9.+-]+$/.test(blob.mimeType) || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > 10_000_000) throw new Error("Invalid media blob"); }
function validateCommand(value: CloudCommand) { if (!/^[A-Za-z0-9._~:@!$&'()*+,;=-]{1,128}$/.test(value.id) || !/^[a-z0-9_-]{1,40}$/.test(value.command) || !["effect", "sticker"].includes(value.mode)) throw new Error("Invalid command"); if (!(value.durationSeconds > 0 && value.durationSeconds <= 3600) || !(value.cooldownSeconds >= 0 && value.cooldownSeconds <= 86400) || !(value.volume >= 0 && value.volume <= 1)) throw new Error("Invalid playback settings"); if (typeof value.width !== "string" || value.width.length > 64 || typeof value.height !== "string" || value.height.length > 64 || typeof value.mirrored !== "boolean") throw new Error("Invalid display settings"); for (const media of [value.image, value.audio, value.video]) validateMedia(media); if (value.mode === "sticker" && value.audio) throw new Error("Stickers cannot include audio"); }
export function parseConfig(settings: unknown, records: unknown[], namespace: string): CloudConfig | null {
  if (!settings || typeof settings !== "object") return null; const s = settings as Record<string, unknown>;
  if (s.$type !== collections(namespace).settings || typeof s.enabled !== "boolean" || typeof s.streamerDid !== "string" || !s.streamerDid.startsWith("did:")) return null;
  const commands: CloudCommand[] = [];
  for (const raw of records) { if (!raw || typeof raw !== "object") return null; const r = raw as Record<string, unknown>;
    if (r.$type !== collections(namespace).command || typeof r.id !== "string" || typeof r.command !== "string" || !/^[a-z0-9_-]{1,40}$/.test(r.command)) return null;
    const command = { ...r, durationSeconds: typeof r.durationMilliseconds === "number" ? r.durationMilliseconds / 1000 : r.durationSeconds, volume: typeof r.volumePercent === "number" ? r.volumePercent / 100 : r.volume } as unknown as CloudCommand; validateCommand(command); commands.push(command);
  }
  return { enabled: s.enabled, streamerDid: s.streamerDid, commands, revision: typeof s.updatedAt === "string" ? s.updatedAt : "unknown" };
}
export async function listAllRecords(load: (cursor?: string) => Promise<{ records: any[]; cursor?: string }>, maximum = 200) { const records: any[] = []; let cursor: string | undefined; do { const page = await load(cursor); records.push(...page.records); if (records.length > maximum) throw new Error("Too many command records"); cursor = page.cursor; } while (cursor); return records; }

export class PdsService {
  private cache = new Map<string, { config: CloudConfig; loadedAt: number }>();
  private readonly resolvePdsFn; private readonly fetchFn; private readonly agentFactory;
  constructor(private oauth: NodeOAuthClient, private namespace: string, private cacheMs = 60_000, private minimumRefreshMs = 15_000, dependencies: PdsDependencies = {}) { this.resolvePdsFn = dependencies.resolvePds ?? resolvePds; this.fetchFn = dependencies.fetch ?? fetch; this.agentFactory = dependencies.agent ?? (session => new Agent(session)); }
  async publicConfig(did: string, force = false) { const cached = this.cache.get(did); if (cached && Date.now() - cached.loadedAt < (force ? this.minimumRefreshMs : this.cacheMs)) return cached.config;
    try { const service = await this.resolvePdsFn(did); const c = collections(this.namespace); const [settings, commandRecords] = await Promise.all([
      xrpc(this.fetchFn, service, "com.atproto.repo.getRecord", { repo: did, collection: c.settings, rkey: "self" }).catch(error => {
        if (error instanceof XrpcResponseError && [400, 404].includes(error.status)) throw new CloudConfigMissingError("Cloud configuration not found");
        throw error;
      }),
      listAllRecords(async cursor => { const page = await xrpc(this.fetchFn, service, "com.atproto.repo.listRecords", { repo: did, collection: c.command, limit: "100", ...(cursor ? { cursor } : {}) }) as any; return { records: page.records ?? [], cursor: page.cursor }; }),
    ]); const parsed = parseConfig((settings as any).value, commandRecords.map((item:any) => item.value), this.namespace); if (!parsed) throw new Error("Invalid PDS configuration"); for (const command of parsed.commands) for (const media of [command.image, command.audio, command.video]) if (media?.blob && !media.url) media.url = blobUrl(service, did, media.blob); this.cache.set(did, { config: parsed, loadedAt: Date.now() }); return parsed;
    } catch (error) { if (cached) return cached.config; throw error; }
  }
  async save(did: string, config: CloudConfig) { for (const command of config.commands) validateCommand(command); if (new Set(config.commands.map(command => command.id)).size !== config.commands.length || new Set(config.commands.map(command => command.command)).size !== config.commands.length) throw new Error("Duplicate commands"); const session = await this.oauth.restore(did); const agent = this.agentFactory(session); const c = collections(this.namespace); const updatedAt = new Date().toISOString();
    const [latest, settings, existing] = await Promise.all([
      agent.com.atproto.sync.getLatestCommit({ did }),
      agent.com.atproto.repo.getRecord({ repo: did, collection: c.settings, rkey: "self" }).catch((error: any) => error?.status === 400 || error?.status === 404 ? undefined : Promise.reject(error)),
      listAllRecords(async cursor => { const page = await agent.com.atproto.repo.listRecords({ repo: did, collection: c.command, limit: 100, cursor }); return page.data; }),
    ]);
    const existingKeys = new Set(existing.map(record => record.uri.slice(record.uri.lastIndexOf("/") + 1))); const wanted = new Set(config.commands.map(command => command.id));
    const writes: ComAtprotoRepoApplyWrites.InputSchema["writes"] = [{ $type: settings ? "com.atproto.repo.applyWrites#update" : "com.atproto.repo.applyWrites#create", collection: c.settings, rkey: "self", value: { $type: c.settings, enabled: config.enabled, streamerDid: config.streamerDid, updatedAt } }];
    for (const rkey of existingKeys) if (!wanted.has(rkey)) writes.push({ $type: "com.atproto.repo.applyWrites#delete", collection: c.command, rkey });
    for (const command of config.commands) { const { volume, durationSeconds, ...record } = command; writes.push({ $type: existingKeys.has(command.id) ? "com.atproto.repo.applyWrites#update" : "com.atproto.repo.applyWrites#create", collection: c.command, rkey: command.id, value: { $type: c.command, ...record, durationMilliseconds: Math.round(durationSeconds * 1000), volumePercent: Math.round(volume * 100), updatedAt } }); }
    if (writes.length > 200) throw new Error("Too many record writes"); await agent.com.atproto.repo.applyWrites({ repo: did, validate: false, swapCommit: latest.data.cid, writes });
    const saved = { ...config, revision: updatedAt }; this.cache.set(did, { config: saved, loadedAt: Date.now() }); return saved;
  }
  async upload(did: string, bytes: Uint8Array, type: string) { const normalized = normalizeMediaType(type); if (!bytes.byteLength) throw new Error("Empty media upload"); if (bytes.byteLength > 10_000_000) throw new RangeError("Media is larger than 10 MB"); if (!normalized) throw new TypeError("Unsupported media type"); const session = await this.oauth.restore(did); const agent = this.agentFactory(session); return (await agent.uploadBlob(bytes, { encoding: normalized })).data.blob; }
}
const didResolver = createDidResolver({});
async function resolvePds(did: string) { const document = await didResolver.resolve(did as `did:${string}:${string}`); const endpoint = document.service?.find(item => item.id === "#atproto_pds")?.serviceEndpoint; if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) throw new Error("PDS missing"); return endpoint; }
function blobUrl(service: string, did: string, blob: CloudMedia["blob"]) { const url = new URL("/xrpc/com.atproto.sync.getBlob", service); url.searchParams.set("did", did); url.searchParams.set("cid", blob!.ref.$link); return url.toString(); }
class XrpcResponseError extends Error { constructor(readonly status: number, method: string) { super(`${method} failed (${status})`); } }
async function xrpc(fetchFn: typeof fetch, service: string, method: string, params: Record<string,string>) { const url = new URL(`/xrpc/${method}`, service); for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value); const response = await fetchFn(url); if (!response.ok) throw new XrpcResponseError(response.status, method); return response.json(); }
