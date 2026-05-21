# Component-side encryption with KEKs in validated env vars

/ Status: accepted — supersedes the 0.1.x host-side-crypto design

`convex-secret-store` performs envelope encryption **inside the Convex component
itself**. Key-encryption keys (KEKs) are supplied as a validated,
mount-time-required component environment variable; the host app calls
`components.secretStore.*` directly and never loads keys or runs crypto.

The 0.1.x design did the opposite: encryption ran in a host-side client class
and the component stored ciphertext only ("no backend KEKs"). That design
existed mainly because, before `convex@1.39`'s typed component env vars,
components could not receive configuration at all. It was never a real trust
boundary — the host runtime *is* Convex, so the KEKs were always on Convex
servers either way.

The one genuine property given up by moving crypto into the component: a
supply-chain compromise of the `convex-secret-store` package could now exfiltrate
decrypted plaintext, whereas before a hijacked package only ever saw ciphertext.
We accept this (mitigated by lockfile pinning and version review) in exchange for
a substantially simpler and safer-by-construction API: direct component calls,
compile-time-guaranteed key configuration, no host-side key management, and
`put` as a single encrypt-and-store transaction.

KEKs and all configuration live in environment variables, **never in a component
table** — master keys must not be persisted alongside the ciphertext they
protect. The component's tables hold data (`secrets`, `secretEvents`) only.
