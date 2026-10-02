export interface PaintConfiguration {
  color: string;
  decaySeconds: number;
}

export const defaultPaintConfiguration: PaintConfiguration = { color: "#ff5cbe", decaySeconds: 4 };

export function parsePaintConfiguration(value: unknown): PaintConfiguration | null {
  if (!value || typeof value !== "object") return null;
  const { color, decaySeconds } = value as PaintConfiguration;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)
    || typeof decaySeconds !== "number" || !Number.isFinite(decaySeconds)
    || decaySeconds < 0.1 || decaySeconds > 60) return null;
  return { color: color.toLowerCase(), decaySeconds };
}
