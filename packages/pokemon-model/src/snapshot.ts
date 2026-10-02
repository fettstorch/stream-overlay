export interface Pokemon {
  id: string;
  nationalDexNumber: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  experience: number;
}

export interface BadgeProgress {
  ownedBadgeIds: string[];
}

export interface PokemonSnapshot {
  party: Pokemon[];
  badges: BadgeProgress | null;
  capturedAt: string;
}
