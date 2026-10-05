// Re-extract from a user-owned English Crystal Rev 1 ROM; never ships the ROM.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../modules/project-root.ts";

const rom = await Bun.file(process.argv[2] ?? "").bytes();
if (createHash("sha1").update(rom).digest("hex") !== "f2f52230b536214ef7c9924f483392993e226cfb") {
  throw new Error("Expected English Pokémon Crystal Rev 1 ROM");
}
// pret/pokecrystal Rev 1 symbols: BadgeGFX = 09:6043, four tiles per face.
const graphics = 9 * 0x4000 + 0x2043;
const names = ["zephyr", "hive", "plain", "fog", "mineral", "storm", "glacier", "rising"];
const output = join(projectRoot, "assets/badges/crystal");
mkdirSync(output, { recursive: true });

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
// The trainer card uses one monochrome badge palette. Transparent sprite color 0.
// PredefPals = 02:5df6; PREDEFPAL_CGB_BADGE = 36. Decode the ROM's RGB555 colors.
const palette = Array.from({ length: 4 }, (_, color) => {
  const offset = 2 * 0x4000 + 0x1df6 + 36 * 8 + color * 2;
  const rgb = rom[offset]! | rom[offset + 1]! << 8;
  return [0, 5, 10].map(shift => Math.round(((rgb >> shift) & 31) * 255 / 31)).concat(color ? 255 : 0);
});
for (let badge = 0; badge < names.length; badge++) {
  const pixels = Buffer.alloc(16 * (1 + 16 * 4));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    // TrainerCard facing1 OAM: TL, TR, BL, BR.
    const tile = Math.floor(y / 8) * 2 + Math.floor(x / 8);
    const offset = graphics + (badge * 4 + tile) * 16 + (y % 8) * 2;
    const shift = 7 - x % 8;
    const color = ((rom[offset]! >> shift) & 1) | (((rom[offset + 1]! >> shift) & 1) << 1);
    pixels.set(palette[color]!, y * 65 + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6;
  await Bun.write(join(output, `${names[badge]}.png`), Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]));
}
console.log(`Extracted eight Johto badge faces to ${output}`);
