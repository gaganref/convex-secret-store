import { v } from "convex/values";
import { components } from "../_generated/api.js";
import { SecretStore } from "../../../src/client/index.js";

export const environmentValidator = v.union(
  v.literal("development"),
  v.literal("staging"),
  v.literal("production"),
);

export type Environment = "development" | "staging" | "production";
export type Namespace = `${string}:${Environment}`;

// The example scopes secrets by workspace and environment to demonstrate one
// straightforward namespace strategy: `${workspace}:${environment}`.
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

// Keys live in the component's environment, so the facade is constructed with
// no options — just the typed namespace constraint.
export const secrets = new SecretStore<Namespace>(components.secretStore);
