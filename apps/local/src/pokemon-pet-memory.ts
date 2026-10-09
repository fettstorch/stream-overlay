import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Pokemon } from "@streamface/pokemon-model";
import type { StreamChatMessage } from "@streamface/stream-chat";

interface PetCount { streamerDid: string; pokemonId: string; authorDid: string; count: number }

/** Host-owned counts: multiple overlay viewers must not count the same command twice. */
export class PetMemory {
  private counts: PetCount[] = [];
  private seen = new Set<string>();

  constructor(private readonly path?: string) {
    if (!path || !existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf8")) as { counts?: PetCount[]; seen?: string[] };
    if (!Array.isArray(data.counts) || !data.counts.every(entry =>
      typeof entry.streamerDid === "string" && typeof entry.pokemonId === "string"
      && typeof entry.authorDid === "string" && Number.isSafeInteger(entry.count) && entry.count > 0
    ) || !Array.isArray(data.seen) || !data.seen.every(id => typeof id === "string")) {
      throw new Error("Invalid Pokémon pet-count file");
    }
    this.counts = data.counts;
    this.seen = new Set(data.seen.slice(-2000));
  }

  record(message: StreamChatMessage, party: Pokemon[]) {
    const match = message.text.match(/^\s*!pet\s+(.+?)\s*$/i);
    const pokemon = match && party.find(member => member.name.trim().toLowerCase() === match[1]!.trim().toLowerCase());
    const key = JSON.stringify([message.streamerDid, message.id]);
    if (!pokemon || this.seen.has(key)) return false;
    let entry = this.counts.find(entry => entry.streamerDid === message.streamerDid
      && entry.pokemonId === pokemon.id && entry.authorDid === message.author.did);
    if (!entry) {
      entry = { streamerDid: message.streamerDid, pokemonId: pokemon.id, authorDid: message.author.did, count: 0 };
      this.counts.push(entry);
    }
    entry.count++;
    this.seen.add(key);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    if (this.path) {
      // Persist identities and counts only; profile pictures are resolved through the chat cache.
      writeFileSync(`${this.path}.tmp`, JSON.stringify({ counts: this.counts, seen: [...this.seen] }));
      renameSync(`${this.path}.tmp`, this.path);
    }
    return true;
  }

  favourite(streamerDid: string, pokemonId: string) {
    // Ties keep the first petter, so an unchanged score doesn't flicker between users.
    return this.counts.filter(entry => entry.streamerDid === streamerDid && entry.pokemonId === pokemonId)
      .reduce<PetCount | null>((winner, entry) => !winner || entry.count > winner.count ? entry : winner, null);
  }

  reset() {
    // Remove only this store's file; game snapshots and module settings are untouched.
    // If removal fails, retain the in-memory counts so the UI can safely report failure.
    if (this.path) rmSync(this.path, { force: true });
    this.counts = [];
    // Keep current-session deduplication: reconnect replays must not restore cleared counts.
  }
}
