# Expire secrets

This guide shows how to give a secret an expiry time, change it later, and set a
default for every write. It also lists the cases where an open page does not
show the expiry by itself.

## Set an expiry when you write a secret

Pass `ttlMs`, the number of milliseconds the secret stays usable, to `put`:

```ts
await secrets.put(ctx, {
  namespace: "acme",
  name: "openai",
  value,
  ttlMs: 24 * 60 * 60 * 1000,
});
```

`put` sets `expiresAt` from `ttlMs` on every write:

| `ttlMs`              | `expiresAt`                         |
| -------------------- | ----------------------------------- |
| A positive integer   | `now + ttlMs`                       |
| `null`               | No expiry                           |
| Omitted, default set | `now + SECRET_STORE_DEFAULT_TTL_MS` |
| Omitted, no default  | No expiry                           |

`ttlMs` must be a positive integer. `0`, a negative number, or a fraction throws
`invalid_argument`.

Because every `put` sets the expiry again, overwriting a secret without `ttlMs`
replaces its old expiry with the default, or removes it when there is no
default. [ADR 0003](../adr/0003-put-recomputes-expiry.md) explains why.

## Set a default expiry

To give every write without `ttlMs` an expiry, set `SECRET_STORE_DEFAULT_TTL_MS`
on the component. Like `SECRET_STORE_KEYS`, the component reads it only through
your app config.

1. Declare the variable as optional and pass it to the component.

   ```ts
   // convex/convex.config.ts
   import { defineApp } from "convex/server";
   import { v } from "convex/values";
   import secretStore from "convex-secret-store/convex.config";

   const app = defineApp({
     env: {
       SECRET_STORE_KEYS: v.string(),
       SECRET_STORE_DEFAULT_TTL_MS: v.optional(v.string()),
     },
   });

   app.use(secretStore, {
     env: {
       SECRET_STORE_KEYS: app.env.SECRET_STORE_KEYS,
       SECRET_STORE_DEFAULT_TTL_MS: app.env.SECRET_STORE_DEFAULT_TTL_MS,
     },
   });

   export default app;
   ```

2. Set the default in milliseconds. This example uses 30 days.

   ```sh
   npx convex env set SECRET_STORE_DEFAULT_TTL_MS 2592000000
   ```

The value must be a positive integer. An empty value counts as unset. Any other
value makes every call that reads the key configuration throw `invalid_keys`.

## Change an expiry without rewriting the value

To change only the expiry, call `update`. It does not decrypt or re-encrypt the
value.

```ts
await secrets.update(ctx, {
  namespace: "acme",
  name: "openai",
  ttlMs: 7 * 24 * 60 * 60 * 1000,
});
```

- A positive integer sets `expiresAt` to `now + ttlMs`.
- `null` removes the expiry.
- Omitting `ttlMs` keeps the current expiry. `update` never applies the default.

`update` returns `{ updated: false }` when the secret does not exist.

## Read an expired secret

Once a secret expires:

- `get` returns `{ ok: false, reason: "expired" }`.
- `getOrThrow` throws `expired`.
- `list` returns the secret with `effectiveState: "expired"`.

The secret stays in the database until cleanup deletes it. See
[Delete expired secrets and old events](cleanup.md).

## How an open page sees the expiry

When `put` or `update` writes an expiry, the component also schedules a function
for that time. The function marks the secret as expired. Convex then reruns
every subscribed query that read the secret, so an open page shows it as expired
without a reload. Scheduler delay can postpone that change. The mark does not
change `updatedAt` and records no audit event.

Each read also compares the expiry with the current time. The component's `get`
and `list` queries take an optional `now` argument, and `SecretStore` always
passes `Date.now()`. A secret reads as expired when it is marked, or when `now`
is at or past `expiresAt`. A secret without a scheduled function still reads as
expired, but an open page shows it only after its query runs again. If you call
the component's queries directly instead of through `SecretStore`, pass
`now: Date.now()`. Without `now`, only the mark counts.
[ADR 0004](../adr/0004-now-as-query-argument.md) and
[ADR 0005](../adr/0005-expiry-scheduled-flip.md) record both checks.

## Know when the component schedules no function

In these cases, the secret still reads as expired on time, but an open page does
not change until its query runs again:

- The expiry is more than about five years away. Convex cannot schedule a
  function that far ahead, so the component schedules none when the expiry is
  more than five years minus one day away.
- The mutation is running out of scheduling room. Convex allows 1000 scheduled
  functions per mutation. The component schedules an expiry function only while
  more than 500 remain, so the host always keeps at least 500. One mutation that
  writes many expiring secrets schedules at most 500 of these functions, and
  fewer if your code scheduled functions before the writes.
- The secret was written by version 0.2.x. It gets a scheduled function at its
  next `put`, or at its next `update` that sets a new `ttlMs`. An `update` that
  changes only metadata, and cleanup, schedule nothing.
