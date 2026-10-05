export interface Pokemon {
  id: string;
  nationalDexNumber: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  experience: number;
  /** Game-provided thresholds avoid assuming Gen I species growth groups. */
  experienceAtLevel?: number;
  experienceAtNextLevel?: number;
  isEgg?: boolean;
}

export interface BadgeProgress {
  ownedBadgeIds: string[];
}

export interface PokemonSnapshot {
  party: Pokemon[];
  badges: BadgeProgress | null;
  capturedAt: string;
}
