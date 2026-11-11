# Manage encryption keys

This guide shows how to configure the keys the component encrypts with, add a
new key, move existing secrets onto it, and retire the old one. It also covers
what to do when a key goes missing.

## Write the key list

The component reads its keys from one environment variable, `SECRET_STORE_KEYS`.
The value is a comma-separated list of `version:value` entries:

```
1:<base64>,2:<base64>
```

- The version is a non-negative integer, and each version appears once.
- The value is 32 random bytes in standard base64. That is 44 characters ending
  in one `=`, which is what `openssl rand -base64 32` prints.
- Entries can appear in any order. The component trims spaces around each entry.

The highest version is the active version. New writes and rotation use it. Lower
versions stay available to decrypt the secrets that still use them.

If the value is missing or malformed, every call that needs a key throws
`invalid_keys`. The error message names the position of the bad entry, never its
value.

To create a key, run:

```sh
openssl rand -base64 32
```

## Pass the keys to the component

The component reads `SECRET_STORE_KEYS` only through your app config. Setting
the variable on the deployment without passing it in `convex/convex.config.ts`
fails the push. Choose one of the two forms below.

### Bind the variable by reference

To make key changes take effect as soon as you run `npx convex env set`, with no
push, declare the variable on your app and pass `app.env.SECRET_STORE_KEYS`:

```ts
// convex/convex.config.ts
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

```sh
npx convex env set SECRET_STORE_KEYS "1:$(openssl rand -base64 32)"
```

The rest of this guide uses this form, and so does the
[example app](../../example/convex/convex.config.ts).

### Build the value with `defineKeys`

To keep one environment variable per key and have the key map type-checked,
build the value with `defineKeys`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import { defineKeys } from "convex-secret-store";
import secretStore from "convex-secret-store/convex.config";

const app = defineApp({
  env: { MY_APP_KEK_V1: v.string() },
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

```sh
npx convex env set MY_APP_KEK_V1 "$(openssl rand -base64 32)"
```

`defineKeys` validates each key when Convex evaluates the config, so a bad key
fails the push. A duplicate version fails type checking, because an object
literal cannot repeat a key (`error TS1117`).

`defineKeys` reads the values at push time. After you change one of the
variables, push again before the component sees the change.

## Add a key

1. Read the current list.

   ```sh
   npx convex env get SECRET_STORE_KEYS
   ```

2. Set the list again with a new, higher version at the end.

   ```sh
   npx convex env set SECRET_STORE_KEYS "1:<current key>,2:$(openssl rand -base64 32)"
   ```

New writes use version 2 right away. Secrets on version 1 still read, because
version 1 is still in the list.

If you use `defineKeys`, add `MY_APP_KEK_V2` to `defineApp({ env })` and
`2: process.env.MY_APP_KEK_V2!` to `defineKeys`. Set the variable with
`npx convex env set MY_APP_KEK_V2 "$(openssl rand -base64 32)"`, then push with
`npx convex deploy`.

## Move existing secrets to the new key

Rotation rewraps each secret's data key under the active version. It never
decrypts or rewrites the secret's value.

1. Call `rotate` once, for example from an internal mutation.

   ```ts
   // convex/rotate.ts
   import { internalMutation } from "./_generated/server.js";
   import { secrets } from "./secrets.js";

   export const rotateSecrets = internalMutation({
     args: {},
     handler: async (ctx) => await secrets.rotate(ctx),
   });
   ```

   ```sh
   npx convex run rotate:rotateSecrets
   ```

   You can also run the mutation from the Convex dashboard. The call handles one
   batch and, if more secrets remain, schedules the next. Batches continue in
   the background until no configured old version is left. Each rotated secret
   gets a `rotated` audit event.

2. Wait until `isRotationComplete` returns `true`.

   ```ts
   // convex/rotate.ts
   import { internalQuery } from "./_generated/server.js";
   import { secrets } from "./secrets.js";

   export const rotationComplete = internalQuery({
     args: {},
     handler: async (ctx) => await secrets.isRotationComplete(ctx),
   });
   ```

   ```sh
   npx convex run rotate:rotationComplete
   ```

Do not call `rotate` in a loop until its `isDone` is `true`. `isDone` describes
only the batch that call ran, and every call starts a new scan from the lowest
version. Calling `rotate` again is safe, but it is not a progress check.

## Retire an old key

Remove a key only after `isRotationComplete` returns `true`. Then no secret uses
an old version.

```sh
npx convex env set SECRET_STORE_KEYS "2:<new key>"
```

If you use `defineKeys`, do the steps in this order:

1. Remove the version from `defineKeys` and from `defineApp({ env })`.
2. Push with `npx convex deploy`.
3. Run `npx convex env remove MY_APP_KEK_V1`.

Convex refuses to remove a variable that the app still declares as required, so
the push comes first.

## Recover a removed key

If you remove a version that secrets still use, those secrets become unreadable
until the key returns:

- `get` returns `{ ok: false, reason: "key_unavailable" }`, and `getOrThrow`
  throws `key_unavailable`.
- Rotation leaves those secrets untouched and keeps going with the other
  versions. Each batch logs one warning per missing version, such as
  `secret-store: keyVersion 1 is not configured.`
- `isRotationComplete` stays `false`.

To list the missing versions, call `orphanKeyVersions`:

```ts
// convex/rotate.ts
import { internalQuery } from "./_generated/server.js";
import { secrets } from "./secrets.js";

export const missingKeyVersions = internalQuery({
  args: {},
  handler: async (ctx) => await secrets.orphanKeyVersions(ctx),
});
```

It returns the versions in ascending order, such as `[1]`. A version above the
active version is also missing, because the active version is the highest one
configured.

To recover, add the key back under its original version. The secrets read again
at once. If a rotation chain finished while the key was missing, call `rotate`
again to move those secrets. If you no longer have the key, delete the affected
secrets with `remove`.

## Keep each version's key unchanged

A version number names one key for good. To rotate, add a new version. Never put
new key material under a version that secrets already use.

If the material under a version changes, secrets on that version cannot be
decrypted:

- `get` and `getOrThrow` throw `decryption_failed`.
- If the version is older than the active one, `rotate` counts each of those
  secrets in `skipped` and logs a warning with the secret's name and key
  version. Warnings never contain key material or values.
- If the version is the active one, `rotate` leaves those secrets alone and
  reports nothing. Only reads show the failure.

To recover, restore the original material under that version, or delete the
affected secrets with `remove`.

## Add a rotation cron as a safety net

If you would rather not depend on someone calling `rotate` after a key change,
schedule the `rotateSecrets` mutation from
[Move existing secrets to the new key](#move-existing-secrets-to-the-new-key). A
cron can call only functions in your app, so it cannot point at
`components.secretStore.lib.rotate` directly.

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "secret-store rotation",
  { hours: 24 },
  internal.rotate.rotateSecrets,
);

export default crons;
```

When no secret needs rotation, a run reads one secret per distinct key version
in use, plus one more lookup that finds nothing, and writes nothing.

Keep the interval at 24 hours or more. With a short interval, a new run can
start while an earlier chain still works through a large backlog. The chains
then repeat the same scans. Transactions prevent a secret from being rewrapped
twice, but the repeated scans still cost reads.
