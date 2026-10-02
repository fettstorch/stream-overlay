# Stream Overlay

A local overlay control room built with Bun, Vue, TypeScript, and Vite.

## Start everything

```sh
bun install
bun run overlay
```

Then open:

- Admin: <http://localhost:3001/admin/>
- Pokémon Blue mGBA: <http://localhost:3001/overlays/pokemon-blue/>
- Streamplace Pets: <http://localhost:3001/overlays/stream-pets/>
- Overlay Paint: <http://localhost:3001/overlays/overlay-paint/>

The original Pokémon URL remains compatible:

- <http://localhost:3001/>

Use the admin UI to enable or disable modules, configure the Streamplace DID,
toggle the Pokémon team and badges, and copy stable OBS browser-source URLs.

Disabled overlay URLs remain available as transparent pages, so OBS sources do
not need to be removed.

## Structure

```text
apps/host                 Bun API and module supervisor
apps/admin                Vue administration UI
modules/pokemon-blue      Pokémon Blue mGBA overlay and adapter
modules/streamplace-pets  Adapter for the upstream submodule
modules/overlay-paint     Shared temporary canvas, served by the host
packages/overlay-sdk      Shared module contracts
packages/pokemon-model    Normalized Pokémon data
packages/pokemon-ui       Reusable team and badge components
streamplace-pets          Upstream Git submodule
```

`streamplace-pets` remains independent and can be updated without modifying its
source. Clone this repository with submodules:

```sh
git clone --recurse-submodules <repository-url>
```

## Overlay Paint

Add the module's copied URL as an OBS Browser Source above your video. Set its
width and height to the stream's dimensions (for example 1920 × 1080). It shows
only a transparent canvas, never the background player.

Select your streamer account in the admin, then draw in Overlay Paint's preview
using a mouse, pen, or touch. The official Stream.place embed sits behind the
canvas as a visual reference. Uncheck **Draw in preview** temporarily to start,
mute, or otherwise interact with the player. Its live-video delay also applies
to this reference; the drawing itself is sent directly through the local host.

All open Paint overlays share one temporary drawing. Input postpones the entire
drawing's fade via Jules debounce: four seconds after the last input, it fades
over one second. Turning the module off clears connected canvases immediately;
turning it on starts empty. Nothing is saved to disk. Coordinates and brush size
are relative to the canvas. The preview uses your stream's video dimensions
from Stream.place segment metadata and displays them for OBS setup. If metadata
is unavailable, it falls back to 16:9. Only metadata is refreshed every 30 seconds;
the video and paint iframes are not reloaded. The copied Paint URL needs no DID.

The host serves this module itself, using SSE for live drawing updates. It adds
no ports or extra processes, and starts with the same `bun run overlay` command.

## Pokémon Blue data

The Pokémon team is read live from mGBA by `scripts/mgba-team.lua`. When the
party changes, the script writes `team.json` and `badges.json` into
`runtime/pokemon-blue/`. The Pokémon Blue adapter normalizes those files for the
reusable UI.

With Pokémon Blue running in mGBA:

1. Open **Tools → Scripting…**.
2. Load `scripts/mgba-team.lua`.
3. Keep the scripting window open while playing.

The Lua script reads the emulated Game Boy's live memory. It does not modify
game memory or save data. mGBA exposes the loaded script's directory, so the
script derives its output path from its own location. The repository can be
installed anywhere; no path in the Lua script needs to be edited.

```text
runtime/pokemon-blue/team.json
runtime/pokemon-blue/badges.json
```

## Checks

```sh
bun run test
bun run typecheck
bun run build
```
