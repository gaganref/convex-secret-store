export type SecretStoreClientErrorCode =
  | "INVALID_OPTIONS"
  | "VALUE_TOO_LARGE"
  | "INVALID_ARGUMENT"
  | "KEY_VERSION_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE"
  | "OPERATION_FAILED";

export class SecretStoreClientError extends Error {
  readonly name = "SecretStoreClientError";
  readonly code: SecretStoreClientErrorCode;
  readonly cause?: unknown;

  constructor(
    code: SecretStoreClientErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

export function isSecretStoreClientError(
  error: unknown,
): error is SecretStoreClientError {
  return error instanceof SecretStoreClientError;
}

export function optionsError(message: string) {
  return new SecretStoreClientError(
    "INVALID_OPTIONS",
    `secret-store options: ${message}`,
  );
}

export function valueTooLargeError(limitBytes: number, actualBytes: number) {
  return new SecretStoreClientError(
    "VALUE_TOO_LARGE",
    `secret-store value exceeds ${limitBytes} bytes (received ${actualBytes})`,
  );
}

export function invalidArgumentError(message: string) {
  return new SecretStoreClientError(
    "INVALID_ARGUMENT",
    `secret-store: ${message}`,
  );
}

export function keyVersionUnavailableError(version: number) {
  return new SecretStoreClientError(
    "KEY_VERSION_UNAVAILABLE",
    `secret-store: key version ${version} is not configured`,
  );
}

export function runtimeUnavailableError(message: string) {
  return new SecretStoreClientError(
    "RUNTIME_UNAVAILABLE",
    `secret-store runtime: ${message}`,
  );
}

export function operationFailedError(message: string, cause: unknown) {
  return new SecretStoreClientError(
    "OPERATION_FAILED",
    `secret-store operation failed: ${message}`,
    cause,
  );
}
