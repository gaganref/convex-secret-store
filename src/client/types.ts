import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  FunctionVisibility,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

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
};

/** Result of `SecretStore.put`. */
export type PutResult = PutComponentResult;

/** Arguments for `SecretStore.get`. */
export type GetArgs<Namespace extends string> = {
  namespace?: Namespace;
  name: string;
};

/** Result of `SecretStore.get` — a discriminated success/failure union. */
export type GetResult<Metadata extends Record<string, unknown>> =
  | {
      ok: true;
      value: string;
      metadata: Metadata | undefined;
      updatedAt: number;
    }
  | {
      ok: false;
      reason: "not_found" | "key_unavailable";
    };
