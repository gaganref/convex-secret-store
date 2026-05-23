# Convex Secret Store

[![npm version](https://badge.fury.io/js/convex-secret-store.svg)](https://badge.fury.io/js/convex-secret-store)
[![Convex Component](https://www.convex.dev/components/badge/convex-secret-store)](https://www.convex.dev/components/convex-secret-store)

<!-- START: Include on https://convex.dev/components -->

A [Convex](https://convex.dev) component for encrypted secret storage with
versioned key rotation, expiry, and append-only audit logging. Envelope
encryption runs inside the component; key-encryption keys (KEKs) are supplied
through Convex's typed component environment variables.

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
  // loaded.value -> plaintext
}
```

Found a bug? Feature request?
[File it here](https://github.com/gaganref/convex-secret-store/issues).

## What this gives you

- envelope encryption with a per-secret DEK and versioned KEKs
- explicit, in-place key rotation without rewriting secret plaintext
- expiry-aware reads, with separate `get` (Result) and `getOrThrow` ergonomics
- append-only audit events for `created`, `updated`, `deleted`, and `rotated`
- a typed `SecretStore` facade for Convex queries, mutations, and actions
- structured `ConvexError`s with stable codes — type-narrowed via `isSecretStoreError`

## Pre-requisite

A Convex project (`convex >= 1.39`, for typed component environment variables).
If you're new to Convex, start with the
[Convex tutorial](https://docs.convex.dev/get-started).

## Installation

```sh
npm install convex-secret-store
```

Mount the component in your app's `convex.config.ts`. The simplest setup
declares the KEK as a validated app env var and reads it via `defineKeys`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import { defineKeys } from "convex-secret-store";
import secretStore from "convex-secret-store/convex.config";

const app = defineApp({
  env: {
    MY_APP_KEK_V1: v.string(),
  },
});

app.use(secretStore, {
  env: {
    SECRET_STORE_KEYS: defineKeys({
      1: process.env.MY_APP_KEK_V1!,
    }),
  },
});

export default app;
```

Generate a KEK and set it on the deployment:

```sh
openssl rand -base64 32   # 32 bytes, canonical base64
npx convex env set MY_APP_KEK_V1 "<paste the value>"
```

Construct the typed facade once and re-export it:

```ts
// convex/secrets.ts
import { SecretStore } from "convex-secret-store";
import { components } from "./_generated/api.js";

export const secrets = new SecretStore<
  `${string}:${"production" | "testing"}`,
  { owner?: string; label?: string }
>(components.secretStore);
```

Use it from any query, mutation, or action:

```ts
import { action } from "./_generated/server.js";
import { secrets } from "./secrets.js";

export const callOpenAI = action({
  handler: async (ctx) => {
    const apiKey = await secrets.getOrThrow(ctx, {
      namespace: "acme:production",
      name: "openai",
    });
    return await fetch("https://api.openai.com/v1/...", {
      headers: { Authorization: `Bearer ${apiKey.value}` },
    });
  },
});
```

## Key configuration

### `SECRET_STORE_KEYS`

The component declares one required env var, `SECRET_STORE_KEYS`. Its value is a
delimited string of versioned KEKs:

```
1:<base64>,2:<base64>
```

Each entry is `version:value`. Each KEK value must be a canonical 32-byte
standard base64 string (44 chars ending in `=`) — the output of
`openssl rand -base64 32`.

You can build the value with `defineKeys` (typed, eagerly validated):

```ts
defineKeys({
  1: process.env.MY_APP_KEK_V1!,
  2: process.env.MY_APP_KEK_V2!,
})
```

…or set it directly on the deployment for hosts that don't want a builder:

```sh
npx convex env set SECRET_STORE_KEYS "1:AQEB...,2:AgIC..."
```

Either way, the **active key version is the highest configured version** — all
new writes use it. Older versions remain available for decrypting existing
rows.

Duplicate versions are caught at compile time when you use `defineKeys` (object
literals reject duplicate keys: `error TS1117`).

### `SECRET_STORE_DEFAULT_TTL_MS` (optional)

If set, `put` resolves an omitted `ttlMs` to `now + SECRET_STORE_DEFAULT_TTL_MS`.
See [Expiry](#expiry) below.

## API

### `SecretStore`

```ts
new SecretStore<
  Namespace extends string = string,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
>(components.secretStore)
```

The optional type parameters constrain the `namespace` shape and the `metadata`
record at compile time. They're a typing aid only — runtime storage stays a
plain string namespace and a freeform metadata record.

### `put`

```ts
await secrets.put(ctx, {
  namespace?: Namespace,
  name: string,
  value: string,                  // plaintext; max 64 KiB
  metadata?: Metadata | null,
  ttlMs?: number | null,
});
// → { secretId, createdAt, updatedAt, expiresAt?, isNew }
```

Encrypts and upserts by `namespace + name`. On overwrite, omitted `metadata` is
preserved and `null` clears it. Expiry is recomputed every write (see below).

### `get`

```ts
await secrets.get(ctx, { namespace?, name });
// → { ok: true, value, metadata, expiresAt?, updatedAt }
//   | { ok: false, reason: "not_found" | "expired" | "key_unavailable" }
```

Returns a discriminated result. `key_unavailable` means the row's `keyVersion`
is no longer in your configured `SECRET_STORE_KEYS` (you retired the key too
soon — see [Rotation](#key-rotation)).

### `getOrThrow`

```ts
await secrets.getOrThrow(ctx, { namespace?, name });
// → { value, metadata, expiresAt?, updatedAt }
// throws ConvexError with code "not_found" | "expired" | "key_unavailable"
```

Convenience for call sites that treat any failure as exceptional.

### `has`

```ts
await secrets.has(ctx, { namespace?, name });
// → boolean (false for missing or expired)
```

### `update`

```ts
await secrets.update(ctx, {
  namespace?, name,
  metadata?: Metadata | null,
  ttlMs?: number | null,
});
// → { updated, updatedAt?, expiresAt? }
```

Edits `metadata` and/or expiry **without** re-encrypting the value. Omitted
fields are preserved; `null` clears.

### `remove`

```ts
await secrets.remove(ctx, { namespace?, name });
// → { removed: boolean }
```

### `list`

```ts
await secrets.list(ctx, {
  namespace?,
  paginationOpts: { numItems, cursor },
  order?: "asc" | "desc",
});
```

Paginates secrets in a namespace, newest-`updatedAt` first by default. Each row
carries `effectiveState: "active" | "expired"`. The decrypted value is never
returned by `list`.

### `listEvents`

```ts
await secrets.listEvents(ctx, {
  paginationOpts,
  // one of:
  secretId?,
  namespace?,
  name?,                          // requires `namespace`
  type?: "created" | "updated" | "deleted" | "rotated",  // requires `namespace`
  order?,
});
```

V1 restrictions: `secretId` cannot combine with `namespace`/`name`/`type`; `name`
and `type` cannot combine with each other.

### `rotate`

```ts
await secrets.rotate(ctx);
// → { rotated, isDone }
```

Rewraps each stale secret's DEK onto the active KEK version, in batches of 100
per transaction, **self-rescheduling** until the backlog drains. The secret
plaintext is never rewritten. Safe to call repeatedly.

### `isRotationComplete`

```ts
await secrets.isRotationComplete(ctx);
// → boolean
```

`true` when every secret is on the active KEK version. Use this as the gate
before retiring an old key.

### `cleanupSecrets` / `cleanupEvents`

```ts
await secrets.cleanupSecrets(ctx, { retentionMs? });   // default 30 days
await secrets.cleanupEvents(ctx, { retentionMs? });    // default 180 days
```

Hard-deletes expired secrets (and writes a `deleted` event with reason
`expired_cleanup`) / old audit events. Self-reschedules; suitable for a
recurring cron.

## Expiry

```
expiresAt = ttlMs                       if ttlMs is a number
          = no expiry                   if ttlMs is null
          = now + SECRET_STORE_DEFAULT_TTL_MS  if ttlMs is omitted and a default is set
          = no expiry                   otherwise
```

Expiry is **recomputed on every `put`** (ADR 0003). To change expiry without
rewriting the value, use `update`.

## Key rotation

Rotation is a deploy-time exercise. The component drains in the background once
triggered.

1. **Deploy with a new key.** Add the new version to `defineApp({ env })` and
   `defineKeys`, set the env var on the deployment, push:
   ```ts
   const app = defineApp({
     env: {
       MY_APP_KEK_V1: v.string(),
       MY_APP_KEK_V2: v.string(),
     },
   });
   app.use(secretStore, {
     env: {
       SECRET_STORE_KEYS: defineKeys({
         1: process.env.MY_APP_KEK_V1!,
         2: process.env.MY_APP_KEK_V2!,
       }),
     },
   });
   ```
   ```sh
   npx convex env set MY_APP_KEK_V2 "$(openssl rand -base64 32)"
   npx convex deploy
   ```
2. **Trigger rotation.** Call `secrets.rotate(ctx)` once (from the dashboard, a
   one-shot internal mutation, or a temporary cron during the drain window).
3. **Verify drain.** Poll `secrets.isRotationComplete(ctx)` — when `true`, no
   secret is still on an old key.
4. **Retire the old key.** First remove it from `defineApp({ env })` and
   `defineKeys`, then push, then `npx convex env remove MY_APP_KEK_V1`. The
   order matters — Convex refuses to remove a deployment env var that's still
   declared as required in the app definition.

A new `rotated` audit event is recorded per row.

## Cleanup crons

Recommended permanent crons:

```ts
// convex/cleanup.ts
import { internalMutation } from "./_generated/server.js";
import { secrets } from "./secrets.js";

export const cleanupSecrets = internalMutation({
  handler: (ctx) => secrets.cleanupSecrets(ctx),
});
export const cleanupEvents = internalMutation({
  handler: (ctx) => secrets.cleanupEvents(ctx),
});
```

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();
crons.interval("cleanup expired secrets", { hours: 24 }, internal.cleanup.cleanupSecrets);
crons.interval("cleanup audit events", { hours: 24 }, internal.cleanup.cleanupEvents);
export default crons;
```

If you'd rather skip the `cleanup.ts` wrapper, you can point `crons.interval`
directly at the component's function and pass `retentionMs` as a static arg:

```ts
import { components } from "./_generated/api.js";

crons.interval(
  "cleanup expired secrets",
  { hours: 24 },
  components.secretStore.cleanup.cleanupSecrets,
  { retentionMs: 30 * 24 * 60 * 60 * 1000 },
);
```

The wrapper above gets you cleaner names in logs and a place to hook in
behavior later (metrics, alerts); the direct form trades that for one fewer
file. Pick whichever your codebase prefers — both are supported.

## Optional: rotation safety-net cron

By default the recommended rotation flow is one-shot — call
`secrets.rotate(ctx)` once after deploying a new key, then poll
`isRotationComplete()` before retiring the old one (see
[Key rotation](#key-rotation)). If you'd rather not remember the manual step,
add a slow rotation cron as a safety net. It's a no-op when nothing's stale
(one indexed `.first()` query — cheap) and picks up any backlog automatically:

```ts
// convex/crons.ts (in addition to the cleanup crons above)
import { components } from "./_generated/api.js";

crons.interval(
  "secret-store rotation",
  { hours: 24 },
  components.secretStore.lib.rotate,
  {},
);
```

**Cadence caveat.** Keep the interval at **≥ 24h**. At sub-hourly cadence a
cron tick may fire while a previous chain is still draining a large backlog,
spawning parallel chains that waste compute (no correctness issue, since the
slice is self-consuming, just noise). Daily or weekly is the right place.

## Errors

Every backend failure surfaces as a `ConvexError` whose `data` carries a typed
code:

```ts
import { isSecretStoreError, type SecretStoreErrorCode } from "convex-secret-store";

try {
  await secrets.put(ctx, { name: "", value: "..." });
} catch (error) {
  if (isSecretStoreError(error)) {
    switch (error.data.code) {
      case "invalid_argument": /* … */ break;
      case "value_too_large":  /* … */ break;
      case "invalid_keys":     /* deployment misconfigured */ break;
      case "key_unavailable":  /* row references a retired KEK */ break;
      case "decryption_failed":/* tampering or corruption */ break;
      case "not_found":        /* getOrThrow on a missing secret */ break;
      case "expired":          /* getOrThrow on an expired secret */ break;
    }
  }
}
```

## Security model

`convex-secret-store` provides encryption at rest *inside Convex* — protecting
against an attacker who gets the raw database without your deployment's
configuration. It is **not** a hardware-backed key store and does not protect
against any actor with deployment access:

- **KEKs live in the Convex deployment's env vars.** The component runs in your
  Convex deployment; "encryption inside the component" and "encryption outside
  the component" both run on Convex servers — there is no meaningful trust
  boundary between them. Anyone who can read your Convex deployment env can
  decrypt the data.
- **Supply-chain trust.** A malicious version of this package, if installed,
  could exfiltrate decrypted plaintext. Pin the dependency and review updates.
- **AAD binding.** AES-256-GCM ciphertext binds `namespace`, `name`, and the
  DEK's `keyVersion` as additional authenticated data, so ciphertext cannot be
  relocated between rows.
- **Plaintext metadata.** `metadata`, `namespace`, `name`, expiry, and audit
  events are not encrypted. Do not store sensitive data in metadata.

See `docs/adr/0001-component-side-encryption.md` for the architecture trade-off.

## Example app

The [`example/`](./example) directory contains a small Vite + Convex app:

- **Secrets** — store, replace, preview (masked), and remove environment
  secrets
- **Activity** — paginate the audit log
- **Settings** — version counts per scope, rotation controls, cleanup buttons,
  and demo data seeding

The example mounts the component with `defineKeys({ 1: process.env.MY_APP_KEK_V1!, 2: process.env.MY_APP_KEK_V2! })`,
demonstrating the validated-env pattern.

> **Note:** The example UI is intentionally simple and unauthenticated. In a
> real app, gate secret read/write flows behind your auth and authorization
> layer before exposing them to operators.

## Development

```sh
npm install
npm run dev          # backend + frontend together
npm run build        # build the published package
npm run typecheck
npm run lint
npm test
```

Architectural decisions are recorded in [`docs/adr/`](./docs/adr).
Domain terminology is in [`CONTEXT.md`](./CONTEXT.md).

<!-- END: Include on https://convex.dev/components -->
