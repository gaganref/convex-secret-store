# Changelog

## 0.2.1

A security and maintenance release with no API changes. Upgrade if your app
passes secret-store errors to clients or logs, or exposes `list` or
`listEvents` with client-supplied pagination.

### Security

- A malformed `SECRET_STORE_KEYS` entry, such as one missing its `1:` prefix,
  no longer puts the key into the `invalid_keys` error message. A host query
  that rethrew that `ConvexError` sent it to clients. Key-format errors now
  name only the entry's position.
- `decryption_failed` messages no longer name the secret, and an invalid
  `SECRET_STORE_DEFAULT_TTL_MS` is no longer echoed in its error.
- `list` and `listEvents` never return rows outside the namespace and filters
  you pass, even for a hand-crafted cursor. The `convex-helpers` floor rises
  to `^0.1.134`, which fixes the cursor handling, and a row check throws
  `invalid_argument` if any foreign row appears.
- `put` and `update` reject metadata that is not a Convex value, such as a
  `Date`, with `invalid_argument` before the call. Previously Convex threw a
  plain error whose message included the arguments, plaintext value included,
  which ended up in server logs.

### Fixes

- `isSecretStoreError` also requires `error.data.message` to be a string, so
  the type it narrows to is true.

### Compatibility

- No change to function names, arguments, return shapes, error codes, or
  exported types. The `convex` peer range stays `^1.39.0`, and CI now tests
  both 1.39.1 and the latest release.
- `convex-helpers` 0.1.125 and later declare a `convex ^1.46.0` peer, so npm
  prints a peer warning on older Convex. Fresh installs of 0.2.0 already
  resolve the same `convex-helpers`, so nothing new breaks.
- The schema gains an optional `expiredAt` field, and the component gains an
  internal no-op `expiry.expire`. Neither is used in 0.2.1. They let an app
  roll back from 0.3.0 to 0.2.1, and rewriting a secret clears the field.
- `register` from `convex-secret-store/test` now also returns the typed
  component API. Existing calls compile unchanged.
- The published package no longer includes test files.
- Releases now publish from CI with npm provenance.

## 0.2.0

**Breaking — full revamp.** Rationale lives in [`docs/adr/`](./docs/adr).

### Architecture

- **Envelope encryption moves into the component.** Host apps no longer
  construct `SecretStore` with KEKs; the facade takes no options. KEKs are
  supplied through a validated component environment variable
  (`SECRET_STORE_KEYS`). See ADR 0001.
- Requires `convex >= 1.39` (for typed component env vars).

### Configuration

- **`SECRET_STORE_KEYS` wire format is now `version:value,version:value`** —
  delimited, not JSON. Use the `defineKeys({ 1: …, 2: … })` builder, or set the
  env var directly with `npx convex env set`.
- Each KEK value must be canonical 32-byte standard base64 (44 chars ending in
  `=`); strict validation with per-stage error messages.
- New optional `SECRET_STORE_DEFAULT_TTL_MS` env var. The per-client
  `defaults.ttlMs` constructor option is removed.

### API

- `new SecretStore<Namespace, Metadata>(components.secretStore)` — no options.
- New: `getOrThrow`, `isRotationComplete`.
- `rotate` (was `rotateKeys`): no args, self-rescheduling, drains in the
  background. No cursor, no progress table, no CAS — see ADR 0002.
- `rotate` returns `{ rotated, skipped, isDone }` and skips rows it cannot
  rewrap (retired KEK version, or material replaced under an existing version)
  rather than aborting the whole batch; the chain stops once only such rows
  remain.
- `get` / `list` take `now` as an arg (ADR 0004) — caller-supplied so expiry
  verdicts are never served stale from the query cache.
- `put` recomputes expiry on every write (ADR 0003): `ttlMs ?? default ?? none`.
- `ttlMs` and `SECRET_STORE_DEFAULT_TTL_MS` must be positive integers — `0` is
  rejected (it would write an instantly-expired secret).
- `update` requires at least one of `metadata` or `ttlMs`; calling with neither
  throws `invalid_argument`. `{ updated: false }` now unambiguously means the
  secret does not exist (symmetric with `remove`).
- `updated` audit events carry `metadata: { changed: ["metadata" | "ttl"] }`
  so the trail records *what* changed, not just *that* something did.
- Errors standardize on `ConvexError` with a typed `data.code` and an
  `isSecretStoreError` guard.

### Schema

- `secretEvents.createdAt` removed; events are ordered by the built-in
  `_creationTime`. Indexes simplified accordingly.

### Removed

- `SecretStoreClientError` class. Use `ConvexError` + `isSecretStoreError`.
- `OPERATION_FAILED` error wrapping.
- The `defaults` and `logLevel` constructor options.
- The "no backend KEKs" security claim — see ADR 0001 for the honest model.
- 0.1.x's host-side `SecretStore` crypto and the cursor-based `rotateKeys`.
- `has` query and facade method. Use `(await secrets.get(ctx, { name })).ok` —
  `get` is the primitive; a derived view invited inconsistency (e.g. lying
  when KEK material had been replaced under the same version).

### Migration

There is no migration path from 0.1.0. `0.1.0` is deprecated on npm — it was
non-installable (it shipped code referencing `convex-helpers` without declaring
it as a dependency).

## 0.1.0

- Initial release of `convex-secret-store`.
- Added the `SecretStore` client for encrypted secret storage with:
  - envelope encryption using per-secret DEKs and versioned KEKs
  - expiry-aware reads and cleanup
  - audit events for create, update, delete, and rotate operations
  - explicit DEK rewrap-based key rotation
- Added the `Integration Vault` example app demonstrating:
  - secret storage and replacement flows
  - safe server-side consumption patterns
  - audit activity browsing
  - rotation and cleanup operations
- Added typed client options for namespace and metadata constraints.
- Added backend, client, and example tests plus coverage reporting.
