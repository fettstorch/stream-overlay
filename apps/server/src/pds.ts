import { Agent } from "@atproto/api";
import { createDidResolver, type NodeOAuthClient } from "@atproto/oauth-client-node";

export type CloudMedia = { url?: string; blob?: { $type: "blob"; ref: { $link: string }; mimeType: string; size: number } };
export type CloudCommand = { id: string; command: string; mode: "effect"|"sticker"; image?: CloudMedia; audio?: CloudMedia; video?: CloudMedia; durationSeconds: number; cooldownSeconds: number; volume: number; width: string; height: string; mirrored: boolean };
export type CloudConfig = { enabled: boolean; streamerDid: string; commands: CloudCommand[]; revision: string };
export function collections(namespace: string) { if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(namespace)) throw new Error("Invalid LEXICON_NAMESPACE"); return { settings: `${namespace}.settings`, command: `${namespace}.command` }; }
export function validateMediaUrl(value: unknown) { if (typeof value !== "string" || value.length > 2048) return; try { const url = new URL(value); if (url.protocol !== "https:") return; return url.toString(); } catch { return; } }
function validateCommand(value: CloudCommand) { if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value.id) || !/^[a-z0-9_-]{1,40}$/.test(value.command) || !["effect", "sticker"].includes(value.mode)) throw new Error("Invalid command"); if (!(value.durationSeconds > 0 && value.durationSeconds <= 3600) || !(value.cooldownSeconds >= 0 && value.cooldownSeconds <= 86400) || !(value.volume >= 0 && value.volume <= 1)) throw new Error("Invalid playback settings"); for (const media of [value.image, value.audio, value.video]) if (media?.url && !validateMediaUrl(media.url)) throw new Error("Media URLs must use HTTPS"); if (value.mode === "sticker" && value.audio) throw new Error("Stickers cannot include audio"); }
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
export class PdsService {
  private cache = new Map<string, { config: CloudConfig; loadedAt: number }>();
  constructor(private oauth: NodeOAuthClient, private namespace: string, private cacheMs = 60_000, private minimumRefreshMs = 15_000) {}
  async publicConfig(did: string, force = false) { const cached = this.cache.get(did); if (cached && Date.now() - cached.loadedAt < (force ? this.minimumRefreshMs : this.cacheMs)) return cached.config;
    try { const service = await resolvePds(did); const c = collections(this.namespace); const [settings, commandList] = await Promise.all([
      xrpc(service, "com.atproto.repo.getRecord", { repo: did, collection: c.settings, rkey: "self" }),
      xrpc(service, "com.atproto.repo.listRecords", { repo: did, collection: c.command, limit: "100" }),
    ]); const parsed = parseConfig((settings as any).value, ((commandList as any).records ?? []).map((item:any) => item.value), this.namespace); if (!parsed) throw new Error("Invalid PDS configuration"); for (const command of parsed.commands) for (const media of [command.image, command.audio, command.video]) if (media?.blob && !media.url) media.url = blobUrl(service, did, media.blob); this.cache.set(did, { config: parsed, loadedAt: Date.now() }); return parsed;
    } catch (error) { if (cached) return cached.config; throw error; }
  }
  async save(did: string, config: CloudConfig) { for (const command of config.commands) validateCommand(command); const session = await this.oauth.restore(did); const agent = new Agent(session); const c = collections(this.namespace); const updatedAt = new Date().toISOString();
    await agent.com.atproto.repo.putRecord({ repo: did, collection: c.settings, rkey: "self", record: { $type: c.settings, enabled: config.enabled, streamerDid: config.streamerDid, updatedAt } });
    const existing = await agent.com.atproto.repo.listRecords({ repo: did, collection: c.command, limit: 100 }); const wanted = new Set(config.commands.map(command => command.id)); for (const record of existing.data.records) { const rkey = record.uri.slice(record.uri.lastIndexOf("/") + 1); if (!wanted.has(rkey)) await agent.com.atproto.repo.deleteRecord({ repo: did, collection: c.command, rkey }); }
    for (const command of config.commands) { const { volume, durationSeconds, ...record } = command; await agent.com.atproto.repo.putRecord({ repo: did, collection: c.command, rkey: command.id, record: { $type: c.command, ...record, durationMilliseconds: Math.round(durationSeconds * 1000), volumePercent: Math.round(volume * 100), updatedAt } }); }
    const saved = { ...config, revision: updatedAt }; this.cache.set(did, { config: saved, loadedAt: Date.now() }); return saved;
  }
  async upload(did: string, bytes: Uint8Array, type: string) { if (bytes.byteLength > 10_000_000 || !/^(image|audio|video)\//.test(type)) throw new Error("Unsupported media"); const session = await this.oauth.restore(did); const agent = new Agent(session); return (await agent.uploadBlob(bytes, { encoding: type })).data.blob; }
}
const didResolver = createDidResolver({});
async function resolvePds(did: string) { const document = await didResolver.resolve(did as `did:${string}:${string}`); const endpoint = document.service?.find(item => item.id === "#atproto_pds")?.serviceEndpoint; if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) throw new Error("PDS missing"); return endpoint; }
function blobUrl(service: string, did: string, blob: CloudMedia["blob"]) { const url = new URL("/xrpc/com.atproto.sync.getBlob", service); url.searchParams.set("did", did); url.searchParams.set("cid", blob!.ref.$link); return url.toString(); }
async function xrpc(service: string, method: string, params: Record<string,string>) { const url = new URL(`/xrpc/${method}`, service); for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value); const response = await fetch(url); if (!response.ok) throw new Error(`${method} failed (${response.status})`); return response.json(); }
