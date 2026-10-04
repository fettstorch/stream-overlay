import type { Pokemon } from "@stream-overlay/pokemon-model";

export interface PetAuthor {
  did: string;
  avatar?: string;
}

interface PetQueue {
  requests: Promise<PetAuthor>[];
  running: boolean;
  active?: PetAuthor;
  cancelDelay?: () => void;
}

export class PokemonPetQueues {
  private readonly duration: number;
  private readonly activate: (pokemonId: string, author: PetAuthor) => void;
  private readonly deactivate: (pokemonId: string, author: PetAuthor) => void;
  private readonly queues = new Map<string, PetQueue>();
  private readonly pokemonIdsByName = new Map<string, string>();

  constructor(
    duration: number,
    activate: (pokemonId: string, author: PetAuthor) => void,
    deactivate: (pokemonId: string, author: PetAuthor) => void,
  ) {
    this.duration = duration;
    this.activate = activate;
    this.deactivate = deactivate;
  }

  updateParty(party: Pokemon[]) {
    this.pokemonIdsByName.clear();
    const currentIds = new Set<string>();
    for (const pokemon of party) {
      currentIds.add(pokemon.id);
      this.pokemonIdsByName.set(this.normalize(pokemon.name), pokemon.id);
    }
    for (const pokemonId of this.queues.keys()) {
      if (!currentIds.has(pokemonId)) {
        const queue = this.queues.get(pokemonId)!;
        this.queues.delete(pokemonId);
        if (queue.active) this.deactivate(pokemonId, queue.active);
        queue.active = undefined;
        queue.cancelDelay?.();
      }
    }
  }

  enqueue(name: string, author: Promise<PetAuthor>) {
    const pokemonId = this.pokemonIdsByName.get(this.normalize(name));
    if (!pokemonId) return false;
    const queue = this.queues.get(pokemonId) ?? { requests: [], running: false };
    queue.requests.push(author);
    this.queues.set(pokemonId, queue);
    if (!queue.running) void this.run(pokemonId, queue);
    return true;
  }

  private async run(pokemonId: string, queue: PetQueue) {
    queue.running = true;
    while (this.queues.get(pokemonId) === queue && queue.requests.length > 0) {
      const author = await queue.requests.shift()!;
      if (this.queues.get(pokemonId) !== queue) break;
      queue.active = author;
      this.activate(pokemonId, author);
      await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(timer);
          queue.cancelDelay = undefined;
          resolve();
        };
        const timer = setTimeout(finish, this.duration);
        queue.cancelDelay = finish;
      });
      if (this.queues.get(pokemonId) !== queue) break;
      this.deactivate(pokemonId, author);
      queue.active = undefined;
    }
    if (this.queues.get(pokemonId) === queue) this.queues.delete(pokemonId);
  }

  private normalize(value: string) {
    return value.trim().toLowerCase();
  }
}
