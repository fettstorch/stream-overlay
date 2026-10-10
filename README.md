# Streamface

A local and cloud stream overlay app built with Bun, Vue, TypeScript, and Vite.

The app and workspace packages are named Streamface (`@streamface/*`). Existing
OBS URLs remain unchanged. The legacy `stream_overlay_session` cookie,
`stream-overlay.admin.pinned-modules` browser key, `stream-overlay-cloud-auth`
Docker volume and temporary `stream-overlay` log directory are intentionally
retained for compatibility. Development lexicon IDs remain provisional until the
production namespace is chosen.

Pokémon Blue, Pokémon Crystal, Chat, and Overlay Paint are served directly by the central host.
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
- Pokémon Crystal mGBA: <http://localhost:3001/overlays/pokemon-crystal/>
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

See `CONTRIBUTING.md` for module registration, state ownership and verification.

```text
apps/local                Local Bun API, filesystem adapters, and module supervisor
apps/web                  Local/cloud admin UI and cloud overlay entrypoints
apps/server               Cloud HTTP, OAuth, PDS persistence and realtime relay
modules/pokemon-blue      Pokémon Blue mGBA overlay and adapter
modules/pokemon-crystal   Pokémon Crystal mGBA adapter, sharing the team HUD
modules/streamplace-pets  Adapter for the upstream submodule
modules/overlay-paint     Shared temporary canvas, served by the host
modules/chat              Stream.place chat display, served by the host
modules/emoticons         Clips/stickers, command validation and browser runtime
modules/catalog.ts        Shared cloud module metadata, routes and build entries
packages/overlay-sdk      Shared module contracts
packages/stream-chat      Shared live/sample chat sources and stream measurements
packages/browser-runtime  Browser relay transport and reconnect handling
packages/protocol         Cloud configuration and transport contracts
packages/pokemon-model    Normalized Pokémon data
packages/pokemon-ui       Reusable team and badge components
streamplace-pets          Upstream Git submodule
```

`streamplace-pets` remains independent and can be updated without modifying its
source. Clone this repository with submodules:

```sh
git clone --recurse-submodules <repository-url>
```

## Pokémon Crystal mGBA

1. Start `bun run overlay` as usual.
2. Open English **Pokémon Crystal (USA/Europe Rev 1)** in mGBA 0.10+.
3. In **Tools → Scripting**, load `scripts/mgba-crystal.lua` directly from this
   project and leave the scripting window open. No save paths or script edits needed.
4. Enable **Pokémon Crystal mGBA** in Admin (new installations start it disabled),
   disable Blue when no longer using it, and copy Crystal's URL into OBS.

The Lua reader exports live party order, nicknames, stable OT-ID/DV identities,
levels, HP, total EXP, EXP level thresholds, eggs, and all 16 badge flags into
`runtime/pokemon-crystal/`. The host creates that folder; ROMs and saves remain
wherever mGBA expects them. Crystal has its own saved settings and
`runtime/pokemon-crystal/pet-counts.json`, with the same reset and thought-bubble
controls as Blue. Live toggles and `!pet <Pokémon name>` use the existing shared
status/chat services; no extra process or port is introduced.

Crystal reads each species' growth group and the growth formula from its own ROM,
rather than guessing from the Gen I species table. Eggs are shown without HP/EXP
bars or their hidden species image. Unmapped species use the existing placeholder;
both games share the sticker mapping in `modules/pokemon-blue/src/App.vue`.

Supported ROM SHA-1: `f2f52230b536214ef7c9924f483392993e226cfb`.
Other revisions, languages and ROM hacks require verified memory/ROM offsets.
Addresses and tile order were checked against the
[Crystal disassembly](https://github.com/pret/pokecrystal) and its
[Rev 1 symbols](https://raw.githubusercontent.com/pret/pokecrystal/symbols/pokecrystal11.sym).
The eight Johto badge faces and their palette are extracted from the user-owned
ROM; the Kanto row reuses our existing Gen I icons (Crystal has no distinct Kanto
badge graphic set). To reproduce the Johto assets:

```sh
bun scripts/extract-crystal-badges.ts /path/to/crystal-rev1.gbc
```

No ROM or save data is included in this repository. The Lua reader uses mGBA's
flat ROM/WRAM memory domains, so switching the emulated CPU's banks cannot corrupt
the overlay reads.

## Chat

Select your streamer account in the admin, then copy the Chat module's URL into
an OBS Browser Source. New messages appear with their author's display name
(or handle/DID fallback) on a transparent background, newest at the bottom.
The overlay retains at most 50 messages; previous chat history is not fetched.
Switching Chat off clears the display and stops its subscription; switching on
resumes with new incoming messages. Chat, Emotes, and both Pokémon modules
share one direct Stream.place WebSocket connection in the host, with no additional
port or server. The Jetstream listener remains a separate service for future
AT Protocol consumers; no current host module needs to start it. Pets continues
to manage its own upstream connection.

The direct feed includes author profiles, so chat delivery does not wait for a
profile lookup. Its startup history and repeated message IDs are ignored, including
on reconnect, to prevent old commands from executing again. Messages created while
disconnected are not replayed. The feed reconnects automatically and stops when
its last module is disabled. `chat.direct-*` log entries record connection state,
message IDs, creation/arrival timestamps, and `ageMs` for delivery latency.

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

## Cloud overlays

The cloud app is separate from the local `bun run overlay` workflow and does not
change its OBS URLs. Build the web app, then run the cloud server with its final
HTTPS origin, an owned Lexicon namespace, a private session secret, and durable
OAuth storage:

```sh
bun run --filter @streamface/web build
PUBLIC_ORIGIN=https://your-host.example \
SESSION_SECRET='at-least-32-random-bytes' \
LEXICON_NAMESPACE=live.streamface \
AUTH_DATA_DIR=runtime/cloud-auth \
bun run server
```

For local cloud parity, `bun run cloud` builds and starts the same
`infra/koyeb/Dockerfile` through Docker Compose, explicitly loading the project's
root `.env` for configured variables such as `BOT_APP_PASSWORD` and `GIPHY_API_KEY`.
Create this gitignored file before starting (it can be empty if no integrations
are configured). The service is available at
`http://127.0.0.1:3010`; private OAuth state is retained in the named Docker volume
`stream-overlay-cloud-auth`. This port is separate from Pets (`3000`), the local
overlay host (`3001`), and Admin development (`3003`). Stop it with Ctrl-C; use
`docker compose -f infra/koyeb/compose.local.yml down` to remove the container and
network while preserving the auth volume.

Docker without host Bun uses the equivalent command:

```sh
docker compose --env-file .env -f infra/koyeb/compose.local.yml up --build
```

For faster source development without a container, `bun run cloud:dev` uses a
task-local Bun 1.4.2 (downloaded by `npm exec` without changing the global Bun install),
builds the web app, and starts the server on the same port. Set
`PORT=4567 bun run cloud:dev` to choose another port; when `PUBLIC_ORIGIN` is
omitted, OAuth metadata derives its loopback origin from `PORT`.

The cloud runtime is pinned to Bun 1.4.2 and the official AT Protocol packages
`@atproto/api` 0.24.3 and `@atproto/oauth-client-node` 0.5.9. OAuth uses the SDK's
HTTP handle resolver because its default Node DNS resolver relies on an Undici
runtime version signal that Bun does not expose. Do not run the cloud server under
older Bun versions; Bun 1.3.14 cannot import OAuth client 0.5.9 safely.

Both local modes use the development-only namespace and local credentials. A real
OAuth consent flow still depends on an AT Protocol provider accepting the loopback
client metadata and development Lexicons; use the HTTPS deployment configuration
above for the account pilot.

The Streamface admin automatically observes the signed-in ATProto account's
stream.place stream; no separate streamer selection is needed.
The cloud user interface is served at `/`. OAuth returns there too; old `/admin/`
bookmarks redirect to `/`. The separate local overlay host keeps its existing admin URL.

The Bot Commands tab embeds your Streamplace chat and provides a separate message
input using your Streamface login. Sending publishes a real, public
`place.stream.chat.message` record on your PDS, as you, to your own stream.
Existing logins need to authorize the added chat-write permission using the
"Authorize chat posting" link. Normal bot roles, restrictions and cooldowns apply;
this is not an admin-test bypass. Failed sends retain the draft and are never
automatically retried. The private listener runs while the Bot module is open and
enabled, across all its tabs. Each source has a fresh random ID; only one source
per streamer holds the server lease. The first source wins, renews every 20 seconds,
and loses ownership after 60 seconds without renewal. Others stay idle and retry
acquisition; only the owner reads chat and schedules routines. Takeover starts a
fresh routine interval. The server rejects non-owner command/routine requests and
checks ownership again before posting. Leases use Jule's cache with explicit
renewable expiry, in memory on our single server instance. Multiple server
instances would require shared, atomic lease storage. Existing private OBS URLs
remain unchanged; reload sources after upgrading to the lease protocol.

The Bot's Routines tab stores recurring message text, an enabled toggle, and an
interval in minutes (0.5–1440) in your existing Bot PDS settings. Timers live in
the browser source, not on the server. The first post waits a full interval;
closing the source stops timers, reopening starts fresh, and browser suspension
does not cause catch-up bursts. The server accepts only saved enabled routine IDs
through the private source token, enforces intervals across concurrent sources,
and writes messages as Streamface. Failed or uncertain sends are not retried.
Runtime interval counters use ephemeral server memory; stable per-window PDS
record keys provide additional duplicate protection across server restarts.
Publish the updated Bot settings lexicon before rolling out routines to PDSs.

The Streamface admin includes Emotes, Chat and Overlay Paint. Streamplace
Pets is temporarily excluded from cloud builds pending upstream permission;
its local integration remains available. Pokémon Blue and Crystal remain local-only. The local `bun run overlay`
workflow and its existing OBS URLs are unchanged.

Pets attribution and the unresolved upstream redistribution permission are
documented in `THIRD_PARTY_NOTICES.md`. Do not publish the bundled Pets code or
cloud image until that release blocker is resolved with the upstream authors.

Cloud OBS sources use your account DID in `?did=`:

| Source | Path |
| --- | --- |
| Emote effects | `/emotes/` |
| Emote command listing | `/emote-listings/` |
| Chat | `/chat/` |
| Overlay Paint | `/paint/` |
| Streamplace Pets | `/pets/` |

The old `/effect/` and `/board/` paths remain working aliases for existing OBS
sources. Published `live.streamface.emoticons.*` record IDs and existing storage
paths remain unchanged; “Emotes” is the user-facing module name.

All modules share the stream selected in the admin. Stream dimensions
are detected from Stream.place, with a 1920 × 1080 fallback and OBS setup
instructions. Each module supports pinning, collapsing, search and an inline
preview. Emotes previews play audio and use a separate cooldown channel;
Test dispatches to both the live source and the preview. Author avatars and
test placeholders appear with effects. The command listing keeps thumbnails,
usage examples, cooldown rings and automatic scrolling.

Chat uses the original renderer, including author avatars, appearance controls,
and its 20-second hold/10-second fade. Paint uses the original brush and cursor,
with transient account-isolated SSE drawing state. Chat appearance, Paint
appearance and enabled flags persist in the account's module-specific PDS settings records;
drawings and cooldowns do not. Paint fade delays are stored as integer
milliseconds. Pets run the upstream browser application directly, with their
existing external AT Protocol configuration; the upstream submodule is unchanged.

Direct HTTPS media files and PDS blob uploads are supported. Ordinary Giphy page
URLs are not direct playable media URLs. The checked-in
`live.streamface` Lexicons define the module records. Legacy `invalid.streamoverlay.dev`
records remain readable and migrate on the next save without deleting the originals.
See [the Lexicon and migration guide](lexicons/README.md) and follow
[the Koyeb deployment notes](infra/koyeb/README.md) before a real pilot.
`npm run deploy` packages safe local source and deploys it to `https://streamface.live`;
`npm run deploy:preview` stages it without uploading. Both also work with `bun run`.
The linked notes
describe the single-instance eNano pilot and required secret.

## Checks

```sh
bun run test
bun run typecheck
bun run build
```

## Emotes

Start with `bun run overlay`, select your streamer account, and open **Emotes**
in Admin and enable the module (new installations start it disabled). Create a command with an image/GIF, an audio file, or both. Drop files
into the corresponding upload area or use its file picker. Click **Create command**
or **Save changes** after uploads. Commands and uploaded assets persist locally in
`runtime/emoticons/commands.json` and `runtime/emoticons/assets/`; back up both
folders together. These runtime files are ignored by version control. Deleting a
command does not delete its uploaded files.

Chat messages are trimmed and matched case-insensitively: ` !WOW ` invokes `wow`.
Enter names with or without `!`; use letters, numbers, `_` or `-` (1–32 characters).
Check **Sticker** when creating or editing a command for a silent, spammable visual.
Each chat message immediately spawns a separate image, GIF, or muted looping video
at a random horizontal position near the bottom, drifting upward and fading out.
Append a multiplier, such as `!catjam x4`, to spawn several stickers at once.
The first spawn is immediate; remaining spawns are spread over three seconds.
Multipliers are capped at 30; larger values still run with 30 spawns.
Stickers default to a 5vw × 5vw box and an eight-second lifetime; CSS size and
duration remain configurable. They bypass effect queues and cooldowns, and can
overlap normal effects. Disabling the module clears both kinds.

Names are unique within Emotes. Other modules remain independent: configuring
`pet` here can invoke both this effect and Pokémon's pet behavior.

The first invocation enters the shared queue immediately. Its per-command
cooldown starts at acceptance (20 seconds by default, configurable, including 0).
Repeats during cooldown or while that command is queued/playing are ignored.
Different commands queue in arrival order and never display together. Duration
is five seconds by default and configurable; playback stops at that duration even
when the audio or video is longer. There is no trailing debounce or global cooldown.

Use the single media drop zone for images, GIFs, audio, MP4, MOV, and WebM files;
multiple files can be selected or dropped together. A new image or video replaces
the command's visual, while a separate audio attachment can accompany either.
Videos play their embedded audio at the configured volume. Video codecs must be
supported by the browser: use H.264/AAC in MP4 or VP9/Opus in WebM. VP9 WebM
also supports transparent video.

Add **two separate OBS Browser Sources**:

1. Effects: `http://localhost:3001/overlays/emoticons/`. Place above video; set
   **Width** and **Height** to your OBS base canvas dimensions, for example
   **1920 × 1080**. Admin reads Stream.place video segment dimensions and refreshes
   them every 30 seconds. If unavailable, it explicitly recommends 1920 × 1080;
   your actual OBS canvas remains authoritative. The transparent effect adapts to
   the browser source viewport. Images and videos keep their aspect ratio inside a default
   box of **40vw × 35vh**, centered horizontally at **5vh** from the top. Optional
   CSS width/height fields override the box per command (e.g. `500px`, `50vw`,
   `30vh`, `50%`, `auto`); leaving fields empty restores defaults.
2. Command listing: `http://localhost:3001/overlays/emoticons/board/`. Start at
   **420 × 600** and choose its size/position independently. Increase its height
   for longer command lists. It lists every saved command,
   updates live after edits without refreshing OBS, and emits no audio.

For the effects source, enable **Control audio via OBS** in Browser Source
properties. Adjust its mixer volume; choose **Monitor and Output** in
**Advanced Audio Properties → Audio Monitoring** if you also want to hear it
through your monitoring device. Keep **Shutdown source when not visible** and
**Refresh browser when scene becomes active** unchecked to maintain its WebSocket
connection. Use the effect URL’s open icon in Admin to preview effects in a separate
tab. Uploaded audio has a muted player you can explicitly unmute to audition it. **Test** follows the same
queue/cooldown rules and plays audio in connected OBS effect sources.

Turning Emotes off hides both sources, stops audio and clears pending effects.
Re-enabling starts empty. A disconnected source clears its display and never
replays historical effects after reconnecting. No additional server or port is
needed; all existing OBS URLs retain their behavior.

Emotes diagnostics use the existing host log file (its exact location is printed
at startup). Filter for `emoticons.` to follow command receipt, rejection reasons
(disabled, unknown, duplicate, queued, playing or cooldown), queue acceptance,
effect broadcasts and completion. Overlay logs report connections, effect
receipt/playback and image/audio failures. Effect IDs and client IDs correlate
host events with each OBS source or muted Admin preview. Ordinary chat messages
are not logged by this module.

Cloud diagnostics are emitted as one JSON object per line to stdout, so they appear
in the `bun run cloud:dev` terminal, Compose logs, and Koyeb service logs. Upload and
save failures show a `Reference` request ID in Admin; filter logs for that ID to
follow body reading, OAuth session restore, and the upstream PDS operation without
exposing credentials or media contents. Set `CLOUD_LOG_FILE` to additionally append
the same JSONL stream to a file; it should not point inside `AUTH_DATA_DIR`.
Direct local development also writes to `join(tmpdir(), "stream-overlay", "cloud.log")`
by default, alongside stdout. The exact path appears in the startup event's
`logFile` field. Production containers default to stdout only, which the hosting
platform collects; their temporary filesystem is not durable log storage.
