# Contributing

Use Bun 1.4.2 or newer. Clone with submodules and run `bun install --frozen-lockfile`.

## Find the code

- `apps/local`: local API, filesystem persistence and process supervision.
- `apps/server`: cloud HTTP/OAuth/PDS adapters and transient relay state.
- `apps/web`: admin UI and cloud browser entrypoints.
- `modules/<name>/src`: module domain logic, rendering, configuration and host adapters.
- `packages`: shared chat sources, browser transport, protocol and module SDK.
- `modules/catalog.ts`: browser-safe cloud catalog used by the admin, static routes and build.

The catalog is curated, not a dynamically loaded plugin system. Local Pokémon modules
remain local-only. Never modify the `streamplace-pets` upstream submodule as part of an
ordinary contribution.

## Add or change a module

1. Keep browser-safe metadata in `manifest.ts`; use an existing module as an example.
   Register cloud modules in `modules/catalog.ts`. Its first page is the primary preview.
2. Keep filesystem paths, process commands and local persistence in `module.ts` and
   local adapters. Register the local adapter in `apps/local/src/modules.ts`.
3. Own validation and domain types in the module. Reuse them in browser and server;
   translate PDS records at the storage boundary, not in the renderer.
4. Add the HTML/browser entrypoint under `apps/web` for cloud use. Add module-specific
   admin controls and configuration fields explicitly; the catalog does not generate
   forms or persistence schemas. Test both hosts when changing shared code.
5. Document OBS sizing and requirements in module help. Preserve existing OBS URLs.

Chat demonstrates renderer/source injection; Paint demonstrates service reuse.
Use these existing seams rather than writing a second renderer for each host.
Admin sections use `CollapsibleSection.vue` and `module-section.css`.

## State boundaries

- User settings and media references persist on their PDS; local mode uses filesystem adapters.
- OAuth credentials belong to server credential storage, never public user records.
- Browser pages observe chat and own playback/queues/cooldowns. The relay distributes
  actual runtime updates to other pages; it is not a second playback authority.
- Relay/Paint state expires after inactivity. PDS configuration is only a cache:
  bounded to 200 accounts and evicted after one hour without access.
- Whole-configuration saves check the loaded revision. Handle conflicts by reloading;
  never silently retry a stale document over newer data.

## Verification and formatting

```sh
bun run test
bun run typecheck
bun run build
bun run format:check
```

Format only touched files with `bunx prettier --write <files>`. The formatting gate
covers the normalized foundation files listed in `scripts/format-targets.json`.
Extend that list as legacy files are cleaned up; avoid unrelated repository-wide diffs.

Use the existing structured logger for new flows and inspect actual logs when debugging.
Include operation IDs, stage names and rejection reasons; never credentials or media bodies.
Runtime/UI changes also need real HTTP/browser verification, not only mocked tests.

The repository has no root redistribution licence yet. A maintainer must choose one
before open-source release; consult `THIRD_PARTY_NOTICES.md` for upstream restrictions.
