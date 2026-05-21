export { SecretStore, SecretStore as default } from "./operations.js";

export { defineKeys } from "../keys-format.js";
export type { KeyEntry } from "../keys-format.js";

export { isSecretStoreError } from "./errors.js";
export type {
  SecretStoreErrorCode,
  SecretStoreErrorData,
} from "./errors.js";

export type {
  CleanupArgs,
  CleanupResult,
  GetArgs,
  GetResult,
  GetSuccess,
  HasArgs,
  ListArgs,
  ListEventsArgs,
  ListEventsResult,
  ListItem,
  ListResult,
  PaginationOptions,
  PutArgs,
  PutResult,
  RemoveArgs,
  RemoveResult,
  RotateResult,
  RunMutationCtx,
  RunQueryCtx,
  SecretId,
  UpdateArgs,
  UpdateResult,
} from "./types.js";
