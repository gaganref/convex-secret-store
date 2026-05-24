# `put` recomputes expiry on every write

/ Status: accepted

`put` sets `expiresAt` to `now + ttlMs` when `ttlMs` is given, to
`now + SECRET_STORE_DEFAULT_TTL_MS` when `ttlMs` is omitted and that env var is
set, and to no expiry otherwise. It recomputes this on **every** write,
including overwrites — it never preserves an existing `expiresAt`. (`ttlMs: null`
explicitly means no expiry.)

The considered alternative was to preserve `expiresAt` on overwrite when `ttlMs`
is omitted, making the env default a create-time-only default. It was rejected:
that makes `SECRET_STORE_DEFAULT_TTL_MS` a half-useless create-only curiosity,
and a secret whose value is rotated mid-life would silently keep aging toward
its original expiry. Recompute-every-write gives one rule with no
new-vs-overwrite branching and no time-dependent logic: expiry is always
`ttlMs ?? default ?? none`.

Consequence: with no env default configured, overwriting a secret's value
without passing `ttlMs` clears an `expiresAt` that was set explicitly earlier.
Use `update` to change expiry without rewriting the value.

(This replaces the 0.1.x behavior, where the client always resolved `ttlMs` to a
concrete value so the component's preserve-on-overwrite branch was unreachable —
audit finding F2.)
