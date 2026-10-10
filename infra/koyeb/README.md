# Koyeb pilot deployment

## Deploy local source through the CLI

Install and authenticate the Koyeb CLI, create an empty app with
`koyeb apps create streamface`, and create the `streamface-session-secret`
secret in the console. No GitHub integration or Git push is required.

Preview the deployment:

```sh
npm run deploy:preview
```

This only stages source in a temporary directory and prints the deployment
command. Inspect that directory or build it with Docker before proceeding.
For the v0.1.0 author demo it includes the upstream Pets checkout. It excludes runtime/session data, hidden files,
environment files, dependencies, generated builds, logs, and paths marked
prod/production or secret/credential. Symlinks are rejected rather than followed.
Only the required workspace source roots and build files are packaged.

When ready, deploy with one command (also works as `bun run deploy`):

```sh
npm run deploy
```

This uploads the staged source and creates or updates `streamface/web` using
the `pets` Docker target, one `eco-nano` instance in Frankfurt, HTTP port 8000,
and `/health`. It references the existing secret by name; it never reads a local
session secret. The default origin is `https://streamface.live`; the app and
secret setup above is one-time, not repeated per deployment.
Override it with `npm run deploy -- --origin https://YOUR-DOMAIN` for another deployment.
Other optional flags are `--target app/service`
and `--secret secret-name`.
Pets can be removed again with `npm run deploy -- --without-pets`; this excludes
the upstream checkout from the archive, uses the `hosted` target and disables
the module on both client and server.
The temporary directory is removed after execution; preview directories are kept
for inspection. A non-zero exit leaves diagnostics in the CLI output.

This script intentionally reapplies the documented pilot settings on every run;
it is not a source-only update that preserves arbitrary console configuration.
Review and adjust it before changing instance size, region, port or scaling in
the console. Inspect the service, logs and settings there after deployment.
The user-facing application is served at `/`, not `/admin/`. Old `/admin` bookmarks
redirect to `/`; that path is reserved for a possible future owner-only panel.
Attach your custom domain and update `PUBLIC_ORIGIN` before using that domain for
OAuth login; the configured origin must match the browser's URL.

```sh
koyeb service get streamface/web
koyeb service logs streamface/web --type build
koyeb service logs streamface/web
```

Root `README.md` links to this workflow. Never deploy the whole checkout with
`koyeb deploy .`: Docker ignore rules alone do not protect the uploaded source archive.

## Pilot configuration

Deploy `infra/koyeb/Dockerfile` as exactly one service instance in Frankfurt. Expose
port `$PORT` (default 8000) and configure an HTTP health check on `/health`. The initial
pilot uses `eco-nano` with no volume: OAuth refresh sessions and authorization state
are stored on ephemeral disk under `AUTH_DATA_DIR`. Container replacement loses these
sessions and requires a new admin login; settings and media remain on users' PDSs,
and public OBS URLs do not require login. The admin detects missing sessions and
returns to sign-in rather than attempting a PDS write. Keep `SESSION_SECRET` stable
in Koyeb secrets across deployments. For persistent login sessions later, move to a
standard instance with a volume mounted at `/data`, or an external session store.
Do not scale beyond one
instance until the in-memory relay has shared state or sticky account routing.

## Pets release switch

The default Docker target (`hosted`) and ordinary web builds exclude Streamplace
Pets from the admin, page entrypoints, and upstream HTML/CSS/JavaScript assets.
The server also rejects Pets URLs by default, including direct paths to stale files.
Saved Pets preferences are preserved; the local `bun run overlay` integration is unchanged.
No upstream Pets checkout is needed to build the default image. A CLI source archive
must also omit the top-level `streamplace-pets/` directory, not merely rely on
Docker's final-stage exclusion.

The deployment script currently explicitly selects the `pets` target for the
v0.1.0 author demo at the owner's request. This is not a recorded licence or
redistribution grant; see `THIRD_PARTY_NOTICES.md`. The plain Docker default
remains Pets-free. To build the demo image yourself:

```sh
docker build --target pets -f infra/koyeb/Dockerfile -t streamface:pets .
```

This target includes the upstream assets, enables its admin card, and sets
`ENABLE_CLOUD_PETS=true` for the server. For direct development instead, build
with `VITE_ENABLE_CLOUD_PETS=true` and run the server with `ENABLE_CLOUD_PETS=true`.
`npm run dev` sets both of these flags automatically for the author demo.
Both switches deliberately default to false. The opt-in keeps the original
author attribution and project links. Use `--without-pets` to disable it again
if the author declines; broader release permission remains unresolved.

Required secrets/settings:

- `PUBLIC_ORIGIN`: final HTTPS origin, with no trailing slash.
- `SESSION_SECRET`: at least 32 random bytes, held only in Koyeb secrets.
- `LEXICON_NAMESPACE=live.streamface` (the default): the module schemas in `lexicons/`.
  Follow `lexicons/README.md` for publication and migration details.
- `AUTH_DATA_DIR=/data/auth` and `PORT=8000`.
- Optional `GIPHY_API_KEY`: enables GIF search in Create new and ID resolution in OBS.
  `npm run deploy` references the existing Koyeb secret named `GIPHY_API_KEY` and
  maps `streamface-bot-app-password` to `BOT_APP_PASSWORD` by default. It never
  uploads local `.env` values. Override names with `--giphy-secret` / `--bot-secret`
  or `KOYEB_GIPHY_SECRET` / `KOYEB_BOT_SECRET`; pass an empty CLI override to omit
  an integration. Create these secrets once before deploying.
  This is a **public browser API key**, not a server secret: GIPHY requires direct
  browser API/media requests. It is never logged or stored in PDS records.
  Locally, set it in a gitignored `.env` and restart `bun run dev`; in Koyeb,
  configure the environment variable yourself. No deployment is performed automatically.
  Publish the updated Emotes `defs` and `command` lexicons before saving Giphy commands.
  Only GIF IDs are persisted; overlays resolve them during preload and load images
  directly from GIPHY, without our Blob/object-URL cache. Existing URLs/blobs are unchanged.

The server refuses a non-HTTPS external origin, the checked-in development
namespace, or the development session secret. Local loopback HTTP is accepted only
by the local Compose/direct-development workflows; do not reuse that configuration
in Koyeb. `compose.local.yml` builds this exact Dockerfile, but intentionally differs
from hosting in its loopback HTTP origin, development credentials, local
Docker network/resource limits, and named OrbStack volume. Both use `live.streamface`.
`npm run docker` selects the `pets` Docker target for the author demo too. After a
target change, restart that command so its existing `--build` rebuilds the image.

The service accepts only direct HTTPS media URLs in records and PDS blob references.
Provider page URLs such as normal Giphy pages are not playable media URLs; use a direct
image/video URL or upload the file to the PDS. The service does not proxy arbitrary URLs.

Structured cloud diagnostics are written to stdout and are available in Koyeb's
service logs. Admin includes the correlated request ID in upload/save failures.
`CLOUD_LOG_FILE` is optional for a second JSONL file sink; stdout requires no extra
volume and remains the recommended container configuration.

No Koyeb resource is created by this repository. After providing an account, owned
domain/namespace, and secrets, build locally with
`docker build --target pets -f infra/koyeb/Dockerfile .` before deploying the demo.
