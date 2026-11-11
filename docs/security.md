# Security model

The component encrypts secret values at rest inside Convex. That protects
against one specific attacker: someone who gets a copy of the database but not
your deployment's configuration. It is not a hardware-backed key store, and it
does not protect against anyone who has access to your Convex deployment. This
page explains where that line sits and why.

## The keys live in the deployment

The key-encryption keys (KEKs) are environment variables on your Convex
deployment. Anyone who can read those variables can decrypt every secret. That
includes anyone who can change your deployment's code, because new code can read
the variables or call the component.

The keys never go into a table. Keeping them out of the database is what makes a
stolen copy of the database useless on its own.

## Why the component does the encryption

Before Convex 1.39, a component could not receive configuration, so version 0.1
encrypted in a host-side class and passed only ciphertext to the component. That
looked like a boundary, but it was not one. Your Convex functions and the
component run on the same Convex servers, and the keys were on those servers
either way.

Since 0.2, the component reads its keys from its own environment variables and
does the encryption itself. Your code calls one function to encrypt and store,
in one transaction, and never handles keys. The trade is supply-chain exposure.
A malicious release of this package could now send decrypted values somewhere,
where the old design would have shown it only ciphertext. Pin the dependency
with your lockfile and review each update before you install it. The trade is
worth it. The old boundary protected nothing real, and the simpler API removes
ways to get key handling wrong.
[ADR 0001](adr/0001-component-side-encryption.md) records the decision.

## Each ciphertext is bound to its row

Every value gets its own random data key (DEK). AES-256-GCM encrypts the value
with the DEK, and the active KEK wraps the DEK. Both encryptions include
additional authenticated data. The value's ciphertext is bound to its
`namespace` and `name`. The wrapped DEK is bound to `namespace`, `name`, and
`keyVersion`. Copying a ciphertext into another row, or changing the key version
a row claims, makes decryption fail.

## Some fields stay in plain text

Only the value is encrypted. The `namespace`, `name`, `metadata`, expiry times,
and audit events are stored as plain text. Anyone who can read the database can
read them, so keep sensitive data out of them.

## Your functions decide who may read

The component trusts the app that mounts it. Only your own Convex functions can
call it, and it does not know who your users are. Before a public function
passes a namespace to `get`, `list`, `listEvents`, or a write, check that the
caller may use that namespace.

The component enforces the scope you pass. `list` and `listEvents` never return
rows outside the namespace and filters in the call, whatever cursor the client
sends. If a cursor would return a row outside them, the call throws
`invalid_argument` instead.

## Errors and logs leave out keys and values

No error message contains key material or a secret value. An `invalid_keys`
error names the position of a bad entry, not the entry. A `getOrThrow` error
does name the secret you asked for, so treat secret names in errors like any
other data you choose to show a client. Rotation warnings in the logs name a
secret or a key version, never a key or a value.

## Audit events are a record, not proof

Audit events live in the same database as the secrets. Nothing stops someone
with deployment access from changing or deleting them. Treat them as a forensic
trail for people you already trust, not as tamper-evident evidence. They also do
not record everything that happens. When a secret expires, the component marks
it expired without an event.

## The example app has no sign-in

The [example app](../example) has three pages. **Secrets** stores, replaces,
previews masked, and removes secrets. **Activity** pages through the audit log.
**Settings** shows key-version counts per scope, runs rotation and cleanup, and
seeds demo data. None of them checks who you are. In a real app, put your own
authentication and authorization in front of every function that reads or writes
secrets.
