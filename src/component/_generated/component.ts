/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      get: FunctionReference<
        "query",
        "internal",
        { name: string; namespace?: string },
        | {
            metadata?: Record<string, any>;
            ok: true;
            updatedAt: number;
            value: string;
          }
        | { ok: false; reason: "not_found" | "key_unavailable" },
        Name
      >;
      put: FunctionReference<
        "mutation",
        "internal",
        {
          metadata?: Record<string, any> | null;
          name: string;
          namespace?: string;
          value: string;
        },
        {
          createdAt: number;
          isNew: boolean;
          secretId: string;
          updatedAt: number;
        },
        Name
      >;
    };
  };
