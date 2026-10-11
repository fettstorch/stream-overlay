import type { Pokemon, PokemonSnapshot } from "../../../packages/pokemon-model/src/snapshot.ts";

export const crystalMediaCollection = "live.streamface.pokemonCrystalMgba.media";
export const crystalMediaDefinitions = "live.streamface.pokemonCrystalMgba.defs";
export const crystalBadgeIds = [
  "zephyr",
  "hive",
  "plain",
  "fog",
  "mineral",
  "storm",
  "glacier",
  "rising",
  "boulder",
  "cascade",
  "thunder",
  "rainbow",
  "soul",
  "marsh",
  "volcano",
  "earth",
];
export type CrystalMedia = {
  number: number;
  url?: string;
  blob?: {
    $type: "blob";
    ref: { $link: string };
    mimeType: string;
    size: number;
  };
};
export function validateCrystalMedia(items: unknown): asserts items is CrystalMedia[] {
  if (!Array.isArray(items) || items.length > 251)
    throw new TypeError("Invalid Crystal media mappings");
  const seen = new Set<number>();
  for (const item of items) {
    if (
      !item ||
      !Number.isInteger(item.number) ||
      item.number < 1 ||
      item.number > 251 ||
      seen.has(item.number)
    )
      throw new TypeError("Invalid or duplicate Crystal species");
    seen.add(item.number);
    if (item.blob) {
      const blob = item.blob;
      if (
        blob.$type !== "blob" ||
        typeof blob.ref?.$link !== "string" ||
        !/^[a-z0-9]+$/.test(blob.ref.$link) ||
        !["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(
          blob.mimeType,
        ) ||
        !Number.isSafeInteger(blob.size) ||
        blob.size < 1 ||
        blob.size > 10_000_000
      )
        throw new TypeError("Invalid Crystal image blob");
    } else {
      let url: URL;
      try {
        url = new URL(item.url);
      } catch {
        throw new TypeError("Crystal image URLs must use HTTPS");
      }
      if (
        typeof item.url !== "string" ||
        item.url.length > 2048 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password
      )
        throw new TypeError("Crystal image URLs must use HTTPS");
    }
  }
}
const integer = (value: unknown, minimum: number, maximum: number) =>
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
/** Normalize only accepted fields; no game data is retained by this function. */
export function parseCrystalIngest(value: unknown): {
  session: string;
  sequence: number;
  snapshot: PokemonSnapshot;
} {
  const input = value as any;
  if (
    !input ||
    input.version !== 1 ||
    typeof input.session !== "string" ||
    !/^[A-Za-z0-9-]{1,100}$/.test(input.session) ||
    !integer(input.sequence, 1, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(input.team) ||
    input.team.length > 6 ||
    !integer(input.badges?.mask, 0, 65535)
  )
    throw new TypeError("Invalid Crystal snapshot");
  const ids = new Set<string>();
  const party: Pokemon[] = input.team.map((p: any) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      !/^[a-f0-9]{4}-[a-f0-9]{4}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      p.name.length > 32 ||
      /[\u0000-\u001f]/.test(p.name) ||
      !integer(p.number, 1, 251) ||
      !integer(p.level, 1, 100) ||
      !integer(p.hp, 0, 65535) ||
      !integer(p.maxHp, 0, 65535) ||
      p.hp > p.maxHp ||
      !integer(p.experience, 0, 16777215) ||
      !integer(p.experienceAtLevel, 0, 16777215) ||
      !integer(p.experienceAtNextLevel, p.experienceAtLevel, 16777215) ||
      typeof p.isEgg !== "boolean"
    )
      throw new TypeError("Invalid Crystal party member");
    ids.add(p.id);
    const result: Pokemon = {
      id: p.id,
      nationalDexNumber: p.number,
      name: p.name,
      level: p.level,
      hp: p.hp,
      maxHp: p.maxHp,
      experience: p.experience,
      experienceAtLevel: p.experienceAtLevel,
      experienceAtNextLevel: p.experienceAtNextLevel,
      isEgg: p.isEgg,
    };
    if (p.isEgg) {
      for (const key of [
        "hatchCyclesRemaining",
        "hatchCyclesTotal",
        "hatchStepsRemaining",
        "hatchStepsTotal",
      ] as const) {
        if (!integer(p[key], key.endsWith("Total") ? 1 : 0, 65536))
          throw new TypeError("Invalid Crystal egg");
        result[key] = p[key];
      }
      if (p.hatchCyclesRemaining > p.hatchCyclesTotal || p.hatchStepsRemaining > p.hatchStepsTotal)
        throw new TypeError("Invalid Crystal egg progress");
    }
    return result;
  });
  return {
    session: input.session,
    sequence: input.sequence,
    snapshot: {
      party,
      badges: {
        ownedBadgeIds: crystalBadgeIds.filter((_, i) => (input.badges.mask & (1 << i)) !== 0),
      },
      capturedAt: new Date().toISOString(),
    },
  };
}
