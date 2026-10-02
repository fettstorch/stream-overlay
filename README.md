# Stream overlay

This project runs the main overlay and Streamplace Pets together.

```sh
bun run overlay
```

The overlays are then available at:

- Main overlay: <http://localhost:3001/overlay.html>
- Streamplace Pets: <http://localhost:3000/pets.html>

The Pokémon team is read live from mGBA by `scripts/mgba-team.lua`. When the
party changes, the script writes it to `team.json`. The overlay polls that file
once per second and updates the team without reloading the page.

With Pokémon Blue running in mGBA:

1. Open **Tools → Scripting…**.
2. Load `scripts/mgba-team.lua`.
3. Keep the scripting window open while playing.

The Lua script reads the emulated Game Boy's live memory. It does not modify
game memory or save data. Its output path is:

```text
/Users/julian/Developer/stream-overlay/team.json
```

`streamplace-pets/` remains its own Git repository and can be updated independently.
