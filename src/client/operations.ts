import type { ComponentApi } from "../component/_generated/component.js";
import type {
  GetArgs,
  GetResult,
  PutArgs,
  PutResult,
  RunMutationCtx,
  RunQueryCtx,
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
   * On overwrite, omitted `metadata` is preserved; pass `null` to clear it.
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
    });
  }

  /**
   * Load and decrypt a secret value.
   *
   * Returns a discriminated result: `{ ok: true, value, ... }` on success, or
   * `{ ok: false, reason }` when the secret is missing or its key version is
   * no longer configured.
   */
  async get(
    ctx: RunQueryCtx,
    args: GetArgs<Namespace>,
  ): Promise<GetResult<Metadata>> {
    return (await ctx.runQuery(this.component.lib.get, {
      namespace: args.namespace,
      name: args.name,
    })) as GetResult<Metadata>;
  }
}
