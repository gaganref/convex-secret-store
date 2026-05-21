import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  FunctionVisibility,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type { SecretEventType } from "../shared.js";

/** A context that can run component queries (query, mutation, or action ctx). */
export type RunQueryCtx = {
  runQuery: <Query extends FunctionReference<"query", FunctionVisibility>>(
    query: Query,
    args: FunctionArgs<Query>,
  ) => Promise<FunctionReturnType<Query>>;
};

/** A context that can run component mutations (mutation or action ctx). */
export type RunMutationCtx = {
  runMutation: <
    Mutation extends FunctionReference<"mutation", FunctionVisibility>,
  >(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
  ) => Promise<FunctionReturnType<Mutation>>;
};

type PutComponentResult = FunctionReturnType<ComponentApi["lib"]["put"]>;

/** The id of a stored secret. */
export type SecretId = PutComponentResult["secretId"];

/** Arguments for `SecretStore.put`. */
export type PutArgs<
  Namespace extends string,
  Metadata extends Record<string, unknown>,
> = {
  namespace?: Namespace;
  name: string;
  value: string;
  metadata?: Metadata | null;
  ttlMs?: number | null;
};

/** Result of `SecretStore.put`. */
export type PutResult = PutComponentResult;

/** Arguments for `SecretStore.get` and `SecretStore.getOrThrow`. */
export type GetArgs<Namespace extends string> = {
  namespace?: Namespace;
  name: string;
};

/** Arguments for `SecretStore.has`. */
export type HasArgs<Namespace extends string> = {
  namespace?: Namespace;
  name: string;
};

/** The decrypted payload of a successful read. */
export type GetSuccess<Metadata extends Record<string, unknown>> = {
  value: string;
  metadata: Metadata | undefined;
  expiresAt?: number;
  updatedAt: number;
};

/** Result of `SecretStore.get` — a discriminated success/failure union. */
export type GetResult<Metadata extends Record<string, unknown>> =
  | ({ ok: true } & GetSuccess<Metadata>)
  | { ok: false; reason: "not_found" | "expired" | "key_unavailable" };

/** Arguments for `SecretStore.update`. */
export type UpdateArgs<
  Namespace extends string,
  Metadata extends Record<string, unknown>,
> = {
  namespace?: Namespace;
  name: string;
  metadata?: Metadata | null;
  ttlMs?: number | null;
};

/** Result of `SecretStore.update`. */
export type UpdateResult = FunctionReturnType<ComponentApi["lib"]["update"]>;

/** Arguments for `SecretStore.remove`. */
export type RemoveArgs<Namespace extends string> = {
  namespace?: Namespace;
  name: string;
};

/** Result of `SecretStore.remove`. */
export type RemoveResult = FunctionReturnType<ComponentApi["lib"]["remove"]>;

/** Cursor-based pagination options. */
export type PaginationOptions = {
  numItems: number;
  cursor: string | null;
};

/**
 * Arguments for `SecretStore.listEvents`.
 *
 * Filter by `secretId`, or by `namespace` optionally narrowed with `name` or
 * `type` — the two forms are mutually exclusive.
 */
export type ListEventsArgs<Namespace extends string> = {
  paginationOpts: PaginationOptions;
  order?: "asc" | "desc";
} & (
  | { secretId: SecretId; namespace?: never; name?: never; type?: never }
  | {
      secretId?: never;
      namespace?: Namespace;
      name?: string;
      type?: SecretEventType;
    }
);

/** Result of `SecretStore.listEvents`. */
export type ListEventsResult = FunctionReturnType<
  ComponentApi["lib"]["listEvents"]
>;

/** Arguments for `SecretStore.list`. */
export type ListArgs<Namespace extends string> = {
  namespace?: Namespace;
  paginationOpts: PaginationOptions;
  order?: "asc" | "desc";
};

type RawListResult = FunctionReturnType<ComponentApi["lib"]["list"]>;

/** One secret in a `SecretStore.list` page. */
export type ListItem<Metadata extends Record<string, unknown>> = Omit<
  RawListResult["page"][number],
  "metadata"
> & { metadata: Metadata | undefined };

/** Result of `SecretStore.list`. */
export type ListResult<Metadata extends Record<string, unknown>> = {
  page: Array<ListItem<Metadata>>;
  isDone: boolean;
  continueCursor: string;
};

/** Result of `SecretStore.rotate`. */
export type RotateResult = FunctionReturnType<ComponentApi["lib"]["rotate"]>;

/** Arguments for `SecretStore.cleanupSecrets` and `SecretStore.cleanupEvents`. */
export type CleanupArgs = {
  retentionMs?: number;
};

/** Result of `SecretStore.cleanupSecrets` and `SecretStore.cleanupEvents`. */
export type CleanupResult = FunctionReturnType<
  ComponentApi["cleanup"]["cleanupSecrets"]
>;
