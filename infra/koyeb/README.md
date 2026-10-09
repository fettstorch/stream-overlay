# Koyeb pilot deployment

Deploy `infra/koyeb/Dockerfile` as exactly one service instance in Frankfurt. Expose
port `$PORT` (default 8000) and configure an HTTP health check on `/health`. Attach a
persistent volume at `/data`; OAuth refresh sessions and authorization state are stored
under `AUTH_DATA_DIR` and must survive container replacement. Do not scale beyond one
instance until the in-memory relay has shared state or sticky account routing.

Required secrets/settings:

- `PUBLIC_ORIGIN`: final HTTPS origin, with no trailing slash.
- `SESSION_SECRET`: at least 32 random bytes, held only in Koyeb secrets.
- `LEXICON_NAMESPACE`: reverse-DNS namespace backed by a domain you control and whose
  schemas you have published. Rename the checked-in development schemas accordingly.
- `AUTH_DATA_DIR=/data/auth` and `PORT=8000`.

The server refuses a non-HTTPS external origin, the checked-in development
namespace, or the development session secret. Local loopback HTTP is accepted only
by the local Compose/direct-development workflows; do not reuse that configuration
in Koyeb. `compose.local.yml` builds this exact Dockerfile, but intentionally differs
from hosting in its loopback HTTP origin, development credentials/namespace, local
Docker network/resource limits, and named OrbStack volume.

The service accepts only direct HTTPS media URLs in records and PDS blob references.
Provider page URLs such as normal Giphy pages are not playable media URLs; use a direct
image/video URL or upload the file to the PDS. The service does not proxy arbitrary URLs.

Structured cloud diagnostics are written to stdout and are available in Koyeb's
service logs. Admin includes the correlated request ID in upload/save failures.
`CLOUD_LOG_FILE` is optional for a second JSONL file sink; stdout requires no extra
volume and remains the recommended container configuration.

No Koyeb resource is created by this repository. After providing an account, owned
domain/namespace, secrets, and volume, build locally with
`docker build -f infra/koyeb/Dockerfile .` before deploying.
