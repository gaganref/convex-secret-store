# Rotation by key version with bounded batches

/ Status: accepted. Supersedes
[ADR 0002](0002-rotation-self-consuming-slice.md).

## Why the self-consuming slice stalled

ADR 0002 restarts each batch at the beginning of `keyVersion < active`.
Successful rewraps leave that range, but removed-key secrets and failed unwraps
stay. A full batch of either prevents the chain from reaching healthy secrets.
Stopping when no rewrap succeeds mistakes that obstruction for completion.

## Version scans and continuation positions

Rotation uses `by_key_version` to skip between distinct versions, as
`keyVersions` does. Each skip reads one representative secret, not the whole
removed-key range. `lib.orphanKeyVersions` and the facade's `orphanKeyVersions`
query report distinct versions in use with no configured KEK, in ascending
order. They share `keyVersions`' bounded skip-scan and 100-version limit.
Versions above the active version are also orphans. `skipped` counts only failed
unwraps in the returned batch.

Every batch logs one warning per orphan version found, including continuations.
The warning names the version and says its rows stay untouched until the key is
re-added or the rows are removed. Each failed unwrap logs the secret name and
key version. Warnings never include key material or values.

For a configured version, rotation reads one native page in index order. The
internal continuation carries the version and its opaque cursor. The cursor
preserves the full position, including `_id` when creation times tie. Failed
unwraps therefore cannot hold later secrets at the start of the range. A
completed version advances the distinct-version scan past its failed secrets. If
the configured key-version set changes between batches, the next batch starts a
new scan, even when the active version stays the same. Continuations carry a
fingerprint of the sorted configured versions, without key material. Older
queued continuations without a fingerprint also restart from the beginning.

A timestamp-only position cannot distinguish tied secrets. Filtering on `_id`
would still read those secrets on the real backend. Native pagination supplies
the position without a new field, index, progress table, or custom cursor codec.
This replaces ADR 0002's assumption that every stale secret leaves the slice.

`isDone` describes the returned batch. It is true when that batch finds no
further configured version to process. Failed unwraps and removed-key versions
do not keep a chain alive. Repeated public `rotate` calls each start a new scan,
so a host loop that waits for `isDone` can keep retrying the same failed
unwraps. Call once and let the continuations run. `isRotationComplete` retains
its stronger existing contract. It is false while any secret differs from the
active version, including an orphan or failed secret. Operators must check it
before retiring a key, even when a batch reports done.

## Transaction budgets

Rotation pages contain at most 100 secrets. Before the page read, transaction
metrics determine the bytes available above an 8 MiB read reserve. The page uses
half that budget through `maximumBytesRead`, since patching can read the secret
again. The page limit can overshoot by one document. The reserve leaves room for
that document, audit events, and the next distinct-version probe. When metrics
are missing or throw, the budget falls back to a fixed 8 MiB, so the page reads
about 4 MiB, plus at most one more document.

Both cleanups use async iteration, delete at most 100 rows, and check
`bytesRead.remaining` after each deletion. They stop at the 8 MiB reserve and
schedule another batch. When metrics are unavailable, they retain the 100-row
fallback, matching the compatibility pattern in expiry scheduling.

## Compatibility and retries

`lib.rotate`, `cleanup.cleanupSecrets`, and `cleanup.cleanupEvents` retain their
names, arguments, and exact v0.2.1 result shapes. In particular, `lib.rotate`
returns exactly `{ rotated, skipped, isDone }`. Hosts may use strict `returns`
validators, so even an optional extra result field breaks compatibility. New
data belongs in a new function, such as `orphanKeyVersions`. The stored schema
and the Convex peer range do not change.

Large batches may hit a deployment's write rate. The scheduler retries failed
scheduled batches.

Each batch commits its data changes and one internal continuation atomically. No
worker table or lock is needed. Convex OCC handles concurrent batches, and
secrets already on the active version leave the source range. Calling `rotate`
again starts from the beginning and retries failed secrets after key recovery.

A rollback to v0.2.1 can leave one queued continuation per in-flight chain that
names an internal function absent from v0.2.1. That job fails once without any
writes or further jobs. Already committed rewraps and deletions remain correct,
and no batch can leave a partial rewrap. The operator reruns `rotate` after
rollback to resume under v0.2.1. Cleanup resumes through its public entry point
or the host's next cron invocation.
