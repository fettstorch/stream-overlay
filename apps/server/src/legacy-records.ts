import {
  moduleSettings,
  type CloudModuleSettings,
} from "../../../packages/protocol/src/cloud-settings.ts";
import type { CloudConfig } from "../../../packages/protocol/src/cloud-config.ts";
import type { CloudCommand } from "../../../modules/emoticons/src/cloud-contracts.ts";
import { validateCloudCommand as validateCommand } from "../../../modules/emoticons/src/validation.ts";

export function collections(namespace: string) {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,}$/.test(namespace))
    throw new Error("Invalid LEXICON_NAMESPACE");
  return { settings: `${namespace}.settings`, command: `${namespace}.command` };
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
