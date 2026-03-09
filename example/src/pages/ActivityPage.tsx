import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import { formatAbsoluteTime, formatCountLabel, formatRelativeTime } from "@/lib/format";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { type Environment } from "@/lib/navigation";

const EVENT_FILTERS = ["all", "created", "updated", "rotated", "deleted"] as const;
type EventFilter = (typeof EVENT_FILTERS)[number];

export function ActivityPage({
  workspace,
  environment,
}: {
  workspace: string;
  environment: Environment;
}) {
  const activity = useQuery(api.example.listActivity, {
    workspace,
    environment,
    paginationOpts: { numItems: 60, cursor: null },
  });
  const [typeFilter, setTypeFilter] = useState<EventFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const filtered = useMemo(() => {
    const rows = activity?.page ?? [];
    return rows.filter((event) => {
      if (typeFilter !== "all" && event.type !== typeFilter) return false;
      if (deferredSearch.length === 0) return true;
      const haystack = [event.name, event.type, JSON.stringify(event.metadata ?? {})]
        .join(" ")
        .toLowerCase();
      return haystack.includes(deferredSearch);
    });
  }, [activity, deferredSearch, typeFilter]);

  const latestEvent = filtered[0];
  const visibleLabel = activity
    ? `${formatCountLabel(filtered.length, "visible event")}`
    : "Loading events";

  function badgeVariant(type: string) {
    switch (type) {
      case "created":
        return "default" as const;
      case "rotated":
        return "secondary" as const;
      case "deleted":
        return "destructive" as const;
      default:
        return "outline" as const;
    }
  }

  function describeEvent(event: (typeof filtered)[number]) {
    if (event.metadata?.deletedReason) {
      return `Deleted via ${String(event.metadata.deletedReason).replace(/_/g, " ")}.`;
    }
    if (event.metadata?.previousKeyVersion) {
      return `Moved from version ${event.metadata.previousKeyVersion} to ${event.metadata.newKeyVersion}.`;
    }
    if (event.type === "created") return "Secret added to this scope.";
    if (event.type === "updated") return "Secret or details changed.";
    return `Occurred ${formatRelativeTime(event.createdAt)}.`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            Activity
          </p>
          <h2 className="text-sm font-medium mt-1">
            Audit trail for {workspace}
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Every write path appends audit records here, including cleanup-driven
            deletions and key rotation batches for the selected scope.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{visibleLabel}</Badge>
          <Badge variant="outline">{typeFilter === "all" ? "All types" : typeFilter}</Badge>
          <Badge variant="outline">
            {latestEvent ? `Latest ${formatRelativeTime(latestEvent.createdAt)}` : "No activity yet"}
          </Badge>
        </div>
      </div>

      <Card size="sm">
        <CardContent>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1 min-w-48">
              <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search provider, type, metadata..."
                className="pl-7"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {EVENT_FILTERS.map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={typeFilter === value ? "default" : "outline"}
                  onClick={() => setTypeFilter(value)}
                  className="capitalize"
                >
                  {value}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      {activity === undefined ? (
        <div
          className="flex items-center justify-center py-12 text-muted-foreground gap-2"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <span className="text-xs">Loading activity</span>
        </div>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matching events</EmptyTitle>
            <EmptyDescription>
              Broaden the filter or create a connection to start the audit trail for
              this scope.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden border border-border bg-card">
          {filtered.map((event) => (
            <div
              key={event.eventId}
              className="grid gap-3 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[160px_minmax(0,1fr)_auto] md:items-start"
            >
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  {formatAbsoluteTime(event.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(event.createdAt)}
                </p>
              </div>

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{event.name}</p>
                  <Badge variant={badgeVariant(event.type)}>
                    {event.type}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {describeEvent(event)}
                </p>
                {Object.keys(event.metadata ?? {}).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(event.metadata ?? {}).map(([key, value]) => (
                      <Badge key={key} variant="outline">
                        {key}: {String(value)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="justify-self-start md:justify-self-end">
                <Badge variant="outline">{environment}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
