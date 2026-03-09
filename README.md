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
- pass `metadata: null` only on overwrite if you want to remove metadata
- values larger than 64 KiB are rejected

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

### Cleanup

Run bounded cleanup for expired secrets and old audit events:

```ts
const result = await secrets.cleanup(ctx, {
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  batchSize: 100,
});
```

What cleanup does:

- deletes expired secret rows
- writes a `deleted` audit event with `deletedReason: "expired_cleanup"`
- deletes audit rows older than `retentionMs`

## Rotation Workflow

Recommended flow:

1. start with one key:

```ts
keys: [{ version: 1, value: process.env.SECRET_STORE_KEY_V1! }];
```

2. deploy a new active key first:

```ts
keys: [
  { version: 2, value: process.env.SECRET_STORE_KEY_V2! },
  { version: 1, value: process.env.SECRET_STORE_KEY_V1! },
];
```

3. new writes use version `2`
4. old rows on version `1` still decrypt
5. run `rotateKeys({ fromVersion: 1 })` until `isDone === true`
6. deploy again with version `1` removed

This component does not use explicit locks during rotation. Instead, it uses
optimistic concurrency checks so concurrent writes do not corrupt rows. If a row
changes while rotation is in flight, the rewrap attempt is skipped and can be
retried later.

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

See the [example/](./example) directory for a full reference app called
**Integration Vault**.

It demonstrates:

- `Connections` — store, replace, edit, and remove provider secrets
- `Usage` — safe server-side secret consumption without plaintext browser reveal
- `Activity` — audit history
- `Advanced` — key rotation and cleanup flows

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
