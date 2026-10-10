export type BotRule = { command: string; response: string; cooldownSeconds: number };
import { validateModeration } from "../../emoticons/src/moderation.ts";
import { validateCommandRoles, type CommandRoles } from "../../emoticons/src/roles.ts";
import type { EmoticonModerationRule } from "../../emoticons/src/cloud-contracts.ts";
export type BotSettings = {
  enabled: boolean;
  rules: BotRule[];
  moderation?: EmoticonModerationRule[];
  roles?: CommandRoles;
};
export const defaultBotSettings: BotSettings = { enabled: false, rules: [] };
export function validateBotSettings(value: BotSettings) {
  if (
    !value ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.rules) ||
    value.rules.length > 50
  )
    throw new Error("Invalid bot settings");
  const names = new Set<string>();
  validateModeration(value.moderation ?? []);
  if (value.roles !== undefined) validateCommandRoles(value.roles);
  for (const rule of value.rules) {
    if (
      !rule ||
      !/^[a-z0-9_-]{1,40}$/.test(rule.command) ||
      names.has(rule.command) ||
      typeof rule.response !== "string" ||
      !rule.response.trim() ||
      rule.response.length > 250 ||
      !Number.isFinite(rule.cooldownSeconds) ||
      rule.cooldownSeconds < 5 ||
      rule.cooldownSeconds > 86400
    )
      throw new Error(
        "Invalid bot rule: use a unique command, a response up to 250 characters and a cooldown of at least 5 seconds",
      );
    names.add(rule.command);
  }
}
