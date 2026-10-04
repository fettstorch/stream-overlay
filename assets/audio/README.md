# Pokémon Blue evolution audio

Rendered locally from the user's Pokémon Blue ROM in an isolated PyBoy instance.
The original ROM and save were not modified; neither is included here.

- `pokemon-blue-evolution.wav`: approximately 18 seconds of evolution music
  (the looping Safari Zone track), with a short ending fade.
- `pokemon-blue-evolution-complete.wav`: the completion jingle, with trailing
  silence trimmed to a total duration of 3.25 seconds.

Both files are stereo, 48 kHz, 16-bit PCM WAV. These are assets only; they are not
yet connected to overlay playback.

Extraction used the ROM's PlayMusic routine at `0x23a1`, audio bank `0x02`,
music ID `0xe5` and completion sound ID `0x89`. These were matched against the
local ROM's evolution code, not assumed for every ROM revision.

The game audio belongs to its original rights holders. Rendering these assets
does not establish permission to redistribute them with a public release.
