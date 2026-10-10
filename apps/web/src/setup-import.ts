import type { CloudConfig, CloudMedia } from "./cloud-admin-types.ts";
import { adminFetch } from "./cloud-admin-fetch.ts";

/** Keep destination identity/revision and remap source command IDs after merging by name. */
export function mergeSetup(target: CloudConfig, source: CloudConfig): CloudConfig {
  const result = structuredClone(source);
  const commands = structuredClone(target.commands);
  const ids = new Map<string, string>();
  for (const command of result.commands) {
    const index = commands.findIndex(existing => existing.command === command.command);
    const id = index >= 0 ? commands[index].id : crypto.randomUUID();
    ids.set(command.id, id);
    const imported = { ...command, id };
    if (index >= 0) commands[index] = imported;
    else commands.push(imported);
  }
  if (commands.length > 100) throw new Error("The combined setup exceeds 100 Emote commands.");
  const rules = new Map(target.bot?.rules.map(rule => [rule.command, structuredClone(rule)]) ?? []);
  for (const rule of result.bot?.rules ?? []) rules.set(rule.command, rule);
  const routines = new Map(target.bot?.routines?.map(routine => [routine.id, structuredClone(routine)]) ?? []);
  for (const routine of result.bot?.routines ?? []) routines.set(routine.id, routine);
  if (rules.size > 50 || routines.size > 50) throw new Error("The combined setup exceeds 50 bot commands or routines.");
  return { ...result, streamerDid: target.streamerDid, revision: target.revision,
    preferences: structuredClone(target.preferences), commands,
    eventMappings: result.eventMappings?.map(mapping => ({ ...mapping, commandId: ids.get(mapping.commandId)! })),
    bot: result.bot ? { ...result.bot, rules: [...rules.values()], routines: [...routines.values()] } : target.bot,
  };
}

/** Own uploaded assets on the destination PDS; never import a foreign blob reference. */
export async function copySetupMedia(config: CloudConfig, did: string): Promise<CloudConfig> {
  const result = structuredClone(config);
  const copied = new Map<string, CloudMedia>();
  for (const command of result.commands) for (const kind of ["image", "audio", "video"] as const) {
    const media = command[kind];
    if (!media?.blob) continue;
    if (!media.url) throw new Error("An uploaded asset has no download URL.");
    const key = media.url;
    let replacement = copied.get(key);
    if (!replacement) {
      const response = await fetch(key, { credentials: "omit", signal: AbortSignal.timeout(30_000) });
      if (!response.ok || !response.body) throw new Error("Could not download an uploaded asset. Your setup has not been changed.");
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 10_000_000) throw new Error("An asset exceeds the 10 MB upload limit.");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const upload = await adminFetch(`/api/accounts/${encodeURIComponent(did)}/media`, {
        method: "POST", headers: { "Content-Type": media.blob.mimeType }, body: bytes,
      });
      if (!upload.ok) throw new Error("Could not copy media to your PDS. Your setup has not been changed.");
      replacement = { blob: await upload.json() };
      copied.set(key, replacement);
    }
    command[kind] = replacement;
  }
  return result;
}
