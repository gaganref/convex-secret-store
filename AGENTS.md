# Convex secret store

This package is a Convex component for encrypted secrets, key rotation, expiry,
and audit events. The example app mounts the component. Read `CONTEXT.md` for
the domain vocabulary.

## Commands

Use Node 26.

```sh
npm ci
npm run build
npm test
npm run typecheck
npm run lint
```

`npm run build:codegen` regenerates component types and builds the package.
`npm run build:clean` removes build output and runs codegen before building.

## Compatibility

Preserve behavior for existing package consumers. Keep the Convex peer range at
`^1.39.0` and `convex-helpers` as a runtime dependency. Tooling changes must
pass the existing tests on both the development Convex version and 1.39.1. Keep
public function names, arguments, and existing return fields compatible.

## Design decisions

Before changing these behaviors, read their decision records.

- Encryption and key configuration use
  [ADR 0001](docs/adr/0001-component-side-encryption.md).
- Key rotation uses [ADR 0002](docs/adr/0002-rotation-self-consuming-slice.md).
- Expiry on writes uses [ADR 0003](docs/adr/0003-put-recomputes-expiry.md).
- Time-dependent queries use [ADR 0004](docs/adr/0004-now-as-query-argument.md).

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`example/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
