# Koyeb pilot deployment

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

After permission is recorded in `THIRD_PARTY_NOTICES.md`, restore the existing
integration with the opt-in Docker target:

```sh
docker build --target pets -f infra/koyeb/Dockerfile -t streamface:pets .
```

This target includes the upstream assets, enables its admin card, and sets
`ENABLE_CLOUD_PETS=true` for the server. For direct development instead, build
with `VITE_ENABLE_CLOUD_PETS=true` and run the server with `ENABLE_CLOUD_PETS=true`.
Both switches deliberately default to false. The opt-in keeps the original
author attribution and project links. Do not publish this target before permission.

Required secrets/settings:

- `PUBLIC_ORIGIN`: final HTTPS origin, with no trailing slash.
- `SESSION_SECRET`: at least 32 random bytes, held only in Koyeb secrets.
- `LEXICON_NAMESPACE=live.streamface` (the default): the module schemas in `lexicons/`.
  Follow `lexicons/README.md` for publication and migration details.
- `AUTH_DATA_DIR=/data/auth` and `PORT=8000`.

The server refuses a non-HTTPS external origin, the checked-in development
namespace, or the development session secret. Local loopback HTTP is accepted only
by the local Compose/direct-development workflows; do not reuse that configuration
in Koyeb. `compose.local.yml` builds this exact Dockerfile, but intentionally differs
from hosting in its loopback HTTP origin, development credentials, local
Docker network/resource limits, and named OrbStack volume. Both use `live.streamface`.

The service accepts only direct HTTPS media URLs in records and PDS blob references.
Provider page URLs such as normal Giphy pages are not playable media URLs; use a direct
image/video URL or upload the file to the PDS. The service does not proxy arbitrary URLs.

Structured cloud diagnostics are written to stdout and are available in Koyeb's
service logs. Admin includes the correlated request ID in upload/save failures.
`CLOUD_LOG_FILE` is optional for a second JSONL file sink; stdout requires no extra
volume and remains the recommended container configuration.

No Koyeb resource is created by this repository. After providing an account, owned
domain/namespace, and secrets, build locally with
`docker build -f infra/koyeb/Dockerfile .` before deploying.
