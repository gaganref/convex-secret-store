import type { ComponentApi } from "../component/_generated/component.js";
import {
  decryptSecret,
  encryptSecret,
  importKey,
  rewrapDEK,
} from "./crypto.js";
import {
  invalidArgumentError,
  keyVersionUnavailableError,
  operationFailedError,
  valueTooLargeError,
} from "./errors.js";
import {
  assertNullableNonNegativeInteger,
  normalizeSecretStoreOptions,
  type NormalizedSecretStoreOptions,
  type SecretStoreOptions,
} from "./options.js";
import type {
  CleanupArgs,
  CleanupResult,
  GetArgs,
  GetResult,
  HasArgs,
  ListArgs,
  ListEventsArgs,
  ListEventsResult,
  ListResult,
  PutArgs,
  PutResult,
  RemoveArgs,
  RemoveResult,
  RotateKeysArgs,
  RotateKeysResult,
  RunMutationCtx,
  RunQueryCtx,
  UpdateArgs,
  UpdateResult,
  SecretStoreTypeOptions,
} from "./types.js";

const MAX_VALUE_BYTES = 64 * 1024;
const DEFAULT_ROTATION_BATCH_SIZE = 100;
const DEFAULT_CLEANUP_BATCH_SIZE = 100;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

function readNamespace(args: object): string | undefined {
  if (!("namespace" in args)) {
    return undefined;
  }
  const namespace = (args as { namespace?: unknown }).namespace;
  if (namespace === undefined) {
    return undefined;
  }
  if (typeof namespace !== "string") {
    return undefined;
  }
  if (namespace.length === 0) {
    throw invalidArgumentError("namespace must not be empty");
  }
  return namespace;
}

function shouldLog(
  configured: "debug" | "warn" | "error" | "none",
  level: "debug" | "warn" | "error",
): boolean {
  if (configured === "none") return false;
  if (configured === "debug") return true;
  if (configured === "warn") return level !== "debug";
  return level === "error";
}

function logWithLevel(
  configured: "debug" | "warn" | "error" | "none",
  level: "debug" | "warn" | "error",
  tag: string,
  data: Record<string, unknown>,
) {
  if (!shouldLog(configured, level)) {
    return;
  }
  const method =
    level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](`[secret-store:${tag}]`, data);
}

function resolvePutExpiresAt(
  now: number,
  ttlMs: number | null | undefined,
  defaultTtlMs: number | null,
) {
  const resolved = ttlMs === undefined ? defaultTtlMs : ttlMs;
  if (resolved === null) {
    return null;
  }
  assertNullableNonNegativeInteger(resolved, "ttlMs");
  return now + resolved;
}

function toThrownError(error: unknown, message: string) {
  return operationFailedError(message, error);
}

export class SecretStore<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> {
  public readonly component: ComponentApi;
  public readonly options: NormalizedSecretStoreOptions;
  private readonly kekCache = new Map<number, Promise<CryptoKey>>();

  constructor(component: ComponentApi, options: SecretStoreOptions<TOptions>) {
    this.component = component;
    this.options = normalizeSecretStoreOptions(
      options as SecretStoreOptions<SecretStoreTypeOptions>,
    );
  }

  private getKEK(version: number): Promise<CryptoKey> {
    const raw = this.options.keyVersions.get(version);
    if (raw === undefined) {
      throw keyVersionUnavailableError(version);
    }
    const cached = this.kekCache.get(version);
    if (cached) {
      return cached;
    }
    const imported = importKey(raw);
    this.kekCache.set(version, imported);
    return imported;
  }

  async put(ctx: RunMutationCtx, args: PutArgs<TOptions>): Promise<PutResult> {
    const now = Date.now();
    const namespace = readNamespace(args);
    const valueBytes = textEncoder.encode(args.value);
    if (valueBytes.byteLength > MAX_VALUE_BYTES) {
      throw valueTooLargeError(MAX_VALUE_BYTES, valueBytes.byteLength);
    }

    try {
      const expiresAt = resolvePutExpiresAt(
        now,
        args.ttlMs,
        this.options.defaults.ttlMs,
      );
      const payload = await encryptSecret({
        value: args.value,
        namespace,
        name: args.name,
        keyVersion: this.options.activeVersion,
        kek: await this.getKEK(this.options.activeVersion),
      });

      const result = await ctx.runMutation(this.component.lib.put, {
        namespace,
        name: args.name,
        metadata: args.metadata,
        expiresAt,
        keyVersion: this.options.activeVersion,
        ...payload,
      });
      logWithLevel(this.options.logLevel, "debug", "put", {
        namespace,
        name: args.name,
        secretId: result.secretId,
        isNew: result.isNew,
      });
      return result;
    } catch (error) {
      throw toThrownError(error, `put ${args.name}`);
    }
  }

  async get(ctx: RunQueryCtx, args: GetArgs<TOptions>): Promise<GetResult<TOptions>> {
    const namespace = readNamespace(args);

    try {
      const result = await ctx.runQuery(this.component.lib.get, {
        namespace,
        name: args.name,
        now: Date.now(),
      });
      if (!result.ok) {
        return result;
      }

      const key = this.options.keyVersions.get(result.keyVersion);
      if (key === undefined) {
        return { ok: false, reason: "key_version_unavailable" };
      }

      const value = await decryptSecret({
        namespace,
        name: args.name,
        encryptedValue: result.encryptedValue,
        iv: result.iv,
        wrappedDEK: result.wrappedDEK,
        dekIv: result.dekIv,
        keyVersion: result.keyVersion,
        kek: await this.getKEK(result.keyVersion),
      });

      return {
        ok: true,
        value,
        metadata: result.metadata as GetResult<TOptions> extends {
          ok: true;
          metadata: infer M;
        }
          ? M
          : never,
        expiresAt: result.expiresAt,
        updatedAt: result.updatedAt,
      };
    } catch (error) {
      throw toThrownError(error, `get ${args.name}`);
    }
  }

  async has(ctx: RunQueryCtx, args: HasArgs<TOptions>): Promise<boolean> {
    try {
      return await ctx.runQuery(this.component.lib.has, {
        namespace: readNamespace(args),
        name: args.name,
        now: Date.now(),
      });
    } catch (error) {
      throw toThrownError(error, `has ${args.name}`);
    }
  }

  async remove(
    ctx: RunMutationCtx,
    args: RemoveArgs<TOptions>,
  ): Promise<RemoveResult> {
    try {
      return await ctx.runMutation(this.component.lib.remove, {
        namespace: readNamespace(args),
        name: args.name,
      });
    } catch (error) {
      throw toThrownError(error, `remove ${args.name}`);
    }
  }

  async update(
    ctx: RunMutationCtx,
    args: UpdateArgs<TOptions>,
  ): Promise<UpdateResult> {
    assertNullableNonNegativeInteger(args.expiresAt, "expiresAt");

    try {
      return await ctx.runMutation(this.component.lib.update, {
        namespace: readNamespace(args),
        name: args.name,
        metadata: args.metadata,
        expiresAt: args.expiresAt,
      });
    } catch (error) {
      throw toThrownError(error, `update ${args.name}`);
    }
  }

  async list(ctx: RunQueryCtx, args: ListArgs<TOptions>): Promise<ListResult<TOptions>> {
    try {
      return (await ctx.runQuery(this.component.lib.list, {
        namespace: readNamespace(args),
        paginationOpts: args.paginationOpts,
        order: args.order,
        now: Date.now(),
      })) as ListResult<TOptions>;
    } catch (error) {
      throw toThrownError(error, "list secrets");
    }
  }

  async listEvents(
    ctx: RunQueryCtx,
    args: ListEventsArgs<TOptions>,
  ): Promise<ListEventsResult<TOptions>> {
    if (args.name !== undefined && args.type !== undefined) {
      throw invalidArgumentError("listEvents does not support name + type in V1");
    }

    try {
      return (await ctx.runQuery(this.component.lib.listEvents, {
        namespace: readNamespace(args),
        secretId: args.secretId,
        name: args.name,
        type: args.type,
        paginationOpts: args.paginationOpts,
        order: args.order,
      })) as ListEventsResult<TOptions>;
    } catch (error) {
      throw toThrownError(error, "list events");
    }
  }

  async rotateKeys(
    ctx: RunMutationCtx & RunQueryCtx,
    args: RotateKeysArgs,
  ): Promise<RotateKeysResult> {
    if (!Number.isInteger(args.fromVersion) || args.fromVersion < 0) {
      throw invalidArgumentError("fromVersion must be a non-negative integer");
    }
    const batchSize = args.batchSize ?? DEFAULT_ROTATION_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw invalidArgumentError("batchSize must be a positive integer");
    }

    const toVersion = this.options.activeVersion;
    if (args.fromVersion === toVersion) {
      throw invalidArgumentError("fromVersion must differ from the active version");
    }
    if (!this.options.keyVersions.has(args.fromVersion)) {
      throw keyVersionUnavailableError(args.fromVersion);
    }

    try {
      const page = await ctx.runQuery(this.component.lib.listByKeyVersion, {
        fromVersion: args.fromVersion,
        order: args.order,
        paginationOpts: {
          numItems: batchSize,
          cursor: args.cursor ?? null,
        },
      });

      const fromKek = await this.getKEK(args.fromVersion);
      const toKek = await this.getKEK(toVersion);
      let rotated = 0;
      let skipped = 0;

      for (const row of page.page) {
        const nextWrapped = await rewrapDEK({
          wrappedDEK: row.wrappedDEK,
          dekIv: row.dekIv,
          namespace: row.namespace,
          name: row.name,
          fromVersion: args.fromVersion,
          toVersion,
          fromKek,
          toKek,
        });

        const result = await ctx.runMutation(this.component.lib.updateWrappedDEK, {
          secretId: row.secretId,
          expectedKeyVersion: row.keyVersion,
          expectedUpdatedAt: row.updatedAt,
          keyVersion: toVersion,
          wrappedDEK: nextWrapped.wrappedDEK,
          dekIv: nextWrapped.dekIv,
        });

        if (result.ok) {
          rotated += 1;
        } else {
          skipped += 1;
        }
      }

      let isDone = page.isDone;
      let continueCursor: string | null = page.continueCursor;
      if (skipped > 0 && page.isDone) {
        const remaining = await ctx.runQuery(this.component.lib.listByKeyVersion, {
          fromVersion: args.fromVersion,
          order: args.order,
          paginationOpts: {
            numItems: 1,
            cursor: null,
          },
        });
        if (remaining.page.length > 0) {
          isDone = false;
          continueCursor = null;
        }
      }

      return {
        fromVersion: args.fromVersion,
        toVersion,
        processed: page.page.length,
        rotated,
        skipped,
        isDone,
        continueCursor,
      };
    } catch (error) {
      throw toThrownError(error, `rotate from version ${args.fromVersion}`);
    }
  }

  async cleanup(
    ctx: RunMutationCtx,
    args: CleanupArgs = {},
  ): Promise<CleanupResult> {
    const retentionMs = args.retentionMs ?? DEFAULT_RETENTION_MS;
    const batchSize = args.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE;

    if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
      throw invalidArgumentError("retentionMs must be a positive finite number");
    }
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw invalidArgumentError("batchSize must be a positive integer");
    }

    try {
      return await ctx.runMutation(this.component.lib.cleanup, {
        retentionMs,
        batchSize,
      });
    } catch (error) {
      throw toThrownError(error, "cleanup");
    }
  }
}
