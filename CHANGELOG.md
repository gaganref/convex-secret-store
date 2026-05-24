# Changelog

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
