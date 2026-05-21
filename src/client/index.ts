export { SecretStore, SecretStore as default } from "./operations.js";

export { defineKeys } from "../keys-format.js";
export type { KeyEntry } from "../keys-format.js";

export { isSecretStoreError } from "./errors.js";
export type {
  SecretStoreErrorCode,
  SecretStoreErrorData,
} from "./errors.js";

export type {
  GetArgs,
  GetResult,
  GetSuccess,
  HasArgs,
  PutArgs,
  PutResult,
  RunMutationCtx,
  RunQueryCtx,
  SecretId,
} from "./types.js";
