# Convex Secret Store

A Convex component for encrypted secret storage with versioned key rotation,
expiry, and audit logging. Encryption runs inside the component; keys are
supplied via environment variables.

## Language

**Secret**:
A named, encrypted value stored by the component.
_Avoid_: credential, entry, record

**Namespace**:
An optional grouping key that scopes secrets; the host app defines its meaning.
_Avoid_: scope, tenant, group

**Name**:
A secret's identifier within its namespace. `(namespace, name)` is unique.

**KEK** (key-encryption key):
A long-lived, host-supplied AES key that wraps DEKs. Versioned. Lives in env
vars, never in a table.

**DEK** (data-encryption key):
A fresh random AES key generated per secret value, used to encrypt the
plaintext. Stored only in wrapped (KEK-encrypted) form.

**Key version**:
An explicit, stable integer identifying a KEK. Bound into ciphertext; never
reused or reordered.

**Active key version**:
The KEK version used to wrap DEKs for new writes — always the highest
configured version.

**Key rotation**:
Rewrapping a secret's DEK under a newer KEK version, without re-encrypting the
plaintext value.
_Avoid_: using "rotation" for replacing a secret's value (see Flagged ambiguities)

**Expiry**:
The absolute time after which a secret is no longer usable. Optional per secret.

**Audit event**:
An append-only record of a create, update, delete, or rotate operation.

## Relationships

- A **Secret** has one current **DEK**, wrapped by exactly one **Key version**.
- A **Secret** produces one or more **Audit events**.
- A **KEK** wraps many **DEKs**.

## Example dialogue

> **Dev:** "When I `put` a new value over an existing **Secret**, is that a key
> rotation?"
> **Domain expert:** "No. That's just an overwrite — it generates a new **DEK**
> and re-encrypts. **Key rotation** never touches the plaintext; it only rewraps
> the existing **DEK** under a newer **KEK version**."

## Flagged ambiguities

- "rotation" was used for two distinct things: **Key rotation** (rewrapping DEKs
  under a new KEK — the `rotateKeys` operation) and replacing a secret's
  plaintext value (an ordinary `put`). Resolved: in this codebase "rotation" /
  "rotate" refers **only** to KEK rotation. Replacing a value is an "overwrite".
