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

The local integration remains available, but do not publish the bundled Pets
HTML/CSS/JavaScript as part of the hosted service or redistribute cloud images
until the authors grant permission or publish an applicable licence. Before
release, record that permission here, or include the licence and all notices it
requires. Attribution alone does not resolve this release blocker.

Default cloud builds exclude this upstream code and hide its module. The local
integration and an explicit `pets` Docker target are retained for reinstatement
after permission; see `infra/koyeb/README.md`. The default hosted image can be
released without the Pets integration.
