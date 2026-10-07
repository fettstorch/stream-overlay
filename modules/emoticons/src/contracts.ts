export interface EmoticonCommand {
  id: string;
  command: string;
  imageAssetId: string | null;
  audioAssetId: string | null;
  durationSeconds: number;
  cooldownSeconds: number;
  volume: number;
  width: string;
  height: string;
}
export interface EmoticonAsset {
  id: string;
  filename: string;
  originalName?: string;
  kind: "image" | "audio";
  contentType: string;
  durationSeconds: number;
}
export interface EmoticonState {
  enabled: boolean;
  commands: EmoticonCommand[];
  assets: EmoticonAsset[];
}
export type EmoticonEvent = { type: "state"; state: EmoticonState }
  | { type: "effect"; id: string; command: EmoticonCommand; durationSeconds: number }
  | { type: "clear" };
