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

`put` schedules `internal.expiry.expire` at every `expiresAt` it writes.
`update` schedules it when a supplied `ttlMs` sets a new expiry. Metadata-only
updates keep the existing expiry and job. Removing expiry schedules nothing.

The job accepts exactly `{ secretId: v.id("secrets"), expiresAt: v.number() }`.
It reads the secret and returns without a write if the secret is absent, its
`expiresAt` no longer matches, or `expiredAt` is already set. Otherwise it sets
`expiredAt` to its run time. No job IDs are stored and no jobs need
cancellation. A stale job after an overwrite, a TTL change, a TTL removal, or a
deletion is harmless. Repeated jobs preserve the first flag.

`get` and `list` report expiry when `expiredAt` is set or the server clock is at
or past `expiresAt`. The flag invalidates subscribed queries. The clock check
rejects expired secrets before a delayed job runs and for older rows without a
job. `now` remains optional, accepted, ignored, and deprecated. The facade stops
sending it.

`cleanupSecrets` also flags past-expiry secrets without `expiredAt`, using the
existing `by_expires_at` index. It keeps its arguments and return fields,
deletes up to 100 secrets past retention, flags up to 100 remaining secrets, and
reschedules itself while either batch is full. Reads do not require the sweep to
have run. Existing subscriptions to older rows refresh when the sweep flags
them. Older rows with future expiry need a later sweep or a new write.

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

New expiring writes cost one scheduled mutation. Old jobs may still run after a
TTL changes, but their checks prevent them from changing the current secret. The
flip changes neither `updatedAt` nor the secret's audit history.

Subscribed host queries refresh when the expiry mutation commits, so scheduler
delay can postpone the visible flip. The clock check protects a query when it
runs, but cannot itself invalidate a cached query. The sweep restores reactive
expiry for past-expiry rows written by older versions. With no new index, its
filter may scan already-flagged rows to find the next batch.
