# Scheduled mutations materialize secret expiry

/ Status: accepted

## Context

A host query can stay subscribed while a secret passes its `expiresAt`. Passing
`now` through the facade, as in ADR 0004, does not make that subscription run
again when time passes. The example can keep showing an active secret until
another write or a reload.

Version 0.2.1 prepared a rollback bridge. Its schema accepts optional
`expiredAt`, its writes clear that flag when expiry changes, and its internal
`expiry.expire` accepts scheduled jobs but does nothing.

## Decision

This decision adds the scheduled flip. [ADR 0004](0004-now-as-query-argument.md)
still supplies the read-time check.

`put` schedules `internal.expiry.expire` when the expiry it writes is within
five years minus one day. `update` schedules it when a supplied `ttlMs` sets a
new expiry within that horizon. Convex rejects jobs more than five years ahead.
The one-day margin keeps scheduling inside that limit. Before each job, the
component reads `ctx.meta.getTransactionMetrics()`. It schedules only when
`functionsScheduled.remaining` is greater than `HOST_SCHEDULING_RESERVE`, set
to 500. Each expiry job leaves at least 500 scheduling slots for the host. The
count includes scheduling by earlier component calls in the same host
transaction. The component creates at most 500 expiry jobs per transaction, and
fewer if the host has already scheduled jobs. It skips the job at or below the
reserve. If transaction metrics are missing or throw, it schedules as before for
compatibility with older test runtimes. Errors from `runAt` still reject the
write.

Far-future expiries remain valid, including those from
`SECRET_STORE_DEFAULT_TTL_MS`, but get no job. Metadata-only updates keep the
existing expiry and job. Removing expiry schedules nothing.

The job accepts exactly `{ secretId: v.id("secrets"), expiresAt: v.number() }`.
It reads the secret and returns without a write if the secret is absent, its
`expiresAt` no longer matches, or `expiredAt` is already set. Otherwise it sets
`expiredAt` to its run time. No job IDs are stored and no jobs need
cancellation. A stale job after an overwrite, a TTL change, a TTL removal, or a
deletion is harmless. Repeated jobs preserve the first flag.

`get` and `list` report expiry when `expiredAt` is set, or when the supplied
`now` is at or past `expiresAt`. The component accepts optional `now`, widened
from the required argument in 0.2.1. Without `now`, only the flag determines
expiry. Component queries never read the wall clock. The facade keeps passing
`now: Date.now()` as in 0.2.1. `now` is not deprecated.

The flag invalidates subscribed queries. The read-time check rejects expired
secrets before a delayed job runs, for older rows without a job, for writes that
skip a job to preserve the host reserve, and for far-future expiries. Both
checks are needed. The local cache repro showed that removing `now` let a fresh
host action return expired plaintext from a cached component query for a row
with no job. The 0.2.1 facade returned `expired` for the same row because it
supplied a new `now`.

`cleanupSecrets` keeps its 0.2.1 deletion body and return shape. It does not
scan or flag retained secrets. A trial pass that filtered unflagged secrets
after scanning the expiry index exceeded read limits on retained,
already-flagged secrets and rolled back cleanup deletions. Removing that pass
preserves cleanup behavior without a new index or migration.

Secrets without a job still read as expired through `now`. This includes old
rows and writes that reach the scheduling reserve. They gain a live flip after
their next rewrite that schedules a job, either a `put` or an `update` with a
new TTL within the horizon and available scheduling budget. Metadata-only
updates and cleanup do not add jobs.

## Rollback to 0.2.1

The schema and audit event types do not change. The optional flag already exists
in 0.2.1, so a rollback deploy accepts rows flagged by this version. Jobs queued
by this version still validate against 0.2.1's `expiry.expire` because its name
and argument validator are unchanged. The old handler consumes them as no-ops.
Cleanup continuations retain their existing function name and arguments too.

After rollback, 0.2.1 retains its earlier query behavior. Scheduled jobs no
longer flip expiry, and new writes still clear obsolete flags. No migration is
required for correct reads in this version or for a rollback deploy.

## No audit event for the flip

The flip records no audit event. `secretEvents` has no `changed` field and no
`expired` event type. Adding either would make 0.2.1 reject those rows during a
rollback deploy. Recording a synthetic `updated` event would also imply a user
write and add audit noise. Expiry is already part of the secret's TTL contract.
Cleanup deletions keep their existing `deleted` event with `expired_cleanup`.

## Consequences

Expiring writes within the scheduling horizon cost one scheduled mutation when
the transaction has more than 500 scheduling slots remaining. Old jobs may still
run after a TTL changes, but their checks prevent them from changing the current
secret. The flip changes neither `updatedAt` nor the secret's audit history.

Subscribed host queries refresh when the expiry mutation commits, so scheduler
delay can postpone the visible flip. Passing `now` protects each read when it
runs, but time alone does not invalidate a subscribed query. Rows without a job
need a new read to reflect elapsed time. Correct reads do not depend on cleanup
or a migration having run.
