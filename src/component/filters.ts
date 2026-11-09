import type { Id } from "./_generated/dataModel.js";
import type { SecretEventType } from "../shared.js";

export type EventFilter = {
  secretId?: Id<"secrets">;
  namespace?: string;
  name?: string;
  type?: SecretEventType;
};

/** Whether an audit event belongs to the `listEvents` filter it was paged under. */
export function eventMatchesFilter(
  event: {
    secretId: Id<"secrets">;
    namespace?: string;
    name: string;
    type: SecretEventType;
  },
  filter: EventFilter,
): boolean {
  if (filter.secretId !== undefined) {
    return event.secretId === filter.secretId;
  }
  return (
    event.namespace === filter.namespace &&
    (filter.name === undefined || event.name === filter.name) &&
    (filter.type === undefined || event.type === filter.type)
  );
}
