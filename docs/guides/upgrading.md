# Upgrade from 0.2 to 0.3

This guide lists what to change before you move an app from 0.2.x to 0.3.0, and
how to roll back to 0.2.1.

## Split queries that page more than once

In 0.3.0, `list` and `listEvents` use Convex's built-in pagination. Convex
allows one paginated call per query, and a call into a component counts. A query
that does either of these now throws:

- It calls `list` more than once, for example in a loop over pages.
- It calls both `list` and `listEvents`.

Give each paginated read its own query, and let the client call each one:

```ts
// convex/secretsPage.ts
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { secrets } from "./secrets.js";

export const listSecrets = query({
  args: { namespace: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { namespace, paginationOpts }) => {
    // Check that the caller may read this namespace first.
    return await secrets.list(ctx, { namespace, paginationOpts });
  },
});

export const listActivity = query({
  args: { namespace: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { namespace, paginationOpts }) => {
    // Check that the caller may read this namespace first.
    return await secrets.listEvents(ctx, { namespace, paginationOpts });
  },
});
```

Both queries work with `usePaginatedQuery` from `convex/react`. To read every
page on the server, loop in an action instead. Each `ctx.runQuery` call from an
action is its own query.

## Find removed keys with `orphanKeyVersions`

In 0.2.x, `rotate` counted secrets on a removed key version in `skipped`. In
0.3.0, `skipped` counts only secrets whose data key failed to unwrap, which
happens when the key material under a version changed. Rotation passes over
secrets on a removed version and continues with the rest.

If your code checks `skipped > 0` to detect a removed key, call
`secrets.orphanKeyVersions(ctx)` instead. It returns the key versions that
secrets use but `SECRET_STORE_KEYS` no longer contains. See
[Recover a removed key](keys.md#recover-a-removed-key).

## Leave scheduling room for your own functions

In 0.3.0, each `put` or `update` that writes an expiry also schedules one
function, while more than 500 of the mutation's scheduling slots remain. Convex
allows 1000 scheduled functions per mutation. A host mutation that writes
expiring secrets and then schedules more than 500 functions of its own can now
hit that limit, where 0.2.x did not.

To avoid it, schedule your own functions before the secret writes, or split the
work across mutations. When 500 or fewer slots remain, the component schedules
nothing, and the secrets still read as expired on time. See
[Know when the component schedules no function](expiry.md#know-when-the-component-schedules-no-function).

## Upgrade

1. Make the changes above.
2. Install the new version.

   ```sh
   npm install convex-secret-store@0.3.0
   ```

3. Deploy with `npx convex deploy`.

There is no migration to run. The schema accepts every row that 0.2.x wrote, and
the Convex peer range is still `^1.39.0`.

After the upgrade:

- Every function keeps its name, arguments, and result fields, so strict
  `returns` validators in your code keep passing.
- A client that holds a page cursor from 0.2.x gets the first page again, with
  no error.
- Secrets written by 0.2.x have no scheduled expiry function. They read as
  expired on time, but an open page shows the change only after a reload or
  another read. Each one gets a scheduled function at its next `put`, or at its
  next `update` that sets `ttlMs`.

Version 0.3.0 also adds these:

- `keyVersions` and `orphanKeyVersions`, which list the key versions in use and
  the ones with no configured key.
- `convex-secret-store/envelope`, for encryption outside Convex. See
  [Read and write secrets in other runtimes](outside-convex.md).
- A scheduled function that marks each expiring secret as expired, so open pages
  update. See [Expire secrets](expiry.md).

## Roll back to 0.2.1

1. Remove calls to `keyVersions`, `orphanKeyVersions`, and
   `convex-secret-store/envelope`, which 0.2.1 does not have.
2. Install 0.2.1 and deploy.

   ```sh
   npm install convex-secret-store@0.2.1
   npx convex deploy
   ```

The deploy succeeds with the data 0.3.0 wrote, and expiry functions that 0.3.0
scheduled run as no-ops.

If a rotation or cleanup was still running, its next queued batch names a
function that 0.2.1 does not have. That batch fails once, with no writes and no
further batches. Batches that already ran stay correct. Call `rotate` again on
0.2.1 to finish the rotation. Cleanup continues at its next cron run or call.

0.2.1 cannot read page cursors from 0.3.0. Reload open pages after the rollback
so they start from the first page.
