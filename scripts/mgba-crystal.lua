-- Live English Pokémon Crystal Rev 1 reader for mGBA 0.10+.
-- Verified against pret/pokecrystal11.sym. Read bank 1 directly when the full
-- WRAM domain is available; otherwise use the bus only while bank 1 is selected.
-- No emulator writes.
local function scriptDirectory()
  if script and script.dir then return script.dir end
  local source = debug.getinfo(1, "S").source:gsub("^@", "")
  return source:match("^(.*)[/\\]") or "."
end
local outputDirectory = scriptDirectory() .. "/../runtime/pokemon-crystal"
local rom, wram
local useBus = false
local readerMode = nil
local function supportedRom()
  -- Refresh handles after ROM load/reset; never retain an old memory domain.
  local ok, supported = pcall(function()
    rom, wram = emu.memory.cart0, emu.memory.wram
    return emu:romSize() == 0x200000 and rom:readRange(0x134, 10) == "PM_CRYSTAL"
      and rom:read8(0x14C) == 1 and rom:read8(0x14E) == 0x18 and rom:read8(0x14F) == 0xD2
  end)
  return ok and supported
end
-- A ROM may not yet be loaded. Publishing stays disabled until it passes checks.
-- wStepCount=01:dc73, wPartyCount=01:dcd7, wPartyMons=01:dcdf, nicknames=01:de41;
-- wJohtoBadges=01:d857 and wKantoBadges=01:d858.
local function read8(address)
  if useBus then return emu:read8(address) end
  return wram:read8(address - 0xC000)
end
local function read16(address) return read8(address) * 256 + read8(address + 1) end
local function read24(address) return read8(address) * 65536 + read8(address + 1) * 256 + read8(address + 2) end
local special = {
  [0xC0]="Ä", [0xC1]="Ö", [0xC2]="Ü", [0xC3]="ä", [0xC4]="ö", [0xC5]="ü",
  [0xD0]="'d", [0xD1]="'l", [0xD2]="'m", [0xD3]="'r", [0xD4]="'s", [0xD5]="'t", [0xD6]="'v",
  [0xE0]="'", [0xE1]="PK", [0xE2]="MN", [0xE3]="-", [0xE6]="?", [0xE7]="!", [0xE8]=".", [0xE9]="&", [0xEA]="é",
  [0xEF]="♂", [0xF3]="/", [0xF4]=",", [0xF5]="♀",
  [0x9A]="(", [0x9B]=")", [0x9C]=":", [0x9D]=";", [0x9E]="[", [0x9F]="]", [0xF2]=".",
}
local function nameAt(address)
  local parts = {}
  for i = 0, 10 do
    local byte = read8(address + i)
    if byte == 0x50 then break end
    if byte == 0x7F then parts[#parts + 1] = " "
    elseif byte >= 0x80 and byte <= 0x99 then parts[#parts + 1] = string.char(65 + byte - 0x80)
    elseif byte >= 0xA0 and byte <= 0xB9 then parts[#parts + 1] = string.char(97 + byte - 0xA0)
    elseif byte >= 0xF6 then parts[#parts + 1] = tostring(byte - 0xF6)
    else parts[#parts + 1] = special[byte] or "�" end
  end
  return table.concat(parts)
end
local function quote(value)
  return '"' .. value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n") .. '"'
end
local function expAt(level, species)
  if level <= 1 then return 0 end
  -- BaseData=14:5424, 32 bytes/species, growth index at +22.
  local growth = rom:read8(0x51424 + (species - 1) * 32 + 22)
  -- GrowthRates=14:4efa: numerator/denominator, signed-square, linear, constant.
  local offset = 0x50EFA + growth * 4
  local ratio = rom:read8(offset)
  assert(growth <= 5 and ratio % 16 > 0, "invalid ROM growth data")
  local square = rom:read8(offset + 1)
  if square >= 128 then square = -(square - 128) end
  return math.max(0, math.floor(math.floor(ratio / 16) * level^3 / (ratio % 16))
    + square * level^2 + rom:read8(offset + 2) * level - rom:read8(offset + 3))
end
local function snapshotMemory()
  local count = read8(0xDCD7)
  if count < 0 or count > 6 or read8(0xDCD8 + count) ~= 0xFF then
    return nil, string.format("party count=%d sentinel=%d", count, read8(0xDCD8 + count))
  end
  local entries = {}
  for slot = 0, count - 1 do
    local address = 0xDCDF + slot * 48
    local species = read8(address)
    local partySpecies = read8(0xDCD8 + slot)
    local egg = partySpecies == 0xFD
    if species < 1 or species > 251 or (not egg and partySpecies ~= species) then
      return nil, string.format("slot=%d species=%d partySpecies=%d", slot, species, partySpecies)
    end
    local level = read8(address + 31)
    if level < 1 or level > 100 then return nil, string.format("slot=%d level=%d", slot, level) end
    local name = egg and "EGG" or nameAt(0xDE41 + slot * 11)
    local id = string.format("%04x-%04x", read16(address + 6), read16(address + 21))
    if read16(address + 34) > read16(address + 36) then return nil, "unstable HP values" end
    -- Eggs store remaining hatch cycles in MON_HAPPINESS (+27).
    local remainingCycles = read8(address + 27)
    local totalCycles = math.max(1, rom:read8(0x51424 + (species - 1) * 32 + 15), remainingCycles)
    local hatch = egg and string.format(',"hatchCyclesRemaining":%d,"hatchCyclesTotal":%d,"hatchStepsRemaining":%d,"hatchStepsTotal":%d',
      remainingCycles, totalCycles, math.max(0, remainingCycles * 256 - read8(0xDC73)), totalCycles * 256) or ""
    entries[#entries + 1] = string.format(
      '{"id":%s,"number":%d,"name":%s,"level":%d,"hp":%d,"maxHp":%d,"experience":%d,"experienceAtLevel":%d,"experienceAtNextLevel":%d,"isEgg":%s}',
      quote(id), species, quote(name), level, read16(address + 34), read16(address + 36), read24(address + 8),
      expAt(level, species), expAt(math.min(100, level + 1), species), tostring(egg)):gsub("}$", hatch .. "}")
  end
  return "[" .. table.concat(entries, ",") .. "]\n", string.format('{"mask":%d}\n', read8(0xD857) + read8(0xD858) * 256)
end
local function snapshot()
  if not supportedRom() then return nil, "requires English Crystal USA/Europe Rev 1" end
  local function attempt(bus)
    useBus = bus
    local ok, team, badges = pcall(snapshotMemory)
    if not ok then return nil, "memory read failed or ROM data unavailable" end
    if team then
      local mode = bus and "CPU bus (bank 1)" or "banked WRAM domain"
      if readerMode ~= mode then console:log("Crystal reader using " .. mode); readerMode = mode end
    end
    return team, badges
  end
  local sizeOk, size = pcall(function() return wram:size() end)
  local reason = "banked WRAM unavailable"
  if sizeOk and type(size) == "number" and size >= 0x8000 then
    local team, details = attempt(false)
    if team then return team, details end
    reason = details
  end
  local bankOk, bank = pcall(function() return emu:read8(0xFF70) & 7 end)
  if bankOk and (bank == 1 or bank == 0) then return attempt(true) end
  return nil, reason .. "; waiting for WRAM bank 1 on the CPU bus"
end
local function atomicWrite(filename, contents)
  local path = outputDirectory .. "/" .. filename
  local file, reason = io.open(path .. ".tmp", "w")
  assert(file, "Start bun run overlay first to create the Crystal runtime folder: " .. tostring(reason))
  file:write(contents); file:close()
  assert(os.rename(path .. ".tmp", path))
end
local lastSignature = nil
local frames = 0
local function publish()
  if not supportedRom() then return end
  local team, badges = snapshot()
  if not team then
    if lastSignature == nil then console:error("Crystal overlay could not read a stable party snapshot: " .. tostring(badges)) end
    return
  end
  local signature = team .. badges
  if signature == lastSignature then return end
  atomicWrite("team.json", team)
  atomicWrite("badges.json", badges)
  lastSignature = signature
  console:log("Crystal overlay team and badges updated")
end
local function update()
  frames = frames + 1
  if frames % 30 == 0 then publish() end
end
callbacks:add("frame", update)
publish()
console:log("Crystal overlay reader loaded; output: " .. outputDirectory)
