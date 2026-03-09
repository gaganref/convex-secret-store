# Changelog

## 0.1.0

- Initial release of `convex-secret-store`.
- Added the `SecretStore` client for encrypted secret storage with:
  - envelope encryption using per-secret DEKs and versioned KEKs
  - expiry-aware reads and cleanup
  - audit events for create, update, delete, and rotate operations
  - explicit DEK rewrap-based key rotation
- Added the `Integration Vault` example app demonstrating:
  - secret storage and replacement flows
  - safe server-side consumption patterns
  - audit activity browsing
  - rotation and cleanup operations
- Added typed client options for namespace and metadata constraints.
- Added backend, client, and example tests plus coverage reporting.
