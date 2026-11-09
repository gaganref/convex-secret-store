# Convex secret store

`CONTEXT.md` defines the domain vocabulary. Read it before naming anything.

## Compatibility

Apps already depend on the published package, and a host deploy fails when
stored rows no longer match the component schema.

A patch release keeps every app working with no action from the host:

- Public function names, arguments and return fields stay. Returns may gain
  fields.
- The schema only widens. Code reads old and new row shapes, so no correct
  answer depends on a migration having run.
- Internal functions that scheduled jobs call (such as `expiry.expire`) keep
  working until no queued job can reference them.

A breaking change ships in a minor release, in this order:

1. A bridge patch on the current minor that only widens. Add new fields as
   optional, keep old fields and names as deprecated, so rolling back to it
   works.
2. When old rows must be rewritten, an internal batch mutation the host runs
   with `npx convex run --component <name> ...`, named in the CHANGELOG.
3. The breaking minor, with a **Breaking** CHANGELOG entry and upgrade steps.

The Convex peer range is `^1.39.0`. Raise it only in a minor, with a CHANGELOG
note. CI runs the tests on the installed Convex and on 1.39.1.

## Decisions

Before you change one of these, read its record in `docs/adr/`: encryption and
key configuration (0001), key rotation (0002), expiry on writes (0003),
time-dependent queries (0004).

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`example/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
