# Delete expired secrets and old events

Expired secrets and audit events stay in the database until you delete them.
This guide shows how to delete them on a schedule.

## Know what each cleanup deletes

- `cleanupSecrets` deletes secrets whose `expiresAt` is more than `retentionMs`
  in the past. The default is 30 days. It records a `deleted` audit event with
  `metadata: { reason: "expired_cleanup" }` for each secret. It never deletes a
  secret that has no expiry.
- `cleanupEvents` deletes audit events created more than `retentionMs` ago. The
  default is 180 days. It runs separately from `cleanupSecrets`, so the audit
  history can outlive the secrets it describes.

`retentionMs` must be a positive number. Any other value throws
`invalid_argument`.

Each call deletes at most 100 rows in one transaction. It also stops early when
the transaction gets close to Convex's limit on bytes read. If rows remain, it
schedules another batch, and batches continue in the background until none
remain. The call returns `{ deleted, isDone }` for its own batch only.

## Run cleanup from a cron

A cron can call only functions in your app, not the component's functions
directly. Convex rejects a cron that points at `components.secretStore...` when
you push. Wrap each cleanup in an internal mutation, then schedule the
mutations.

```ts
// convex/cleanup.ts
import { internalMutation } from "./_generated/server.js";
import { secrets } from "./secrets.js";

export const cleanupSecrets = internalMutation({
  args: {},
  handler: async (ctx) => await secrets.cleanupSecrets(ctx),
});

export const cleanupEvents = internalMutation({
  args: {},
  handler: async (ctx) => await secrets.cleanupEvents(ctx),
});
```

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "cleanup expired secrets",
  { hours: 24 },
  internal.cleanup.cleanupSecrets,
);
crons.interval(
  "cleanup audit events",
  { hours: 24 },
  internal.cleanup.cleanupEvents,
);

export default crons;
```

To keep data for a different time, pass `retentionMs`, for example
`secrets.cleanupSecrets(ctx, { retentionMs: 7 * 24 * 60 * 60 * 1000 })`.
