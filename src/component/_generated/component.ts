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
        { name: string; namespace?: string; now: number },
        | {
            expiresAt?: number;
            metadata?: Record<string, any>;
            ok: true;
            updatedAt: number;
            value: string;
          }
        | { ok: false; reason: "not_found" | "expired" | "key_unavailable" },
        Name
      >;
      has: FunctionReference<
        "query",
        "internal",
        { name: string; namespace?: string; now: number },
        boolean,
        Name
      >;
      put: FunctionReference<
        "mutation",
        "internal",
        {
          metadata?: Record<string, any> | null;
          name: string;
          namespace?: string;
          ttlMs?: number | null;
          value: string;
        },
        {
          createdAt: number;
          expiresAt?: number;
          isNew: boolean;
          secretId: string;
          updatedAt: number;
        },
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { name: string; namespace?: string },
        { removed: boolean },
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          metadata?: Record<string, any> | null;
          name: string;
          namespace?: string;
          ttlMs?: number | null;
        },
        { expiresAt?: number; updated: boolean; updatedAt?: number },
        Name
      >;
    };
  };
