import type { CloudModuleSettings } from "./cloud-settings.ts";
import type { CloudCommand, EmoticonModerationRule } from "../../../modules/emoticons/src/cloud-contracts.ts";

/** Account configuration delivered to admins and overlays; not an ATProto record. */
export type CloudConfig = CloudModuleSettings & {
  enabled: boolean;
  streamerDid: string;
  commands: CloudCommand[];
  moderation?: EmoticonModerationRule[];
  revision: string;
  preferences?: { confirmDeletion: boolean };
};
