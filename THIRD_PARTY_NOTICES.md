# GIPHY

GIF search and ID resolution use the official `@giphy/js-fetch-api` SDK.
The Powered by GIPHY mark is the unmodified official light-background asset.
GIPHY content is loaded directly from its service, not redistributed with this app.
Only GIF IDs are persisted; resolved URLs and files are not stored in a custom
persistent cache. Loaded browser images are retained while the page is open.
API access and content usage remain subject to GIPHY's developer terms.

# Streamplace Pets

Upstream: https://github.com/streamplace/streamplace-pets

The upstream Git history credits Eli Mallon (`iameli`), QuietImCoding, and
flo-bit. The source is kept as an unmodified Git submodule; this project is an
integration, not the author of Streamplace Pets.

On 2026-10-09, both the checked-out upstream tree and the current upstream root
contained no licence file. GitHub's repository metadata also reported no licence.
Do not treat a public GitHub repository as a redistribution grant.

On 2026-10-10, the Streamface owner requested inclusion in the v0.1.0 hosted
demo so the author can review the integration. The owner reports that the author
wants to see it and will remove the integration if the author declines. This
records the demo decision, not a licence or redistribution grant. Permission for
broader release remains unresolved; record a grant or applicable licence here
when available. Attribution alone does not grant redistribution rights.

Default cloud builds exclude this upstream code and hide its module. The local
integration and an explicit `pets` Docker target are retained. The deployment
script currently selects that target for the author demo; `--without-pets`
restores the Pets-free archive and hosted target. See `infra/koyeb/README.md`.
