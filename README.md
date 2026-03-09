# Convex Secret Store

[![npm version](https://badge.fury.io/js/convex-secret-store.svg)](https://badge.fury.io/js/convex-secret-store)

<!-- START: Include on https://convex.dev/components -->

A [Convex](https://convex.dev) component for encrypted secret storage with
versioned key rotation, expiry, audit logging, and a typed server-side client.

```ts
const saved = await secrets.put(ctx, {
  namespace: "acme:production",
  name: "openai",
  value: process.env.OPENAI_API_KEY!,
  metadata: { owner: "platform" },
});

const loaded = await secrets.get(ctx, {
  namespace: "acme:production",
  name: "openai",
});

if (loaded.ok) {
  // loaded.value -> plaintext in memory
  // loaded.metadata -> plaintext metadata
}
```

What this component gives you:

- envelope encryption with a per-secret DEK and versioned KEKs
- explicit key rotation without rewriting secret plaintext
- expiry-aware reads and cleanup
- append-only audit events for create, update, delete, and rotate operations
- a typed `SecretStore` class for use in Convex queries, mutations, and actions

Found a bug? Feature request?
[File it here](https://github.com/gaganref/convex-secret-store/issues).

## Pre-requisite: Convex

You'll need an existing Convex project to use this component. Convex is a hosted
backend platform, including a database, serverless functions, and the generated
component wiring this package expects. If you haven't used Convex before, the
[Convex tutorial](https://docs.convex.dev/get-started) is a good place to start.

## Installation

```sh
npm install convex-secret-store
```

Install the component in your app's `convex.config.ts`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import secretStore from "convex-secret-store/convex.config.js";

const app = defineApp();
app.use(secretStore);

export default app;
```

## Quick Start

Create a shared `SecretStore` instance:

```ts
// convex/secrets.ts
import { SecretStore } from "convex-secret-store";
import { components } from "./_generated/api.js";

export const secrets = new SecretStore<{
  namespace: `${string}:${"production" | "testing"}`;
  metadata: { owner?: string; label?: string; notes?: string };
}>(components.secretStore, {
  keys: [
    { version: 2, value: process.env.SECRET_STORE_KEY_V2! },
    { version: 1, value: process.env.SECRET_STORE_KEY_V1! },
  ],
});
```

Use it inside your Convex functions:

```ts
// convex/integrations.ts
import { mutation, action } from "./_generated/server.js";
import { v } from "convex/values";
import { secrets } from "./secrets.js";

export const putOpenAIKey = mutation({
  args: {
    workspace: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    return await secrets.put(ctx, {
      namespace: `${args.workspace}:production`,
      name: "openai",
      value: args.value,
      metadata: { owner: "platform" },
    });
  },
});

export const callProvider = action({
  args: { workspace: v.string() },
  handler: async (ctx, args) => {
    const secret = await secrets.get(ctx, {
      namespace: `${args.workspace}:production`,
      name: "openai",
    });

    if (!secret.ok) {
      throw new Error(`Secret unavailable: ${secret.reason}`);
    }

    return {
      authHeaderPreview: `Bearer ${secret.value.slice(0, 4)}...`,
    };
  },
});
```

## How It Works

Each stored secret uses two encryption layers:

- **DEK**: a fresh random data-encryption key generated per secret value
- **KEK**: a longer-lived key-encryption key from your configured `keys`

When you call `put`:

1. the plaintext value is encrypted with a fresh DEK
2. that DEK is wrapped with the active KEK
3. Convex stores:
   - `encryptedValue`
   - `iv`
   - `wrappedDEK`
   - `dekIv`
   - `keyVersion`

When you call `get`:

1. the row is loaded from Convex
2. the stored `keyVersion` selects the correct KEK
3. the DEK is unwrapped
4. the secret value is decrypted in memory

When you rotate keys:

- the encrypted secret value does **not** change
- only the wrapped DEK layer is re-encrypted under a newer KEK

This is standard envelope-encryption behavior and keeps key rotation cheaper
than full plaintext re-encryption.

## Key Material

`keys` must contain base64-encoded 32-byte AES keys.

Generate one with:

```sh
openssl rand -base64 32
```

Rules:

- the first entry is the active key used for new writes
- later entries are decrypt-only keys used for old rows
- versions must be unique non-negative integers
- empty-string namespaces are rejected

## Typed Options

The `SecretStore` class accepts a generic parameter for type-safe namespaces and
metadata:

```ts
export const secrets = new SecretStore<{
  namespace: `${string}:${"production" | "testing"}`;
  metadata: {
    owner?: string;
    label?: string;
    notes?: string;
  };
}>(components.secretStore, {
  keys: [{ version: 1, value: process.env.SECRET_STORE_KEY_V1! }],
  defaults: {
    ttlMs: 30 * 24 * 60 * 60 * 1000,
  },
  logLevel: "warn",
});
```

Type options:

- `namespace` — any `string` subtype. When set, `namespace` becomes required on
  normal read/write/list operations.
- `metadata` — shape of the plaintext metadata object stored with each secret.

> **Note:** These are compile-time type constraints only. Runtime storage is
> still flexible:
>
> - `namespace` → `v.optional(v.string())`
> - `metadata` → `v.optional(v.record(v.string(), v.any()))`
>
> Existing stored rows are not migrated if you later change your TypeScript
> types.

## Usage

### Put

Encrypt and store a secret value:

```ts
const result = await secrets.put(ctx, {
  namespace: "acme:production",
  name: "stripe",
  value: "sk_live_...",
  metadata: { owner: "billing" },
  ttlMs: 90 * 24 * 60 * 60 * 1000,
});
```

Notes:

- `ttlMs` is converted to an absolute `expiresAt`
- when overwriting and omitting `metadata` or `ttlMs`, existing metadata and
  expiry are preserved
- use `update(..., { metadata: null, expiresAt: null })` to clear optional
  fields

### Get

Load and decrypt a secret:

```ts
const result = await secrets.get(ctx, {
  namespace: "acme:production",
  name: "stripe",
});
```

`get` returns:

- `{ ok: true, value, metadata, expiresAt, updatedAt }`
- `{ ok: false, reason: "not_found" | "expired" | "key_version_unavailable" }`

`key_version_unavailable` means the row exists, but the runtime no longer has
the KEK version needed to unwrap it.

### Has

Check whether a usable secret exists:

```ts
const exists = await secrets.has(ctx, {
  namespace: "acme:production",
  name: "stripe",
});
```

Expired secrets return `false`.

### Update

Update plaintext metadata or expiry without rewriting the encrypted value:

```ts
await secrets.update(ctx, {
  namespace: "acme:production",
  name: "stripe",
  metadata: { owner: "finance", label: "primary" },
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
});
```

Pass `null` to clear metadata or expiry entirely.

### Remove

Delete a secret and append a matching audit event:

```ts
await secrets.remove(ctx, {
  namespace: "acme:production",
  name: "stripe",
});
```

### List

Paginate secrets in one namespace:

```ts
const page = await secrets.list(ctx, {
  namespace: "acme:production",
  order: "desc",
  paginationOpts: { numItems: 20, cursor: null },
});
```

Notes:

- rows are ordered by `updatedAt`
- expired rows are still listed
- each row includes `effectiveState: "active" | "expired"`

### List Events

Paginate audit events:

```ts
const events = await secrets.listEvents(ctx, {
  namespace: "acme:production",
  paginationOpts: { numItems: 50, cursor: null },
});
```

You can also filter by `name`, `type`, or by `secretId`.

V1 restrictions:

- `name` and `type` cannot be combined
- when filtering by `name` or `type`, `namespace` is required
- `secretId` cannot be combined with `namespace`, `name`, or `type`

### Rotate Keys

Rewrap old rows from one key version to the active version:

```ts
const result = await secrets.rotateKeys(ctx, {
  fromVersion: 1,
  batchSize: 100,
  cursor: null,
});
```

Result fields:

- `fromVersion`
- `toVersion`
- `processed`
- `rotated`
- `skipped`
- `isDone`
- `continueCursor`

Important semantics:

- rotation rewraps DEKs only
- the encrypted secret plaintext is not rewritten
- concurrent writes are protected with compare-and-swap checks
- stale rows are skipped safely and can be retried in a later batch
- do not remove an old KEK until rotation is fully drained

### Cleanup Expired Secrets

Hard-delete secrets that have remained expired past the retention window:

```ts
const result = await secrets.cleanupSecrets(ctx, {
  retentionMs: 30 * 24 * 60 * 60 * 1000,
});
```

What `cleanupSecrets` does:

- deletes expired secret rows once they are older than the retention window
- writes a final `deleted` audit event with `deletedReason: "expired_cleanup"`
- processes up to 100 rows per run and automatically reschedules itself while
  backlog remains

### Cleanup Audit Events

Hard-delete audit events older than the retention window:

```ts
const result = await secrets.cleanupEvents(ctx, {
  retentionMs: 180 * 24 * 60 * 60 * 1000,
});
```

What `cleanupEvents` does:

- deletes audit rows independently from secret cleanup
- lets audit history outlive expired secrets when you want longer retention
- processes up to 100 rows per run and automatically reschedules itself while
  backlog remains

Recommended host-app pattern:

```ts
// convex/cleanup.ts
import { internalMutation } from "./_generated/server";
import { secrets } from "./secrets";

export const cleanupSecrets = internalMutation({
  handler: (ctx) =>
    secrets.cleanupSecrets(ctx, {
      retentionMs: 30 * 24 * 60 * 60 * 1000,
    }),
});

export const cleanupEvents = internalMutation({
  handler: (ctx) =>
    secrets.cleanupEvents(ctx, {
      retentionMs: 180 * 24 * 60 * 60 * 1000,
    }),
});
```

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup expired secrets",
  { hours: 24 },
  internal.cleanup.cleanupSecrets,
);
crons.interval(
  "cleanup secret audit events",
  { hours: 24 },
  internal.cleanup.cleanupEvents,
);

export default crons;
```

## Rotation Workflow

`keys[0]` is the active write key. Any remaining entries are older decrypt-only
keys.

```ts
keys: [
  { version: 3, value: process.env.SECRET_STORE_KEY_V3! }, // active
  { version: 2, value: process.env.SECRET_STORE_KEY_V2! }, // decrypt-only
  { version: 1, value: process.env.SECRET_STORE_KEY_V1! }, // decrypt-only
];
```

Recommended flow:

1. prepend a new key version to `keys`
2. deploy so new writes start using that version
3. run rotation for each older version you want to drain
4. keep old keys configured until those rows are fully rotated
5. deploy again with drained old versions removed

Recommended host-app wrappers:

See [`example/convex/rotate.ts`](./example/convex/rotate.ts) for a working
version of this pattern.

```ts
// convex/rotate.ts
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { secrets } from "./secrets";

async function rotateVersion(ctx: ActionCtx, fromVersion: number) {
  let cursor: string | null = null;

  while (true) {
    const result = await secrets.rotateKeys(ctx, {
      fromVersion,
      batchSize: 100,
      cursor,
    });

    if (result.isDone) {
      return result;
    }

    cursor = result.continueCursor ?? null;
  }
}

export const rotateSecretStoreVersion = internalAction({
  args: { fromVersion: v.number() },
  handler: async (ctx, args) => {
    return await rotateVersion(ctx, args.fromVersion);
  },
});

export const rotateSecretStoreToLatest = internalAction({
  handler: async (ctx) => {
    for (const fromVersion of [2, 1]) {
      await rotateVersion(ctx, fromVersion);
    }
  },
});
```

Optional temporary cron during a rotation window:

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "drain secret-store old keys",
  { minutes: 10 },
  internal.rotate.rotateSecretStoreToLatest,
);

export default crons;
```

Cleanup is a good permanent cron. Rotation is usually a temporary cron or a
manual admin action during a migration window.

This component does not use explicit locks during rotation. Instead, it uses
optimistic concurrency checks so concurrent writes do not corrupt rows. If a row
changes while rotation is in flight, the rewrap attempt is skipped safely and
retried by a later pass. A restart scan may return `continueCursor: null`; keep
looping until `isDone === true`.

## Security Model

- **Envelope encryption** — each secret gets its own random DEK, wrapped by a
  configured KEK.
- **Exact key version lookup** — reads use the stored `keyVersion`; they do not
  probe multiple keys.
- **AAD binding** — ciphertext is bound to `namespace`, `name`, and
  `keyVersion`, so moving ciphertext between rows should fail authentication.
- **No backend KEKs** — the Convex component stores ciphertext only. KEKs live
  in the host app runtime using the `SecretStore` client.
- **Plaintext metadata** — `metadata`, `namespace`, `name`, expiry, and audit
  metadata are not encrypted.

Important limitations:

- this protects secrets at rest in Convex, not against a compromised app runtime
- any code with access to your configured KEKs can decrypt secrets
- plaintext exists in memory while your server-side code uses it
- do not store sensitive data in metadata fields

## Configuration Options

Pass options when constructing the client:

```ts
new SecretStore(components.secretStore, {
  keys: [{ version: 1, value: process.env.SECRET_STORE_KEY_V1! }],
  defaults: {
    ttlMs: null,
  },
  logLevel: "warn",
});
```

Options:

- `keys` — required versioned KEKs
- `defaults.ttlMs` — default secret TTL in milliseconds
- `logLevel` — `"debug" | "warn" | "error" | "none"`

## Example App

See the [example/](./example) directory for a full reference app called **Secret
Store**.

It demonstrates:

- `Secrets` — store, replace, preview, and remove environment secrets
- `Activity` — audit history
- `Settings` — key rotation, cleanup, and demo seeding flows

> **Security note:** The example app keeps secret management intentionally
> simple. In a real app, gate secret write/read flows behind your authentication
> and authorization layer before exposing them to operators.

## Development

```sh
npm i
npm run dev
```

Useful commands:

```sh
npm run typecheck
npm run lint
npm test
```

<!-- END: Include on https://convex.dev/components -->
