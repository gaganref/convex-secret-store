import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel.js";
import { eventMatchesFilter } from "./filters.js";

const secretId = "secret-a" as Id<"secrets">;
const event = {
  secretId,
  namespace: "acme",
  name: "openai",
  type: "updated" as const,
};

describe("eventMatchesFilter", () => {
  test("matches by secretId alone", () => {
    expect(eventMatchesFilter(event, { secretId })).toBe(true);
    expect(
      eventMatchesFilter(event, { secretId: "secret-b" as Id<"secrets"> }),
    ).toBe(false);
  });

  test("matches the namespace, including the default namespace", () => {
    expect(eventMatchesFilter(event, { namespace: "acme" })).toBe(true);
    expect(eventMatchesFilter(event, { namespace: "other" })).toBe(false);
    expect(eventMatchesFilter(event, {})).toBe(false);
    expect(eventMatchesFilter({ ...event, namespace: undefined }, {})).toBe(
      true,
    );
  });

  test("narrows by name and by type within the namespace", () => {
    expect(
      eventMatchesFilter(event, { namespace: "acme", name: "openai" }),
    ).toBe(true);
    expect(
      eventMatchesFilter(event, { namespace: "acme", name: "stripe" }),
    ).toBe(false);
    expect(
      eventMatchesFilter(event, { namespace: "acme", type: "updated" }),
    ).toBe(true);
    expect(
      eventMatchesFilter(event, { namespace: "acme", type: "created" }),
    ).toBe(false);
  });
});
