# Key rotation iterates a self-consuming slice — no cursor, no progress table

/ Status: accepted

Key rotation rewraps every secret's DEK from older KEK versions onto the active
version. It runs as a **single self-rescheduling component mutation**: each batch
`.take(100)`s rows from the `by_key_version` index where
`keyVersion < activeVersion`, rewraps them in one transaction, and
`scheduler.runAfter(0, self)` while rows remain.

It deliberately does **not** use cursor-based pagination, even though
`@convex-dev/migrations` — the ecosystem reference for table iteration — does.
Migrations needs a cursor because it iterates an immutable index and migrated
rows stay in range. Rotation mutates `keyVersion`, which *is* the index key: a
rewrapped row leaves the `keyVersion < activeVersion` slice immediately. The
slice is self-consuming, so each batch scans a shrinking range from the start. A
cursor would encode a position in an ordering that rotation is actively changing
— the bug carried in the 0.1.x implementation, where a `numItems: 1` recheck
hack papered over cursor rows vanishing.

It also keeps **no progress/state table**. The two things the migrations state
table cannot live without — a persisted cursor, and a `workerId` to stop
duplicate runs from corrupting data — are both void here: there is no cursor,
and rewrapping is idempotent (a row already on the active version is simply not
in the slice, so a duplicate run is wasteful at worst, never wrong). Completion
is a one-row indexed `.first()` (`isRotationComplete`); a duplicate or stalled
run is resolved by calling `rotate()` again.

Because each batch is one transaction, concurrency relies on Convex OCC alone —
no compare-and-swap. The 0.1.x CAS protocol existed only because that design
read and wrote in separate transactions.

**Future readers:** the absence of a cursor and a progress table is deliberate.
Do not "fix" rotation by adding migrations-style pagination — it reintroduces
the 0.1.x slice-iteration bug.
