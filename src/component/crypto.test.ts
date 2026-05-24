import { describe, expect, test } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  importKey,
  rewrapDEK,
} from "./crypto.js";

const RAW_V1 = Buffer.alloc(32, 1).toString("base64");
const RAW_V2 = Buffer.alloc(32, 2).toString("base64");

describe("envelope encryption", () => {
  test("encrypt then decrypt round-trips the value", async () => {
    const kek = await importKey(RAW_V1);
    const payload = await encryptSecret({
      value: "sk-secret-value",
      namespace: "acme:production",
      name: "openai",
      keyVersion: 1,
      kek,
    });
    const value = await decryptSecret({
      ...payload,
      namespace: "acme:production",
      name: "openai",
      keyVersion: 1,
      kek,
    });
    expect(value).toBe("sk-secret-value");
  });

  test("round-trips a value with no namespace", async () => {
    const kek = await importKey(RAW_V1);
    const payload = await encryptSecret({
      value: "v",
      namespace: undefined,
      name: "stripe",
      keyVersion: 1,
      kek,
    });
    const value = await decryptSecret({
      ...payload,
      namespace: undefined,
      name: "stripe",
      keyVersion: 1,
      kek,
    });
    expect(value).toBe("v");
  });

  test("decryption fails when the AAD namespace does not match", async () => {
    const kek = await importKey(RAW_V1);
    const payload = await encryptSecret({
      value: "v",
      namespace: "acme:production",
      name: "openai",
      keyVersion: 1,
      kek,
    });
    await expect(
      decryptSecret({
        ...payload,
        namespace: "acme:staging",
        name: "openai",
        keyVersion: 1,
        kek,
      }),
    ).rejects.toThrow();
  });

  test("decryption fails when the AAD name does not match", async () => {
    const kek = await importKey(RAW_V1);
    const payload = await encryptSecret({
      value: "v",
      namespace: undefined,
      name: "openai",
      keyVersion: 1,
      kek,
    });
    await expect(
      decryptSecret({
        ...payload,
        namespace: undefined,
        name: "stripe",
        keyVersion: 1,
        kek,
      }),
    ).rejects.toThrow();
  });

  test("decryption fails with a different KEK", async () => {
    const kek1 = await importKey(RAW_V1);
    const kek2 = await importKey(RAW_V2);
    const payload = await encryptSecret({
      value: "v",
      namespace: undefined,
      name: "openai",
      keyVersion: 1,
      kek: kek1,
    });
    await expect(
      decryptSecret({
        ...payload,
        namespace: undefined,
        name: "openai",
        keyVersion: 1,
        kek: kek2,
      }),
    ).rejects.toThrow();
  });

  test("rewrapDEK moves a secret onto a new key version", async () => {
    const kek1 = await importKey(RAW_V1);
    const kek2 = await importKey(RAW_V2);
    const payload = await encryptSecret({
      value: "rotate-me",
      namespace: "ns:production",
      name: "github",
      keyVersion: 1,
      kek: kek1,
    });
    const rewrapped = await rewrapDEK({
      wrappedDEK: payload.wrappedDEK,
      dekIv: payload.dekIv,
      namespace: "ns:production",
      name: "github",
      fromVersion: 1,
      toVersion: 2,
      fromKek: kek1,
      toKek: kek2,
    });
    const value = await decryptSecret({
      encryptedValue: payload.encryptedValue,
      iv: payload.iv,
      wrappedDEK: rewrapped.wrappedDEK,
      dekIv: rewrapped.dekIv,
      namespace: "ns:production",
      name: "github",
      keyVersion: 2,
      kek: kek2,
    });
    expect(value).toBe("rotate-me");
  });

  test("importKey rejects material that is not 32 bytes", async () => {
    await expect(
      importKey(Buffer.alloc(16, 1).toString("base64")),
    ).rejects.toThrow();
  });
});
