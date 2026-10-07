import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CrystalMgbaFileProvider } from "../src/mgba-file-provider.ts";
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from "fengari";

const reader = readFileSync(new URL("../../../scripts/mgba-crystal.lua", import.meta.url), "utf8");
function runLua(extra: string) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const status = lauxlib.luaL_dostring(state, to_luastring(`
    local ram, rom = {}, {}
    files = {}
    script = { dir = "." }
    emu = { memory = {} }
    function emu:romSize() return 0x200000 end
    emu.memory.cart0 = {
      read8 = function(_, address) return rom[address] or 0 end,
      readRange = function() return "PM_CRYSTAL" end,
    }
    emu.memory.wram = { read8 = function(_, offset) return ram[offset + 0xC000] or 0 end }
    rom[0x14C], rom[0x14E], rom[0x14F] = 1, 0x18, 0xD2
    console = { log = function() end }
    callbacks = { add = function(_, _, fn) tick = fn end }
    io.open = function(path)
      return { write = function(_, value) files[path] = value end, close = function() end }
    end
    os.rename = function(from, to) files[to] = files[from]; files[from] = nil; return true end
    function advance() for i=1,30 do tick() end end
    function setMon(slot, species, name, ot, egg)
      local address = 0xDCDF + slot * 48
      ram[0xDCD8 + slot] = egg and 0xFD or species
      ram[address], ram[address+6], ram[address+7] = species, 0x12, ot
      ram[address+21], ram[address+22] = 0xAB, ot
      ram[address+31], ram[address+34], ram[address+35], ram[address+36], ram[address+37] = 5, 0, 12, 0, 20
      ram[address+8], ram[address+9], ram[address+10] = 0, 0, 150
      local nick = 0xDE41 + slot * 11
      for i=1,#name do ram[nick+i-1] = string.byte(name,i) - 65 + 0x80 end
      ram[nick+#name] = 0x50
      rom[0x51424 + (species-1)*32 + 22] = 3
      rom[0x51424 + (species-1)*32 + 15] = 10
    end
    rom[0x50EFA+12], rom[0x50EFA+13], rom[0x50EFA+14], rom[0x50EFA+15] = 0x65, 0x8F, 100, 140
    ${reader}
    ${extra}
  `));
  const result = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  if (status !== lua.LUA_OK) throw new Error(result);
  return JSON.parse(result);
}

test("Crystal Lua exports Gen II stats, exact EXP boundaries, both badge regions and eggs", () => {
  const result = runLua(`
    ram[0xDCD7], ram[0xDCDA], ram[0xD857], ram[0xD858] = 2, 0xFF, 1, 128
    setMon(0,152,"LEAF",52,false); setMon(1,175,"TOGEPI",53,true)
    ram[0xDCDF+48+27], ram[0xDC73] = 5, 64
    advance()
    return files["./../runtime/pokemon-crystal/team.json"]
  `);
  expect(result[0]).toMatchObject({ id: "1234-ab34", number: 152, name: "LEAF", level: 5, hp: 12, maxHp: 20, experience: 150, experienceAtLevel: 135, experienceAtNextLevel: 179, isEgg: false });
  expect(result[1]).toMatchObject({ number: 175, name: "EGG", isEgg: true, hatchCyclesRemaining: 5, hatchCyclesTotal: 10, hatchStepsRemaining: 1216, hatchStepsTotal: 2560 });
  expect(runLua(`ram[0xDCD7],ram[0xDCD8],ram[0xD857],ram[0xD858]=0,0xFF,1,128; advance(); return files["./../runtime/pokemon-crystal/badges.json"]`)).toEqual({ mask: 32769 });
});

test("Crystal Lua preserves stable identities while exporting changed party order", () => {
  const result = runLua(`
    ram[0xDCD7],ram[0xDCDA]=2,0xFF
    setMon(0,152,"LEAF",52,false); setMon(1,155,"FIRE",53,false); advance()
    setMon(0,155,"FIRE",53,false); setMon(1,152,"LEAF",52,false); advance()
    return files["./../runtime/pokemon-crystal/team.json"]
  `);
  expect(result.map((pokemon: { id: string }) => pokemon.id)).toEqual(["1235-ab35", "1234-ab34"]);
});

test("Crystal Lua rejects incomplete species lists instead of publishing transient swaps", () => {
  const result = runLua(`ram[0xDCD7],ram[0xDCD9]=1,0xFF; setMon(0,152,"LEAF",52,false); ram[0xDCD8]=155; advance(); return files["./../runtime/pokemon-crystal/team.json"] or "null"`);
  expect(result).toBeNull();
});

test("Crystal uses the Gen II character map, not Blue's accented-character bytes", () => {
  const result = runLua(`
    ram[0xDCD7],ram[0xDCD9]=1,0xFF; setMon(0,152,"LEAF",52,false)
    ram[0xDE41],ram[0xDE42],ram[0xDE43],ram[0xDE44],ram[0xDE45]=0xEA,0xD4,0xE9,0xEF,0x50
    advance(); return files["./../runtime/pokemon-crystal/team.json"]
  `);
  expect(result[0].name).toBe("é's&♂");
});

test("Crystal provider decodes all 16 badges in engine bit order and preserves EXP metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "crystal-reader-test-"));
  try {
    writeFileSync(join(directory, "team.json"), JSON.stringify([{ id: "leaf", number: 152, name: "LEAF", level: 5, hp: 12, maxHp: 20, experience: 150, experienceAtLevel: 135, experienceAtNextLevel: 179, isEgg: false }]));
    writeFileSync(join(directory, "badges.json"), JSON.stringify({ mask: (1 << 4) | (1 << 5) | (1 << 15) }));
    const snapshot = await new CrystalMgbaFileProvider(join(directory, "team.json"), join(directory, "badges.json")).readSnapshot();
    expect(snapshot.badges?.ownedBadgeIds).toEqual(["mineral", "storm", "earth"]);
    expect(snapshot.party[0]?.experienceAtNextLevel).toBe(179);
  } finally { rmSync(directory, { recursive: true }); }
});
