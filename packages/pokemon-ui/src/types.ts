export interface BadgeDefinition {
  id: string;
  name: string;
  image: string;
}

export interface PetAppearance {
  avatar?: string;
  handImage: string;
  heartsImage: string;
  startedAt: number;
}

export interface ThoughtAppearance {
  pokemonId: string;
  avatar: string;
  bubbleImage: string;
  heartsImage: string;
  startedAt: number;
}
