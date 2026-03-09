import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  FunctionVisibility,
} from "convex/server";
import type { SecretEventType } from "../shared.js";
import type { ComponentApi } from "../component/_generated/component.js";

type PutMutationResult = FunctionReturnType<ComponentApi["lib"]["put"]>;
type GetQueryResult = FunctionReturnType<ComponentApi["lib"]["get"]>;
type ListQueryResult = FunctionReturnType<ComponentApi["lib"]["list"]>;
type ListEventsQueryResult = FunctionReturnType<
  ComponentApi["lib"]["listEvents"]
>;
type CleanupMutationResult = FunctionReturnType<ComponentApi["lib"]["cleanup"]>;

export type SecretStoreTypeOptions = {
  namespace?: string;
  metadata?: Record<string, unknown>;
};

type NamespaceArg<TOptions extends SecretStoreTypeOptions> = TOptions extends {
  namespace: infer N extends string;
}
  ? { namespace: N }
  : { namespace?: never };

type NamespaceOutput<TOptions extends SecretStoreTypeOptions> =
  TOptions extends {
    namespace: infer N extends string;
  }
    ? N | undefined
    : undefined;

type MetadataInput<TOptions extends SecretStoreTypeOptions> = TOptions extends {
  metadata: infer M extends Record<string, unknown>;
}
  ? M
  : Record<string, unknown>;

type MetadataOutput<TOptions extends SecretStoreTypeOptions> =
  TOptions extends {
    metadata: infer M extends Record<string, unknown>;
  }
    ? M | undefined
    : Record<string, unknown> | undefined;

type ListItemBase = ListQueryResult["page"][number];
type EventItemBase = ListEventsQueryResult["page"][number];
type GetFailureBase = Extract<GetQueryResult, { ok: false }>;

export type SecretId = PutMutationResult["secretId"];

export type PaginationOptions = {
  numItems: number;
  cursor: string | null;
};

export type PutArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = NamespaceArg<TOptions> & {
  name: string;
  value: string;
  metadata?: MetadataInput<TOptions> | null;
  ttlMs?: number | null;
};

export type PutResult = PutMutationResult;

export type GetArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = NamespaceArg<TOptions> & {
  name: string;
};

export type GetResult<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> =
  | {
      ok: true;
      value: string;
      metadata: MetadataOutput<TOptions>;
      expiresAt?: number;
      updatedAt: number;
    }
  | GetFailureBase
  | { ok: false; reason: "key_version_unavailable" };

export type HasArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = NamespaceArg<TOptions> & {
  name: string;
};

export type RemoveArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = NamespaceArg<TOptions> & {
  name: string;
};

export type RemoveResult = FunctionReturnType<ComponentApi["lib"]["remove"]>;

export type UpdateArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = NamespaceArg<TOptions> & {
  name: string;
  metadata?: MetadataInput<TOptions> | null;
  expiresAt?: number | null;
};

export type UpdateResult = FunctionReturnType<ComponentApi["lib"]["update"]>;

export type ListArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = NamespaceArg<TOptions> & {
  paginationOpts: PaginationOptions;
  order?: "asc" | "desc";
};

export type ListResult<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = Omit<ListQueryResult, "page"> & {
  page: Array<
    Omit<ListItemBase, "metadata" | "namespace"> & {
      metadata: MetadataOutput<TOptions>;
      namespace?: NamespaceOutput<TOptions>;
    }
  >;
};

type ListEventsBySecretIdArgs = {
  secretId: SecretId;
  name?: never;
  type?: never;
};

type ListEventsByNamespaceArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = NamespaceArg<TOptions> & {
  secretId?: never;
  name?: string;
  type?: SecretEventType;
};

export type ListEventsArgs<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = {
  paginationOpts: PaginationOptions;
  order?: "asc" | "desc";
} & (ListEventsBySecretIdArgs | ListEventsByNamespaceArgs<TOptions>);

export type ListEventsResult<
  TOptions extends SecretStoreTypeOptions = Record<never, never>,
> = Omit<ListEventsQueryResult, "page"> & {
  page: Array<
    Omit<EventItemBase, "namespace"> & {
      namespace?: NamespaceOutput<TOptions>;
    }
  >;
};

export type RotateKeysArgs = {
  fromVersion: number;
  batchSize?: number;
  cursor?: string | null;
  order?: "asc" | "desc";
};

export type RotateKeysResult = {
  fromVersion: number;
  toVersion: number;
  processed: number;
  rotated: number;
  skipped: number;
  isDone: boolean;
  continueCursor: string | null;
};

export type CleanupArgs = {
  retentionMs?: number;
  batchSize?: number;
};

export type CleanupResult = CleanupMutationResult;

export type RunMutationCtx = {
  runMutation: <
    Mutation extends FunctionReference<"mutation", FunctionVisibility>,
  >(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
  ) => Promise<FunctionReturnType<Mutation>>;
};

export type RunQueryCtx = {
  runQuery: <Query extends FunctionReference<"query", FunctionVisibility>>(
    query: Query,
    args: FunctionArgs<Query>,
  ) => Promise<FunctionReturnType<Query>>;
};

export type RunReadWriteCtx = RunMutationCtx & RunQueryCtx;
