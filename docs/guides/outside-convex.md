# Read and write secrets in other runtimes

This guide shows how to encrypt and decrypt secrets in code that does not run on
Convex, such as a Cloudflare Worker or a Node script. The values it writes use
the same format as the component, so each side can open the other's ciphertext.

## Import the envelope

`convex-secret-store/envelope` exports exactly these names:

- `encryptSecret`, `decryptSecret`, and `rewrapDEK`, which encrypt, decrypt, and
  move a value to another key version.
- `importKey`, which turns one key from `SECRET_STORE_KEYS` into a `CryptoKey`.
- `parseKeyEntries` and `defineKeys`, which read and build a `SECRET_STORE_KEYS`
  string.
- The `KeyEntry` type, `{ version: number; value: string }`.

The entry point does not import `convex`. It needs only the Web Crypto API,
which Node, Workers, and browsers provide. To install the package without the
`convex` peer dependency, run:

```sh
npm install convex-secret-store --omit=peer
```

In TypeScript, the `CryptoKey` type comes from the DOM library, from
`@types/node`, or from your Workers types. Add one of them to your project if
the compiler cannot find `CryptoKey`.

## Encrypt and decrypt a value

Use the same `SECRET_STORE_KEYS` value that your Convex deployment uses.

1. Parse the keys and import the highest version. The component encrypts new
   values with the highest version too.

   ```ts
   import {
     decryptSecret,
     encryptSecret,
     importKey,
     parseKeyEntries,
   } from "convex-secret-store/envelope";

   const keys = parseKeyEntries(process.env.SECRET_STORE_KEYS!);
   const active = keys.reduce((a, b) => (b.version > a.version ? b : a));
   const kek = await importKey(active.value);
   ```

2. Encrypt the value. Store the four returned fields together with `keyVersion`,
   and with the `namespace` and `name` you used.

   ```ts
   const encrypted = await encryptSecret({
     namespace: "acme",
     name: "openai",
     value: "sk-test",
     keyVersion: active.version,
     kek,
   });

   const row = {
     namespace: "acme",
     name: "openai",
     keyVersion: active.version,
     ...encrypted, // encryptedValue, iv, wrappedDEK, dekIv
   };
   ```

3. Decrypt with the key for the row's `keyVersion`.

   ```ts
   const entry = keys.find((key) => key.version === row.keyVersion);
   if (entry === undefined) {
     throw new Error(`key version ${row.keyVersion} is not configured`);
   }

   const value = await decryptSecret({
     ...row,
     kek: await importKey(entry.value),
   });
   ```

A row in the component's `secrets` table has the same `namespace`, `name`,
`keyVersion`, `encryptedValue`, `iv`, `wrappedDEK`, and `dekIv` fields, so
`decryptSecret` opens it the same way.

## Match the namespace, name, and version exactly

The ciphertext is bound to its `namespace`, `name`, and `keyVersion`.
`decryptSecret` throws unless all three match the values used to encrypt.

For a secret with no namespace, pass `namespace: undefined`. Never pass an empty
string. The component rejects `""` as a namespace, and a value encrypted with
`""` does not decrypt with `undefined`.

## Move a value to another key version

To move a stored value to a new key version without decrypting the value, call
`rewrapDEK`:

```ts
import { rewrapDEK } from "convex-secret-store/envelope";

const next = keys.find((key) => key.version === 2)!;

const rewrapped = await rewrapDEK({
  namespace: row.namespace,
  name: row.name,
  wrappedDEK: row.wrappedDEK,
  dekIv: row.dekIv,
  fromVersion: row.keyVersion,
  toVersion: next.version,
  fromKek: kek,
  toKek: await importKey(next.value),
});

const rotated = { ...row, ...rewrapped, keyVersion: next.version };
```

Store the returned `wrappedDEK` and `dekIv`, and set `keyVersion` to
`toVersion`. `encryptedValue` and `iv` do not change.
