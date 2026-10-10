/** Transport-neutral command shape. PDS serialization belongs to the server adapter. */
export type EmoticonModerationRule = {
  did: string;
  handle?: string;
  blocked: boolean;
  cooldownSeconds: number;
};
export type CloudMedia = {
  url?: string;
  blob?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  };
};
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
