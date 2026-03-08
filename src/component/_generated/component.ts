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
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { batchSize: number; retentionMs: number },
        { deletedEvents: number; deletedSecrets: number; isDone: boolean },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { name: string; namespace?: string; now: number },
        | {
            dekIv: string;
            encryptedValue: string;
            expiresAt?: number;
            iv: string;
            keyVersion: number;
            metadata?: Record<string, any>;
            ok: true;
            updatedAt: number;
            wrappedDEK: string;
          }
        | { ok: false; reason: "not_found" | "expired" },
        Name
      >;
      has: FunctionReference<
        "query",
        "internal",
        { name: string; namespace?: string; now: number },
        boolean,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          namespace?: string;
          now: number;
          order?: "asc" | "desc";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            effectiveState: "active" | "expired";
            expiresAt?: number;
            keyVersion: number;
            metadata?: Record<string, any>;
            name: string;
            namespace?: string;
            secretId: string;
            updatedAt: number;
          }>;
        },
        Name
      >;
      listByKeyVersion: FunctionReference<
        "query",
        "internal",
        {
          fromVersion: number;
          order?: "asc" | "desc";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            dekIv: string;
            keyVersion: number;
            name: string;
            namespace?: string;
            secretId: string;
            updatedAt: number;
            wrappedDEK: string;
          }>;
        },
        Name
      >;
      listEvents: FunctionReference<
        "query",
        "internal",
        {
          name?: string;
          namespace?: string;
          order?: "asc" | "desc";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          secretId?: string;
          type?: "created" | "updated" | "deleted" | "rotated";
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            eventId: string;
            metadata?: Record<string, any>;
            name: string;
            namespace?: string;
            secretId: string;
            type: "created" | "updated" | "deleted" | "rotated";
          }>;
        },
        Name
      >;
      put: FunctionReference<
        "mutation",
        "internal",
        {
          dekIv: string;
          encryptedValue: string;
          expiresAt?: number | null;
          iv: string;
          keyVersion: number;
          metadata?: Record<string, any> | null;
          name: string;
          namespace?: string;
          wrappedDEK: string;
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
          expiresAt?: number | null;
          metadata?: Record<string, any> | null;
          name: string;
          namespace?: string;
        },
        { expiresAt?: number; updated: boolean; updatedAt?: number },
        Name
      >;
      updateWrappedDEK: FunctionReference<
        "mutation",
        "internal",
        {
          dekIv: string;
          expectedKeyVersion: number;
          expectedUpdatedAt: number;
          keyVersion: number;
          secretId: string;
          wrappedDEK: string;
        },
        | { ok: true; updatedAt: number }
        | { ok: false; reason: "not_found" | "stale" },
        Name
      >;
    };
  };
