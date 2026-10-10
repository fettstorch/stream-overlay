import type { EmoticonModerationRule } from "./cloud-contracts.ts";
export interface EmoticonCommand {
  id: string;
  command: string;
  mode?: "effect" | "sticker";
  mirrored?: boolean;
  imageAssetId: string | null;
  audioAssetId: string | null;
  videoAssetId: string | null;
  durationSeconds: number;
  cooldownSeconds: number;
  volume: number;
  width: string;
  height: string;
  imageUrl?: string;
  imageGiphyId?: string;
  audioUrl?: string;
  videoUrl?: string;
}
export interface EmoticonAsset {
  id: string;
  filename: string;
  originalName?: string;
  kind: "image" | "audio" | "video";
  contentType: string;
  durationSeconds: number;
}
export interface EmoticonState {
  enabled: boolean;
  commands: EmoticonCommand[];
  assets: EmoticonAsset[];
  moderation?: EmoticonModerationRule[];
  cooldowns?: Record<string, { endsAt: number; durationSeconds: number }>;
}
export interface EmoticonAuthor { did?: string; avatar?: string; displayName?: string; handle?: string }
export type EmoticonEvent = { type: "state"; state: EmoticonState }
  | { type: "effect"; id: string; command: EmoticonCommand; durationSeconds: number; author?: EmoticonAuthor }
  | { type: "preview"; commandId: string }
  | { type: "clear" };
