# Streamface records

`live.streamface` is backed by the owned `streamface.live` domain. Each module owns
its collection. Chat, Emoticons, Paint and Pets settings use a singleton `self`
record. Each Emoticons command has a stable record key independent of its invocation
name; media explicitly chooses an external HTTPS URL or an uploaded PDS blob.

All durations are integer milliseconds, volume is an integer percentage, and every
record has `createdAt` and `updatedAt`. Chat's `topFadePercent` is a spatial mask,
not message decay. Owner DID and command ID are inferred from repository/record
identity. OAuth sessions, live cooldowns and drawings are not repository records.

The server validates both reads and writes with the official ATProto Lexicon SDK,
plus app constraints (HTTPS media, safe command names, colors and CSS sizes).
`applyWrites` still uses `validate: false` until schema publication is configured;
this does **not** disable the local SDK validation. DNS and public schema records
have not been published by this change.

## Migration

With the default `LEXICON_NAMESPACE=live.streamface`, the server first reads the new
module collections. If none exist, it reads the old
`invalid.streamoverlay.dev.settings` and `.command` collections. Reads never write.
The next authenticated save creates all new module settings and command records in
one repository-CAS transaction. Legacy records remain untouched as a backup,
including their blob references. Once any new module records exist, they are
authoritative; subsequent edits to old records are not merged back in.

Record revisions include all records, including commands, so outside edits are
detected before overwriting. `swapCommit` also protects the read/write race. Missing
individual module settings get app defaults; malformed records are not silently
treated as a fresh account.

Existing sessions need a fresh ATProto login to authorize the new collections.
Remove any old `LEXICON_NAMESPACE` environment override to opt into the new adapter.
Explicit old namespace overrides retain the legacy adapter for compatibility.
Do not delete old records until migration and rollback requirements are reviewed.

## Publication (separate operational step)

Publish these schema documents to a chosen publisher account and configure the
module authority DNS records under `streamface.live`. Then enable PDS validation
and test against the target PDS. This requires publisher-account and DNS access;
no such external writes are performed by the application or migration tests.
