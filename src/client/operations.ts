import { ConvexError } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  GetArgs,
  GetResult,
  GetSuccess,
  HasArgs,
  ListArgs,
  ListEventsArgs,
  ListEventsResult,
  ListResult,
  PutArgs,
  PutResult,
  RemoveArgs,
  RemoveResult,
  RotateResult,
  RunMutationCtx,
  RunQueryCtx,
  UpdateArgs,
  UpdateResult,
} from "./types.js";

/**
 * A typed, host-side facade over a mounted secret store component.
 *
 * Construct one shared instance and re-export it from your Convex code:
 *
 * ```ts
 * import { SecretStore } from "convex-secret-store";
 * import { components } from "./_generated/api.js";
 *
 * export const secrets = new SecretStore(components.secretStore);
 * ```
 *
 * The optional type parameters constrain `namespace` and `metadata` at compile
 * time for autocomplete and typo-catching. They are a compile-time aid only —
 * runtime storage stays a string namespace and a freeform metadata record.
 */
export class SecretStore<
  Namespace extends string = string,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(public readonly component: ComponentApi) {}

  /**
   * Encrypt and store a secret value, upserting by `namespace + name`.
   *
   * Expiry is recomputed on every write: `ttlMs` if given, else the configured
   * default, else none; pass `ttlMs: null` for no expiry. On overwrite, omitted
   * `metadata` is preserved; pass `null` to clear it.
   */
  async put(
    ctx: RunMutationCtx,
    args: PutArgs<Namespace, Metadata>,
  ): Promise<PutResult> {
    return await ctx.runMutation(this.component.lib.put, {
      namespace: args.namespace,
      name: args.name,
      value: args.value,
      metadata: args.metadata,
      ttlMs: args.ttlMs,
    });
  }

  /**
   * Load and decrypt a secret value.
   *
   * Returns a discriminated result: `{ ok: true, value, ... }` on success, or
   * `{ ok: false, reason }` when the secret is missing, expired, or its key
   * version is no longer configured.
   */
  async get(
    ctx: RunQueryCtx,
    args: GetArgs<Namespace>,
  ): Promise<GetResult<Metadata>> {
    return (await ctx.runQuery(this.component.lib.get, {
      namespace: args.namespace,
      name: args.name,
      now: Date.now(),
    })) as GetResult<Metadata>;
  }

  /**
   * Like `get`, but throws a `ConvexError` instead of returning a failure
   * result. Use it at call sites that treat a missing or expired secret as an
   * error.
   */
  async getOrThrow(
    ctx: RunQueryCtx,
    args: GetArgs<Namespace>,
  ): Promise<GetSuccess<Metadata>> {
    const result = await this.get(ctx, args);
    if (!result.ok) {
      throw new ConvexError({
        code: result.reason,
        message: `secret "${args.name}" is unavailable: ${result.reason}`,
      });
    }
    const { ok: _ok, ...success } = result;
    return success;
  }

  /**
   * Check whether a usable, non-expired secret exists. Expired secrets return
   * `false`.
   */
  async has(ctx: RunQueryCtx, args: HasArgs<Namespace>): Promise<boolean> {
    return await ctx.runQuery(this.component.lib.has, {
      namespace: args.namespace,
      name: args.name,
      now: Date.now(),
    });
  }

  /**
   * Paginate secrets in a namespace, newest-updated first. Each row carries
   * `effectiveState`; the decrypted value is never included.
   */
  async list(
    ctx: RunQueryCtx,
    args: ListArgs<Namespace>,
  ): Promise<ListResult<Metadata>> {
    return (await ctx.runQuery(this.component.lib.list, {
      namespace: args.namespace,
      paginationOpts: args.paginationOpts,
      order: args.order,
      now: Date.now(),
    })) as ListResult<Metadata>;
  }

  /**
   * Update a secret's metadata or expiry without re-encrypting its value.
   *
   * Omitted fields are preserved; pass `null` to clear `metadata` or expiry.
   */
  async update(
    ctx: RunMutationCtx,
    args: UpdateArgs<Namespace, Metadata>,
  ): Promise<UpdateResult> {
    return await ctx.runMutation(this.component.lib.update, {
      namespace: args.namespace,
      name: args.name,
      metadata: args.metadata,
      ttlMs: args.ttlMs,
    });
  }

  /** Delete a secret. Returns `removed: false` when it does not exist. */
  async remove(
    ctx: RunMutationCtx,
    args: RemoveArgs<Namespace>,
  ): Promise<RemoveResult> {
    return await ctx.runMutation(this.component.lib.remove, {
      namespace: args.namespace,
      name: args.name,
    });
  }

  /**
   * Paginate audit events — by `secretId`, or by `namespace` optionally
   * narrowed with `name` or `type`.
   */
  async listEvents(
    ctx: RunQueryCtx,
    args: ListEventsArgs<Namespace>,
  ): Promise<ListEventsResult> {
    return await ctx.runQuery(this.component.lib.listEvents, {
      namespace: args.namespace,
      secretId: args.secretId,
      name: args.name,
      type: args.type,
      paginationOpts: args.paginationOpts,
      order: args.order,
    });
  }

  /**
   * Rewrap secrets onto the active KEK version. Call once after deploying a new
   * key — it drains in the background; safe to call again to resume a stalled
   * run. Returns the first batch's `{ rotated, isDone }`.
   */
  async rotate(ctx: RunMutationCtx): Promise<RotateResult> {
    return await ctx.runMutation(this.component.lib.rotate, {});
  }

  /**
   * Whether every secret is on the active KEK version. Check this before
   * retiring an old key.
   */
  async isRotationComplete(ctx: RunQueryCtx): Promise<boolean> {
    return await ctx.runQuery(this.component.lib.isRotationComplete, {});
  }
}
