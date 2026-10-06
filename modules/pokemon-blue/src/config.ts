export interface PokemonBlueConfiguration {
  thoughtIntervalSeconds?: number;
  components: {
    team: boolean;
    badges: boolean;
  };
}

export function parseThoughtInterval(value: unknown): number | null {
  if (value === undefined) return 120;
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 3600 ? value : null;
}

export interface StreamConfiguration {
  streamerDid: string;
}
