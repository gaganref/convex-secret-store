import { v } from "convex/values";
import { components } from "../_generated/api.js";
import { SecretStore } from "convex-secret-store";

// Demo-only fixed keys. Real apps should load KEKs from environment variables
// or another secret-management system.
const DEMO_KEYS = [
  { version: 2, value: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=" },
  { version: 1, value: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=" },
] as const;

export const environmentValidator = v.union(
  v.literal("development"),
  v.literal("staging"),
  v.literal("production"),
);

export type Environment = "development" | "staging" | "production";
export type Namespace = `${string}:${Environment}`;

// The example app scopes secrets by workspace and environment to demonstrate
// one straightforward namespace strategy: `${workspace}:${environment}`.
export function toNamespace(
  workspace: string,
  environment: Environment,
): Namespace {
  const trimmed = workspace.trim();
  if (trimmed.length === 0) {
    throw new Error("workspace must not be empty");
  }
  return `${trimmed}:${environment}` as Namespace;
}

export const configuredDemoVersions = DEMO_KEYS.map((key) => key.version);
export const activeDemoVersion = DEMO_KEYS[0].version;

export const secrets = new SecretStore<{
  namespace: Namespace;
}>(components.secretStore, {
  keys: [...DEMO_KEYS],
});

// This second client intentionally only knows about the previous KEK version,
// so the example can seed legacy rows and then demonstrate rewrap rotation.
export const legacySecrets = new SecretStore<{
  namespace: Namespace;
}>(components.secretStore, {
  keys: [DEMO_KEYS[1]],
});
