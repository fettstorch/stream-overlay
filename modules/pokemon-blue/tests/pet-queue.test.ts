import { describe, expect, test } from "bun:test";
import type { Pokemon } from "@stream-overlay/pokemon-model";
import { PokemonPetQueues } from "../src/pet-queue.ts";

const kleo: Pokemon = {
  id: "kleo-id",
  nationalDexNumber: 37,
  name: "Kleo",
  level: 40,
  hp: 100,
  maxHp: 100,
  experience: 67907,
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("PokemonPetQueues", () => {
  test("matches Pokémon nicknames without case or surrounding whitespace", () => {
    const queues = new PokemonPetQueues(1, () => {}, () => {});
    queues.updateParty([kleo]);
    expect(queues.enqueue("  kLeO ", Promise.resolve({ did: "did:one" }))).toBe(true);
  });

  test("runs requests for one Pokémon in FIFO order", async () => {
    const events: string[] = [];
    const queues = new PokemonPetQueues(
      2,
      (_, author) => events.push(`start:${author.did}`),
      (_, author) => events.push(`stop:${author.did}`),
    );
    queues.updateParty([kleo]);
    queues.enqueue("Kleo", Promise.resolve({ did: "did:one" }));
    queues.enqueue("Kleo", Promise.resolve({ did: "did:two" }));
    await wait(12);
    expect(events).toEqual(["start:did:one", "stop:did:one", "start:did:two", "stop:did:two"]);
  });

  test("discards queued pets when their Pokémon leaves the party", async () => {
    const events: string[] = [];
    const queues = new PokemonPetQueues(5, (_, author) => events.push(author.did), () => {});
    queues.updateParty([kleo]);
    queues.enqueue("Kleo", Promise.resolve({ did: "did:one" }));
    queues.enqueue("Kleo", Promise.resolve({ did: "did:two" }));
    queues.updateParty([]);
    await wait(12);
    expect(events).not.toContain("did:two");
  });

  test("removal immediately deactivates a pet and cannot clear a newer pet after rejoining", async () => {
    const events: string[] = [];
    const queues = new PokemonPetQueues(20,
      (_, author) => events.push(`start:${author.did}`),
      (_, author) => events.push(`stop:${author.did}`));
    queues.updateParty([kleo]);
    queues.enqueue("Kleo", Promise.resolve({ did: "old" }));
    await wait(0);
    queues.updateParty([]);
    expect(events).toEqual(["start:old", "stop:old"]);
    queues.updateParty([kleo]);
    queues.enqueue("Kleo", Promise.resolve({ did: "new" }));
    await wait(0);
    expect(events).toEqual(["start:old", "stop:old", "start:new"]);
    await wait(25);
    expect(events).toEqual(["start:old", "stop:old", "start:new", "stop:new"]);
  });
});
