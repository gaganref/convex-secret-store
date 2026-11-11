# Convex Secret Store

[![npm version](https://badge.fury.io/js/convex-secret-store.svg)](https://badge.fury.io/js/convex-secret-store)
[![Convex Component](https://www.convex.dev/components/badge/convex-secret-store)](https://www.convex.dev/components/convex-secret-store)

<!-- START: Include on https://convex.dev/components -->

Store API keys, tokens and other secrets in your Convex app, encrypted at rest,
with key rotation, expiry and an audit log.

The component encrypts each value with keys you keep in your deployment's
environment variables, so a copy of the database alone cannot reveal it. Only
your own Convex functions can call the component, so your code decides who reads
which secret.

## When to use it

| You need                                                               | Use                                                                                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Secrets your users or tenants add at runtime, such as a customer's key | This component                                                                                             |
| To rotate the encryption key without rewriting every value             | This component                                                                                             |
| A record of when each secret was created, changed or deleted           | This component                                                                                             |
| A few fixed keys that only you set, such as your own OpenAI key        | Plain [Convex environment variables](https://docs.convex.dev/production/environment-variables)             |
| Protection from someone with access to your Convex deployment          | A dedicated secrets manager. This component cannot give you that, because its keys live in the deployment. |

## Quick start

You need a Convex project on `convex` 1.39 or later.

1. Install the package.

   ```sh
   npm install convex-secret-store
   ```

2. Mount the component in `convex/convex.config.ts` and pass it your keys.

   ```ts
   import { defineApp } from "convex/server";
   import { v } from "convex/values";
   import secretStore from "convex-secret-store/convex.config";

   const app = defineApp({
     env: { SECRET_STORE_KEYS: v.string() },
   });

   app.use(secretStore, {
     env: { SECRET_STORE_KEYS: app.env.SECRET_STORE_KEYS },
   });

   export default app;
   ```

3. Create a key and set it on your deployment. Each entry is `version:value`,
   and the value is 32 random bytes in base64.

   ```sh
   npx convex env set SECRET_STORE_KEYS "1:$(openssl rand -base64 32)"
   npx convex dev
   ```

   You should see `Convex functions ready!`. If the variable is missing, the
   push stops and names the variable to set.

4. Create the client once, in `convex/secrets.ts`.

   ```ts
   import { SecretStore } from "convex-secret-store";
   import { components } from "./_generated/api.js";

   export const secrets = new SecretStore(components.secretStore);
   ```

5. Save a secret and read it back, in `convex/demo.ts`.

   ```ts
   import { v } from "convex/values";
   import { internalMutation, internalQuery } from "./_generated/server.js";
   import { secrets } from "./secrets.js";

   export const save = internalMutation({
     args: { value: v.string() },
     handler: async (ctx, { value }) => {
       await secrets.put(ctx, { namespace: "acme", name: "openai", value });
     },
   });

   export const check = internalQuery({
     args: {},
     handler: async (ctx) => {
       const result = await secrets.get(ctx, {
         namespace: "acme",
         name: "openai",
       });
       return result.ok ? "found" : result.reason;
     },
   });
   ```

   ```sh
   npx convex run demo:save '{"value":"sk-test"}'
   npx convex run demo:check
   ```

   The second command prints `"found"`. Before a public function passes a
   namespace to `secrets`, check that the caller may use it. The
   [security model](https://github.com/gaganref/convex-secret-store/blob/main/docs/security.md)
   explains why.

## Common questions

**I set `SECRET_STORE_KEYS` with `npx convex env set`, and the push still
fails.**

The component reads the variable only through your app config. Declare it in
`defineApp({ env })` and pass `app.env.SECRET_STORE_KEYS`, as in step 2.

**An older guide passes keys to
`new SecretStore(components.secretStore, { keys })`.**

That was the 0.1 API. Since 0.2, keys live in `SECRET_STORE_KEYS`, and the
client takes only the component.

**How do I move to a new key?**

Add a new version and keep the old one, for example
`npx convex env set SECRET_STORE_KEYS "1:<old>,2:<new>"`. New writes use the
highest version right away. Call `secrets.rotate(ctx)` once, wait until
`secrets.isRotationComplete(ctx)` returns `true`, then set the variable to the
new key only. The
[keys guide](https://github.com/gaganref/convex-secret-store/blob/main/docs/guides/keys.md)
has the full steps.

**What happens if I remove a key that secrets still use?**

Those secrets read as `key_unavailable`, and rotation leaves them alone.
`secrets.orphanKeyVersions(ctx)` lists the missing versions. Add the key back,
and the secrets read again.

**Can I read these secrets outside Convex?**

Yes. `convex-secret-store/envelope` has the same encryption with no Convex
dependency, so a Worker or a script can read and write compatible values. See
[using it outside Convex](https://github.com/gaganref/convex-secret-store/blob/main/docs/guides/outside-convex.md).

**Are names and metadata encrypted?**

No. Only the value is encrypted. Names, namespaces, metadata, expiry times and
audit events are stored as plain text, so keep sensitive data out of them.

## How you know it's working

- `secrets.get` returns `{ ok: true, value }` for a secret you saved.
- In the Convex dashboard, the component's `secrets` table shows ciphertext,
  never your value.
- After a rotation, `secrets.isRotationComplete(ctx)` returns `true`.
- A secret with a `ttlMs` shows as expired on an open page, without a reload.

## Learn more

- Guides:
  [keys and rotation](https://github.com/gaganref/convex-secret-store/blob/main/docs/guides/keys.md),
  [expiry](https://github.com/gaganref/convex-secret-store/blob/main/docs/guides/expiry.md),
  [cleanup](https://github.com/gaganref/convex-secret-store/blob/main/docs/guides/cleanup.md),
  [using it outside Convex](https://github.com/gaganref/convex-secret-store/blob/main/docs/guides/outside-convex.md)
  and
  [upgrading from 0.2](https://github.com/gaganref/convex-secret-store/blob/main/docs/guides/upgrading.md).
- [Reference](https://github.com/gaganref/convex-secret-store/blob/main/docs/reference.md)
  lists every function with its arguments, results and errors.
- [Security model](https://github.com/gaganref/convex-secret-store/blob/main/docs/security.md)
  covers what the encryption protects against and what it does not.
- The
  [example app](https://github.com/gaganref/convex-secret-store/tree/main/example)
  shows paging, rotation and cleanup in a small Vite app.

Found a bug, or want a feature?
[Open an issue](https://github.com/gaganref/convex-secret-store/issues).

<!-- END: Include on https://convex.dev/components -->

## Development

```sh
npm install
npm run dev
npm test
npm run typecheck
npm run lint
```

Design decisions are in [`docs/adr/`](./docs/adr), and domain terms are in
[`CONTEXT.md`](./CONTEXT.md).
