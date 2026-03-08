import {
  invalidArgumentError,
  runtimeUnavailableError,
} from "./errors.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function getRuntimeCrypto(): Crypto {
  if (
    typeof globalThis.crypto === "undefined" ||
    typeof globalThis.crypto.subtle === "undefined"
  ) {
    throw runtimeUnavailableError("Web Crypto API is unavailable");
  }
  return globalThis.crypto;
}

function decodeBase64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4 || 4)) % 4),
    "=",
  );

  try {
    if (typeof atob === "function") {
      const decoded = atob(padded);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    }
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(padded, "base64"));
    }
  } catch (error) {
    throw invalidArgumentError(`invalid base64 data: ${String(error)}`);
  }

  throw runtimeUnavailableError("base64 decoding is unavailable");
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  throw runtimeUnavailableError("base64 encoding is unavailable");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return encodeBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  return decodeBase64(input);
}

function utf8Bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function buildAadParts(namespace: string | undefined, name: string) {
  return namespace === undefined ? ["", name] : [namespace, name];
}

export function buildValueAAD(
  namespace: string | undefined,
  name: string,
): Uint8Array {
  return utf8Bytes(JSON.stringify(["value", ...buildAadParts(namespace, name)]));
}

export function buildDekAAD(
  namespace: string | undefined,
  name: string,
  keyVersion: number,
): Uint8Array {
  return utf8Bytes(
    JSON.stringify(["dek", ...buildAadParts(namespace, name), keyVersion]),
  );
}

export async function importKey(rawKeyBase64: string): Promise<CryptoKey> {
  const bytes = decodeBase64(rawKeyBase64);
  if (bytes.byteLength !== 32) {
    throw invalidArgumentError("KEK must decode to exactly 32 bytes");
  }
  return await getRuntimeCrypto().subtle.importKey(
    "raw",
    asBufferSource(bytes),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export function generateDEK(): Uint8Array {
  const bytes = new Uint8Array(32);
  getRuntimeCrypto().getRandomValues(bytes);
  return bytes;
}

export function generateIV(): Uint8Array {
  const bytes = new Uint8Array(12);
  getRuntimeCrypto().getRandomValues(bytes);
  return bytes;
}

async function importDekKey(dek: Uint8Array): Promise<CryptoKey> {
  return await getRuntimeCrypto().subtle.importKey(
    "raw",
    asBufferSource(dek),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptRaw(params: {
  key: CryptoKey;
  iv: Uint8Array;
  plaintext: Uint8Array;
  aad: Uint8Array;
}): Promise<Uint8Array> {
  const ciphertext = await getRuntimeCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(params.iv),
      additionalData: asBufferSource(params.aad),
    },
    params.key,
    asBufferSource(params.plaintext),
  );
  return new Uint8Array(ciphertext);
}

async function decryptRaw(params: {
  key: CryptoKey;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  aad: Uint8Array;
}): Promise<Uint8Array> {
  const plaintext = await getRuntimeCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(params.iv),
      additionalData: asBufferSource(params.aad),
    },
    params.key,
    asBufferSource(params.ciphertext),
  );
  return new Uint8Array(plaintext);
}

export async function encryptSecret(params: {
  value: string;
  namespace: string | undefined;
  name: string;
  keyVersion: number;
  kek: CryptoKey;
}): Promise<{
  encryptedValue: string;
  iv: string;
  wrappedDEK: string;
  dekIv: string;
}> {
  const dek = generateDEK();
  const valueIv = generateIV();
  const dekIv = generateIV();
  const dekKey = await importDekKey(dek);

  const encryptedValue = await encryptRaw({
    key: dekKey,
    iv: valueIv,
    plaintext: utf8Bytes(params.value),
    aad: buildValueAAD(params.namespace, params.name),
  });

  const wrappedDEK = await encryptRaw({
    key: params.kek,
    iv: dekIv,
    plaintext: dek,
    aad: buildDekAAD(params.namespace, params.name, params.keyVersion),
  });

  return {
    encryptedValue: base64UrlEncode(encryptedValue),
    iv: base64UrlEncode(valueIv),
    wrappedDEK: base64UrlEncode(wrappedDEK),
    dekIv: base64UrlEncode(dekIv),
  };
}

export async function decryptSecret(params: {
  encryptedValue: string;
  iv: string;
  wrappedDEK: string;
  dekIv: string;
  namespace: string | undefined;
  name: string;
  keyVersion: number;
  kek: CryptoKey;
}): Promise<string> {
  const dek = await decryptRaw({
    key: params.kek,
    iv: base64UrlDecode(params.dekIv),
    ciphertext: base64UrlDecode(params.wrappedDEK),
    aad: buildDekAAD(params.namespace, params.name, params.keyVersion),
  });

  const dekKey = await importDekKey(dek);
  const plaintext = await decryptRaw({
    key: dekKey,
    iv: base64UrlDecode(params.iv),
    ciphertext: base64UrlDecode(params.encryptedValue),
    aad: buildValueAAD(params.namespace, params.name),
  });

  return textDecoder.decode(plaintext);
}

export async function rewrapDEK(params: {
  wrappedDEK: string;
  dekIv: string;
  namespace: string | undefined;
  name: string;
  fromVersion: number;
  toVersion: number;
  fromKek: CryptoKey;
  toKek: CryptoKey;
}): Promise<{ wrappedDEK: string; dekIv: string }> {
  const dek = await decryptRaw({
    key: params.fromKek,
    iv: base64UrlDecode(params.dekIv),
    ciphertext: base64UrlDecode(params.wrappedDEK),
    aad: buildDekAAD(params.namespace, params.name, params.fromVersion),
  });

  const nextIv = generateIV();
  const wrappedDEK = await encryptRaw({
    key: params.toKek,
    iv: nextIv,
    plaintext: dek,
    aad: buildDekAAD(params.namespace, params.name, params.toVersion),
  });

  return {
    wrappedDEK: base64UrlEncode(wrappedDEK),
    dekIv: base64UrlEncode(nextIv),
  };
}
