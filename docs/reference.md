# API reference

This page lists every method of `SecretStore`, the configuration the component
reads, and the errors it throws. Methods appear in the order of
[`src/client/operations.ts`](../src/client/operations.ts).

## Configuration

The component reads two environment variables, passed to it through
`app.use(secretStore, { env })` in `convex/convex.config.ts`.

| Variable                      | Required | Value                                                                               |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `SECRET_STORE_KEYS`           | Yes      | Comma-separated `version:value` entries. Each value is 32 bytes in standard base64. |
| `SECRET_STORE_DEFAULT_TTL_MS` | No       | A positive integer. `put` uses it when `ttlMs` is omitted. An empty value is unset. |

The highest version in `SECRET_STORE_KEYS` is the active version.
[Manage encryption keys](guides/keys.md) describes the format and both ways to
bind it.

## `SecretStore`

```ts
class SecretStore<
  Namespace extends string = string,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(component: ComponentApi);
}
```

`component` is the mounted component, `components.secretStore`. The constructor
takes no other options.

| Type parameter | Constrains                                        | Default                   |
| -------------- | ------------------------------------------------- | ------------------------- |
| `Namespace`    | The `namespace` argument of every method          | `string`                  |
| `Metadata`     | The `metadata` argument and the `metadata` result | `Record<string, unknown>` |

The type parameters exist only at compile time. The component stores a plain
string namespace and any record of Convex values as metadata.

```ts
// convex/secrets.ts
import { SecretStore } from "convex-secret-store";
import { components } from "./_generated/api.js";

export const secrets = new SecretStore<
  `${string}:${"production" | "testing"}`,
  { owner?: string; label?: string }
>(components.secretStore);
```

Each method takes a Convex context as its first argument. Methods that read take
a query, mutation, or action context (`RunQueryCtx`). Methods that write take a
mutation or action context (`RunMutationCtx`).

A namespace is optional everywhere. Omitting it selects the secrets with no
namespace, not every secret. An empty string throws `invalid_argument`.

## `put`

```ts
put(
  ctx: RunMutationCtx,
  args: {
    namespace?: Namespace;
    name: string;
    value: string;
    metadata?: Metadata | null;
    ttlMs?: number | null;
  },
): Promise<{
  secretId: SecretId;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  isNew: boolean;
}>;
```

Encrypts `value` and stores it under `namespace` and `name`, replacing any
secret with the same pair.

- `value` is at most 64 KiB (65,536 bytes) as UTF-8.
- `metadata` is stored in plain text. On overwrite, omitting it keeps the old
  metadata, and `null` removes it.
- `ttlMs` sets `expiresAt` to `now + ttlMs`. `null` removes the expiry. Omitting
  it applies `SECRET_STORE_DEFAULT_TTL_MS` when set, and otherwise removes the
  expiry. Every `put` sets the expiry this way, including an overwrite.
- `isNew` is `true` when no secret had this namespace and name.
- `createdAt` is the time the secret was first stored.

Records a `created` or `updated` audit event.

| Error              | When                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_argument` | `namespace` is `""`, `name` is empty or only spaces, `ttlMs` is not a positive integer, or `metadata` holds a value Convex cannot store, such as a `Date` |
| `value_too_large`  | `value` is over 64 KiB                                                                                                                                    |
| `invalid_keys`     | The key configuration is missing or malformed                                                                                                             |

## `get`

```ts
get(
  ctx: RunQueryCtx,
  args: { namespace?: Namespace; name: string },
): Promise<
  | {
      ok: true;
      value: string;
      metadata: Metadata | undefined;
      expiresAt?: number;
      updatedAt: number;
    }
  | { ok: false; reason: "not_found" | "expired" | "key_unavailable" }
>;
```

Decrypts and returns a secret. The checks run in this order:

| `reason`          | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| `not_found`       | No secret has this namespace and name.                  |
| `expired`         | The secret is past its `expiresAt`.                     |
| `key_unavailable` | The secret's key version is not in `SECRET_STORE_KEYS`. |

`get` passes `Date.now()` to the component as `now`. See
[Expire secrets](guides/expiry.md) for how reads decide that a secret expired.

There is no `has` method. To check that a secret exists and is usable, use
`(await secrets.get(ctx, { name })).ok`.

| Error               | When                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_argument`  | `namespace` is `""`, or `name` is empty or only spaces                                                                                               |
| `invalid_keys`      | The key configuration is missing or malformed                                                                                                        |
| `decryption_failed` | The stored ciphertext does not decrypt with the configured key for its version. The key material under that version changed, or the row was altered. |

## `getOrThrow`

```ts
getOrThrow(
  ctx: RunQueryCtx,
  args: { namespace?: Namespace; name: string },
): Promise<{
  value: string;
  metadata: Metadata | undefined;
  expiresAt?: number;
  updatedAt: number;
}>;
```

Returns the same data as a successful `get`, without `ok`. Where `get` returns
`{ ok: false, reason }`, `getOrThrow` throws a `ConvexError` whose `data.code`
is the reason and whose `data.message` is
`secret "<name>" is unavailable: <reason>`. It also throws every error that
`get` throws.

```ts
// convex/ai.ts
import { action } from "./_generated/server.js";
import { secrets } from "./secrets.js";

export const callOpenAI = action({
  args: {},
  handler: async (ctx) => {
    const apiKey = await secrets.getOrThrow(ctx, {
      namespace: "acme:production",
      name: "openai",
    });
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey.value}` },
    });
    return response.status;
  },
});
```

## `list`

```ts
list(
  ctx: RunQueryCtx,
  args: {
    namespace?: Namespace;
    paginationOpts: PaginationOptions;
    order?: "asc" | "desc";
  },
): Promise<{
  page: Array<{
    secretId: SecretId;
    namespace?: string;
    name: string;
    metadata: Metadata | undefined;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    effectiveState: "active" | "expired";
    keyVersion: number;
  }>;
  isDone: boolean;
  continueCursor: string;
}>;
```

Returns one page of the secrets in `namespace`, ordered by `updatedAt`. The
default order is `"desc"`, newest first. The result never contains a value.

- `effectiveState` is `"expired"` when the secret is past its expiry.
- `paginationOpts` is Convex's `{ numItems, cursor }`. Pass a host query's
  `paginationOpts` argument through unchanged to support `usePaginatedQuery`.
- A host query can make only one paginated call, and a call into the component
  counts. A query that calls `list` twice, or `list` and `listEvents`, throws.
- A cursor from version 0.2.x returns the first page.

| Error              | When                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `invalid_argument` | `namespace` is `""`, or the cursor came from a different namespace |

## `update`

```ts
update(
  ctx: RunMutationCtx,
  args: {
    namespace?: Namespace;
    name: string;
    metadata?: Metadata | null;
    ttlMs?: number | null;
  },
): Promise<{ updated: boolean; updatedAt?: number; expiresAt?: number }>;
```

Changes a secret's metadata, expiry, or both, without decrypting or
re-encrypting its value. Pass at least one of `metadata` and `ttlMs`.

- An omitted field keeps its current value. `null` removes it.
- `ttlMs` sets `expiresAt` to `now + ttlMs`. `update` never applies
  `SECRET_STORE_DEFAULT_TTL_MS`.
- `{ updated: false }` means no secret has this namespace and name. It has no
  other fields.
- When `updated` is `true`, `expiresAt` is present if the secret has an expiry
  after the update.

Records an `updated` audit event with `metadata: { changed }`, where `changed`
lists `"metadata"`, `"ttl"`, or both.

| Error              | When                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_argument` | Neither `metadata` nor `ttlMs` is passed, `namespace` is `""`, `name` is empty or only spaces, `ttlMs` is not a positive integer, or `metadata` holds a value Convex cannot store |

## `remove`

```ts
remove(
  ctx: RunMutationCtx,
  args: { namespace?: Namespace; name: string },
): Promise<{ removed: boolean }>;
```

Deletes a secret. `{ removed: false }` means no secret has this namespace and
name.

Records a `deleted` audit event with `metadata: { reason: "removed" }`.

| Error              | When                                                   |
| ------------------ | ------------------------------------------------------ |
| `invalid_argument` | `namespace` is `""`, or `name` is empty or only spaces |

## `listEvents`

```ts
listEvents(
  ctx: RunQueryCtx,
  args: {
    paginationOpts: PaginationOptions;
    order?: "asc" | "desc";
    // At most one of the filter sets below.
    secretId?: SecretId;
    namespace?: Namespace;
    name?: string;
    type?: "created" | "updated" | "deleted" | "rotated";
  },
): Promise<{
  page: Array<{
    eventId: string;
    secretId: SecretId;
    namespace?: string;
    name: string;
    type: "created" | "updated" | "deleted" | "rotated";
    metadata?: Record<string, any>;
    createdAt: number;
  }>;
  isDone: boolean;
  continueCursor: string;
}>;
```

Returns one page of audit events, ordered by creation time. The default order is
`"desc"`, newest first. The arguments accept one of these filters:

| Filter                 | Returns                                               |
| ---------------------- | ----------------------------------------------------- |
| `secretId`             | Events for one secret. No other filter may be passed. |
| `namespace`            | Events in the namespace.                              |
| `namespace` and `name` | Events for one secret name in the namespace.          |
| `namespace` and `type` | Events of one type in the namespace.                  |

Omitting `namespace` in the last three filters selects events with no namespace.
`name` and `type` cannot be passed together. The TypeScript type of `args`
rejects the invalid combinations.

The event `metadata` depends on `type`:

| `type`    | `metadata`                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- |
| `created` | None                                                                                            |
| `updated` | `{ changed: Array<"metadata" \| "ttl"> }` when written by `update`. None when written by `put`. |
| `deleted` | `{ reason: "removed" }` or `{ reason: "expired_cleanup" }`                                      |
| `rotated` | `{ fromVersion: number, toVersion: number }`                                                    |

The pagination rules of `list` apply here too: one paginated call per host
query, and a 0.2.x cursor returns the first page.

| Error              | When                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_argument` | `secretId` is passed with another filter, `name` and `type` are passed together, `namespace` is `""`, `name` is empty or only spaces, or the cursor came from a different filter |

## `keyVersions`

```ts
keyVersions(ctx: RunQueryCtx): Promise<number[]>;
```

Returns the distinct key versions that stored secrets use, in ascending order.

| Error              | When                                        |
| ------------------ | ------------------------------------------- |
| `invalid_argument` | Secrets use more than 100 distinct versions |

## `orphanKeyVersions`

```ts
orphanKeyVersions(ctx: RunQueryCtx): Promise<number[]>;
```

Returns the key versions that stored secrets use but `SECRET_STORE_KEYS` does
not contain, in ascending order. Secrets on these versions read as
`key_unavailable`.

| Error              | When                                          |
| ------------------ | --------------------------------------------- |
| `invalid_argument` | Secrets use more than 100 distinct versions   |
| `invalid_keys`     | The key configuration is missing or malformed |

## `rotate`

```ts
rotate(ctx: RunMutationCtx): Promise<{
  rotated: number;
  skipped: number;
  isDone: boolean;
}>;
```

Rewraps the data key of each secret that is not on the active version, under the
active version. The value's ciphertext does not change. One call runs one batch
of at most 100 secrets, also bounded by bytes read, and schedules the next
batch. Batches continue in the background.

The result describes only the batch that the call ran:

- `rotated` is the number of secrets rewrapped in the batch.
- `skipped` is the number of secrets in the batch whose data key failed to
  unwrap. This happens when the key material under a version changed. Each one
  logs a warning with the secret's name and key version.
- `isDone` is `true` when the batch found no further configured old version to
  process. Use `isRotationComplete` to check that rotation finished.

Secrets on a version that `SECRET_STORE_KEYS` does not contain stay untouched.
Each batch logs one warning per such version. Every call starts a new scan from
the lowest version, so calling `rotate` again after a key returns retries the
secrets a finished chain left behind.

Records a `rotated` audit event per rewrapped secret.

| Error          | When                                          |
| -------------- | --------------------------------------------- |
| `invalid_keys` | The key configuration is missing or malformed |

## `isRotationComplete`

```ts
isRotationComplete(ctx: RunQueryCtx): Promise<boolean>;
```

Returns `true` when every stored secret is on the active version. A secret on a
missing version, or one that failed to unwrap, keeps it `false`.

| Error          | When                                          |
| -------------- | --------------------------------------------- |
| `invalid_keys` | The key configuration is missing or malformed |

## `cleanupSecrets`

```ts
cleanupSecrets(
  ctx: RunMutationCtx,
  args?: { retentionMs?: number },
): Promise<{ deleted: number; isDone: boolean }>;
```

Deletes secrets whose `expiresAt` is more than `retentionMs` in the past. The
default `retentionMs` is 30 days (2,592,000,000 ms). Secrets with no expiry are
never deleted.

One call deletes at most 100 secrets, also bounded by bytes read, and schedules
the next batch while any remain. The result describes only that batch.

Records a `deleted` audit event with `metadata: { reason: "expired_cleanup" }`
per secret.

| Error              | When                                   |
| ------------------ | -------------------------------------- |
| `invalid_argument` | `retentionMs` is not a positive number |

## `cleanupEvents`

```ts
cleanupEvents(
  ctx: RunMutationCtx,
  args?: { retentionMs?: number },
): Promise<{ deleted: number; isDone: boolean }>;
```

Deletes audit events created more than `retentionMs` ago. The default
`retentionMs` is 180 days (15,552,000,000 ms). It does not depend on
`cleanupSecrets`.

Batches work as in `cleanupSecrets`. Deleting events records no event.

| Error              | When                                   |
| ------------------ | -------------------------------------- |
| `invalid_argument` | `retentionMs` is not a positive number |

## Errors

Every error the component throws is a `ConvexError` whose `data` is
`{ code, message }`.

| `code`              | Meaning                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `invalid_argument`  | An argument is out of range or a combination is not allowed. Each method above lists the cases.          |
| `invalid_keys`      | `SECRET_STORE_KEYS` is missing or malformed, or `SECRET_STORE_DEFAULT_TTL_MS` is not a positive integer. |
| `key_unavailable`   | `getOrThrow` read a secret whose key version is not configured.                                          |
| `decryption_failed` | A stored ciphertext did not decrypt. The key material under its version changed, or the row was altered. |
| `value_too_large`   | `put` received a value over 64 KiB.                                                                      |
| `not_found`         | `getOrThrow` found no secret with that namespace and name.                                               |
| `expired`           | `getOrThrow` read an expired secret.                                                                     |

Messages never contain key material or secret values. An `invalid_keys` message
names the position of a bad entry, not its value.

### `isSecretStoreError`

```ts
isSecretStoreError(
  error: unknown,
): error is ConvexError<{ code: SecretStoreErrorCode; message: string }>;
```

Returns `true` when `error` is a `ConvexError` whose `data.code` is one of the
codes above and whose `data.message` is a string.

```ts
import { isSecretStoreError } from "convex-secret-store";

try {
  await secrets.put(ctx, { name: "", value: "..." });
} catch (error) {
  if (isSecretStoreError(error)) {
    switch (error.data.code) {
      case "invalid_argument":
        // A bad argument.
        break;
      case "value_too_large":
        // The value is over 64 KiB.
        break;
      case "invalid_keys":
        // The deployment's keys are misconfigured.
        break;
    }
  }
}
```

## Exports

`convex-secret-store` exports:

- `SecretStore`, also as the default export.
- `defineKeys`, which validates a `{ [version]: value }` map and returns the
  `SECRET_STORE_KEYS` string.
- `isSecretStoreError`.
- Types: `CleanupArgs`, `CleanupResult`, `GetArgs`, `GetResult`, `GetSuccess`,
  `KeyEntry`, `ListArgs`, `ListEventsArgs`, `ListEventsResult`, `ListItem`,
  `ListResult`, `PaginationOptions`, `PutArgs`, `PutResult`, `RemoveArgs`,
  `RemoveResult`, `RotateResult`, `RunMutationCtx`, `RunQueryCtx`, `SecretId`,
  `SecretStoreErrorCode`, `SecretStoreErrorData`, `UpdateArgs`, and
  `UpdateResult`.

`convex-secret-store/convex.config` exports the component definition for
`app.use`. `convex-secret-store/envelope` exports the encryption functions
described in
[Read and write secrets in other runtimes](guides/outside-convex.md).
`convex-secret-store/test` exports `register` for
[convex-test](https://docs.convex.dev/testing/convex-test).
