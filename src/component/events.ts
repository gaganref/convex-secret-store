import type { MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import type { SecretEventType } from "../shared.js";

/**
 * Append an audit event.
 *
 * Events are immutable and append-only; their timestamp is the document's
 * `_creationTime`. `metadata` carries operation context (e.g. a deletion
 * reason or a key-version transition), not the secret's own metadata.
 */
export async function recordEvent(
  ctx: MutationCtx,
  event: {
    secretId: Id<"secrets">;
    namespace: string | undefined;
    name: string;
    type: SecretEventType;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("secretEvents", {
    secretId: event.secretId,
    namespace: event.namespace,
    name: event.name,
    type: event.type,
    ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
  });
}
