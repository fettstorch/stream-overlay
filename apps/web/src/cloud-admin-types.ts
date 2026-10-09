export type CloudMedia = { url?: string; blob?: unknown };
export type CloudCommand = {
  id: string;
  command: string;
  mode: "effect" | "sticker";
  image?: CloudMedia;
  audio?: CloudMedia;
  video?: CloudMedia;
  durationSeconds: number;
  cooldownSeconds: number;
  volume: number;
  width: string;
  height: string;
  mirrored: boolean;
};
export type CloudConfig = import("../../../packages/protocol/src/cloud-settings.ts").CloudModuleSettings & { enabled: boolean; streamerDid: string; revision: string; commands: CloudCommand[] };
