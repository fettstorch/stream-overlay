import type { CloudModuleSettings } from "./cloud-settings.ts";
import type {
  CloudCommand,
  EmoticonModerationRule,
} from "../../../modules/emoticons/src/cloud-contracts.ts";

/** Account configuration delivered to admins and overlays; not an ATProto record. */
export type CloudConfig = CloudModuleSettings & {
  bot?: import("../../../modules/bot/src/config.ts").BotSettings;
  enabled: boolean;
  streamerDid: string;
  commands: CloudCommand[];
  eventMappings?: import("../../../modules/emoticons/src/events.ts").EmoteEventMapping[];
  moderation?: EmoticonModerationRule[];
  roles?: import("../../../modules/emoticons/src/roles.ts").CommandRoles;
  revision: string;
  preferences?: { confirmDeletion: boolean };
};
