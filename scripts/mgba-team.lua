-- Live Pokémon Blue party exporter for mGBA 0.10+.
-- Reads emulated WRAM and writes live data beside the project runtime config.

local function getScriptDirectory()
  if script and script.dir then return script.dir end

  local source = debug.getinfo(1, "S").source
  if source:sub(1, 1) == "@" then source = source:sub(2) end
  return source:match("^(.*)[/\\]") or "."
end

local outputDirectory = getScriptDirectory() .. "/../runtime/pokemon-blue"
local outputPath = outputDirectory .. "/team.json"
local temporaryPath = outputPath .. ".tmp"
local badgesOutputPath = outputDirectory .. "/badges.json"
local badgesTemporaryPath = badgesOutputPath .. ".tmp"

local PARTY_COUNT = 0xD163
local PARTY_SPECIES = 0xD164
local PARTY_DATA = 0xD16B
local PARTY_NICKNAMES = 0xD2B5
local OBTAINED_BADGES = 0xD356
local PARTY_MEMBER_LENGTH = 44
local CURRENT_HP_OFFSET = 1
local EXPERIENCE_OFFSET = 14
local ORIGINAL_TRAINER_ID_OFFSET = 12
local DETERMINANT_VALUES_OFFSET = 27
local LEVEL_OFFSET = 33
local MAX_HP_OFFSET = 34
local NAME_LENGTH = 11

-- Pokémon Red/Blue internal species ID -> National Pokédex number.
local nationalDex = {
  [0x01]=112, [0x02]=115, [0x03]=32, [0x04]=35, [0x05]=21, [0x06]=100, [0x07]=34, [0x08]=80,
  [0x09]=2, [0x0A]=103, [0x0B]=108, [0x0C]=102, [0x0D]=88, [0x0E]=94, [0x0F]=29, [0x10]=31,
  [0x11]=104, [0x12]=111, [0x13]=131, [0x14]=59, [0x15]=151, [0x16]=130, [0x17]=90, [0x18]=72,
  [0x19]=92, [0x1A]=123, [0x1B]=120, [0x1C]=9, [0x1D]=127, [0x1E]=114,
  [0x21]=58, [0x22]=95, [0x23]=22, [0x24]=16, [0x25]=79, [0x26]=64, [0x27]=75, [0x28]=113,
  [0x29]=67, [0x2A]=122, [0x2B]=106, [0x2C]=107, [0x2D]=24, [0x2E]=47, [0x2F]=54, [0x30]=96,
  [0x31]=76, [0x33]=126, [0x35]=125, [0x36]=82, [0x37]=109, [0x39]=56, [0x3A]=86, [0x3B]=50,
  [0x3C]=128, [0x40]=83, [0x41]=48, [0x42]=149, [0x46]=84, [0x47]=60, [0x48]=124, [0x49]=146,
  [0x4A]=144, [0x4B]=145, [0x4C]=132, [0x4D]=52, [0x4E]=98, [0x52]=37, [0x53]=38, [0x54]=25,
  [0x55]=26, [0x58]=147, [0x59]=148, [0x5A]=140, [0x5B]=141, [0x5C]=116, [0x5D]=117,
  [0x60]=27, [0x61]=28, [0x62]=138, [0x63]=139, [0x64]=39, [0x65]=40, [0x66]=133, [0x67]=136,
  [0x68]=135, [0x69]=134, [0x6A]=66, [0x6B]=41, [0x6C]=23, [0x6D]=46, [0x6E]=61, [0x6F]=62,
  [0x70]=13, [0x71]=14, [0x72]=15, [0x74]=85, [0x75]=57, [0x76]=51, [0x77]=49, [0x78]=87,
  [0x7B]=10, [0x7C]=11, [0x7D]=12, [0x7E]=68, [0x80]=55, [0x81]=97, [0x82]=42, [0x83]=150,
  [0x84]=143, [0x85]=129, [0x88]=89, [0x8A]=99, [0x8B]=91, [0x8D]=101, [0x8E]=36, [0x8F]=110,
  [0x90]=53, [0x91]=105, [0x93]=93, [0x94]=63, [0x95]=65, [0x96]=17, [0x97]=18, [0x98]=121,
  [0x99]=1, [0x9A]=3, [0x9B]=73, [0x9D]=118, [0x9E]=119, [0xA3]=77, [0xA4]=78, [0xA5]=19,
  [0xA6]=20, [0xA7]=33, [0xA8]=30, [0xA9]=74, [0xAA]=137, [0xAB]=142, [0xAD]=81, [0xB0]=4,
  [0xB1]=7, [0xB2]=5, [0xB3]=8, [0xB4]=6, [0xB9]=43, [0xBA]=44, [0xBB]=45, [0xBC]=69,
  [0xBD]=70, [0xBE]=71,
}

local specialCharacters = {
  [0xBA]="é", [0xBB]="'d", [0xBC]="'l", [0xBD]="'s", [0xBE]="'t", [0xBF]="'v",
  [0xE0]="'", [0xE3]="-", [0xE4]="'r", [0xE5]="'m", [0xE6]="?", [0xE7]="!", [0xE8]=".",
  [0xEF]="♂", [0xF3]="/", [0xF4]=",", [0xF5]="♀",
}

local function decodeName(address)
  local parts = {}
  for offset = 0, NAME_LENGTH - 1 do
    local byte = emu:read8(address + offset)
    if byte == 0x50 then break end

    if byte == 0x7F then
      parts[#parts + 1] = " "
    elseif byte >= 0x80 and byte <= 0x99 then
      parts[#parts + 1] = string.char(string.byte("A") + byte - 0x80)
    elseif byte >= 0xA0 and byte <= 0xB9 then
      parts[#parts + 1] = string.char(string.byte("a") + byte - 0xA0)
    elseif byte >= 0xF6 then
      parts[#parts + 1] = tostring(byte - 0xF6)
    else
      parts[#parts + 1] = specialCharacters[byte] or "�"
    end
  end
  return table.concat(parts)
end

local function jsonString(value)
  return '"' .. value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n") .. '"'
end

local function readBigEndian16(address)
  return emu:read8(address) * 0x100 + emu:read8(address + 1)
end

local function readBigEndian24(address)
  return emu:read8(address) * 0x10000 + emu:read8(address + 1) * 0x100 + emu:read8(address + 2)
end

local function readTeam()
  local count = emu:read8(PARTY_COUNT)
  if count < 1 or count > 6 then return nil end

  local entries = {}
  local signatureParts = {}
  for index = 0, count - 1 do
    local internalId = emu:read8(PARTY_SPECIES + index)
    local number = nationalDex[internalId]
    if not number then return nil end

    local name = decodeName(PARTY_NICKNAMES + index * NAME_LENGTH)
    local memberAddress = PARTY_DATA + index * PARTY_MEMBER_LENGTH
    local currentHp = readBigEndian16(memberAddress + CURRENT_HP_OFFSET)
    local originalTrainerId = readBigEndian16(memberAddress + ORIGINAL_TRAINER_ID_OFFSET)
    local determinantValues = readBigEndian16(memberAddress + DETERMINANT_VALUES_OFFSET)
    local pokemonId = string.format("%04x-%04x", originalTrainerId, determinantValues)
    local experience = readBigEndian24(memberAddress + EXPERIENCE_OFFSET)
    local level = emu:read8(memberAddress + LEVEL_OFFSET)
    local maxHp = readBigEndian16(memberAddress + MAX_HP_OFFSET)
    entries[#entries + 1] = string.format(
      '  { "id": %s, "number": %d, "name": %s, "level": %d, "hp": %d, "maxHp": %d, "experience": %d }',
      jsonString(pokemonId),
      number,
      jsonString(name),
      level,
      currentHp,
      maxHp,
      experience
    )
    signatureParts[#signatureParts + 1] = table.concat({
      tostring(number),
      pokemonId,
      name,
      tostring(level),
      tostring(currentHp),
      tostring(maxHp),
      tostring(experience),
    }, ":")
  end

  local badges = emu:read8(OBTAINED_BADGES)
  signatureParts[#signatureParts + 1] = "badges:" .. tostring(badges)
  return "[\n" .. table.concat(entries, ",\n") .. "\n]\n", table.concat(signatureParts, "|"), badges
end

local function writeFileAtomically(path, temporaryFilePath, contents)
  local file, openError = io.open(temporaryFilePath, "w")
  if not file then
    console:error("Could not open " .. temporaryFilePath .. ": " .. tostring(openError))
    return false
  end

  file:write(contents)
  file:close()

  local renamed, renameError = os.rename(temporaryFilePath, path)
  if not renamed then
    console:error("Could not replace " .. path .. ": " .. tostring(renameError))
    return false
  end

  return true
end

local lastSignature = nil
local frame = 0

local function updateTeam()
  frame = frame + 1
  if frame % 30 ~= 0 then return end

  local json, signature, badges = readTeam()
  if not json or signature == lastSignature then return end

  if not writeFileAtomically(outputPath, temporaryPath, json) then return end
  if not writeFileAtomically(badgesOutputPath, badgesTemporaryPath, string.format('{ "mask": %d }\n', badges)) then return end

  lastSignature = signature
  console:log("Updated overlay team: " .. signature)
end

callbacks:add("frame", updateTeam)
console:log("Pokémon Blue live team exporter loaded")
