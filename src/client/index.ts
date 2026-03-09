export { SecretStore, SecretStore as default } from "./operations.js";

export { SecretStoreClientError, isSecretStoreClientError } from "./errors.js";

export type { SecretStoreClientErrorCode } from "./errors.js";
export type { SecretStoreOptions } from "./options.js";

export type {
  CleanupEventsArgs,
  CleanupEventsResult,
  CleanupSecretsArgs,
  CleanupSecretsResult,
  GetArgs,
  GetResult,
  HasArgs,
  ListArgs,
  ListEventsArgs,
  ListEventsResult,
  ListResult,
  PaginationOptions,
  PutArgs,
  PutResult,
  RemoveArgs,
  RemoveResult,
  RotateKeysArgs,
  RotateKeysResult,
  RunMutationCtx,
  RunQueryCtx,
  RunReadWriteCtx,
  SecretId,
  SecretStoreTypeOptions,
  UpdateArgs,
  UpdateResult,
} from "./types.js";
