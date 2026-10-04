# Stream Overlay

A local overlay control room built with Bun, Vue, TypeScript, and Vite.

Pokémon Blue, Chat, and Overlay Paint are served directly by the central host.
The Vue interfaces are compiled once at startup; the compilers then exit.
There is no Pokémon webserver process or port 3002. Restart the host after
changing Pokémon UI source files. Existing OBS URLs remain unchanged.

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
- Chat: <http://localhost:3001/overlays/chat/>

The original Pokémon URL remains compatible:

- <http://localhost:3001/>

Use the admin UI to enable or disable modules, configure the Streamplace DID,
toggle the Pokémon team and badges, and copy stable OBS browser-source URLs.

Disabled overlay URLs remain available as transparent pages, so OBS sources do
not need to be removed.

Pokémon Blue, Chat, and Paint react live to the module toggle without an OBS refresh.
Pokémon keeps a dedicated SSE status connection open, even when disabled;
its UI, snapshot refreshes, chat subscription, and pet queues stop while off.
Re-enabling resumes with current game data and no previously queued pets.
After a status connection interruption it stays transparent until reconnected.
Streamplace Pets retains its separate, unchanged lifecycle.

## Structure

```text
apps/host                 Bun API and module supervisor
apps/admin                Vue administration UI
modules/pokemon-blue      Pokémon Blue mGBA overlay and adapter
modules/streamplace-pets  Adapter for the upstream submodule
modules/overlay-paint     Shared temporary canvas, served by the host
modules/chat              Stream.place chat display, served by the host
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

## Chat

Select your streamer account in the admin, then copy the Chat module's URL into
an OBS Browser Source. New messages appear with their author's display name
(or handle/DID fallback) on a transparent background, newest at the bottom.
The overlay retains at most 50 messages; previous chat history is not fetched.
Switching Chat off clears the display and stops its subscription; switching on
resumes with new incoming messages. It uses the existing shared Jetstream service,
not a separate Jetstream connection, and requires no additional port or server.

## Overlay Paint

Add the module's copied URL as an OBS Browser Source above your video. Set its
width and height to the stream's dimensions (for example 1920 × 1080). It shows
only a transparent canvas, never the background player.

Select your streamer account in the admin, then draw in Overlay Paint's preview
using a mouse, pen, or touch. The official Stream.place embed sits behind the
canvas as a visual reference. Its live-video delay also applies
to this reference; the drawing itself is sent directly through the local host.
The pencil follows your pointer in the preview and all OBS Paint overlays on
a separate transparent layer. Leaving the drawing area hides it; hovering never
adds marks or postpones the drawing's fade.

All open Paint overlays share one temporary drawing. Input postpones the entire
drawing's fade via Jules debounce: after the configured delay (four seconds by
default), it fades over one second. Choose the brush color and fade delay in
the module's settings; both save automatically across host restarts. Existing
marks keep their original colors. Turning the module off clears canvases immediately;
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

Matching `!pet <Pokémon name>` commands also count toward that Pokémon's favourite
petter. At a configurable interval (two minutes by default), the next current team slot shows its most frequent
petter's avatar and hearts in a thought bubble for ten seconds. Pokémon without
pets are skipped; ties keep the first petter. Active pet animations take priority.
Counts are stored in `runtime/pokemon-blue/pet-counts.json`, separately per
streamer and stable Pokémon ID, so reordering, renaming, and evolution preserve
them. Only DIDs and counts are persisted, not profile pictures. OBS and admin
previews share the host counter and never multiply the count.
Set **Thought bubbles → Interval (seconds)** in the module card to any value
from 1 to 3600 seconds. It saves automatically and updates open overlays live;
lower it for testing without refreshing OBS.
The small **Reset pet counts** button asks for confirmation, then clears all
Pokémon/streamer counts in memory and removes the counter file. It does not
touch game data or settings. The next new pet starts a fresh saved counter.

## Checks

```sh
bun run test
bun run typecheck
bun run build
```
