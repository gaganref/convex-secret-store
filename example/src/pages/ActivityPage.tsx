import { useDeferredValue, useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { type Environment } from "@/lib/navigation";

const EVENT_TYPES = [
  "all",
  "created",
  "updated",
  "rotated",
  "deleted",
] as const;
type EventFilter = (typeof EVENT_TYPES)[number];

export function ActivityPage({
  workspace,
  environment,
}: {
  workspace: string;
  environment: Environment;
}) {
  const [typeFilter, setTypeFilter] = useState<EventFilter>("all");
  const {
    results: activity,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.example.listActivity,
    {
      workspace,
      environment,
      type: typeFilter === "all" ? undefined : typeFilter,
    },
    { initialNumItems: 50 },
  );
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  type ActivityRow = (typeof activity)[number];

  const filtered = useMemo(() => {
    return activity.filter((event: ActivityRow) => {
      if (deferredSearch.length === 0) return true;
      return event.name.toLowerCase().includes(deferredSearch);
    });
  }, [activity, deferredSearch]);
  const noActivity = activity.length === 0 && typeFilter === "all";

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
      return `Deleted via ${String(event.metadata.deletedReason).replace(/_/g, " ")}`;
    }
    if (event.metadata?.previousKeyVersion) {
      return `Rotated from v${event.metadata.previousKeyVersion} to v${event.metadata.newKeyVersion}`;
    }
    if (event.type === "created") return "Secret created";
    if (event.type === "updated") return "Secret updated";
    return "";
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest">
          Activity
        </p>
        <h2 className="text-sm font-medium mt-1">
          {workspace} / {environment}
        </h2>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter loaded events by name..."
          className="h-7 border border-border bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-48"
        />
        <div className="flex flex-wrap gap-1">
          {EVENT_TYPES.map((value) => (
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

      <p className="text-xs text-muted-foreground">
        Name search applies to the {activity.length} loaded events. Type filters
        apply to all events.
      </p>

      {/* Event list */}
      {status === "LoadingFirstPage" ? (
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
            <EmptyTitle>
              {noActivity ? "No activity yet" : "No matching events"}
            </EmptyTitle>
            <EmptyDescription>
              {noActivity
                ? "Events appear here when you add, change, or remove a secret."
                : activity.length === 0
                  ? "No events match this type. Choose another type or add a secret."
                  : "Change the filters to find activity in the loaded events."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden border border-border bg-card">
          {/* Header */}
          <div className="hidden md:grid md:grid-cols-[140px_minmax(0,1fr)_80px_auto] gap-3 border-b border-border px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Time</span>
            <span>Secret</span>
            <span>Type</span>
            <span>Detail</span>
          </div>
          {filtered.map((event: ActivityRow) => (
            <div
              key={event.eventId}
              className="grid gap-2 border-t border-border px-4 py-2.5 first:border-t-0 md:grid-cols-[140px_minmax(0,1fr)_80px_auto] md:items-center"
            >
              <div>
                <p className="text-xs text-muted-foreground">
                  {formatAbsoluteTime(event.createdAt)}
                </p>
                <p className="text-[10px] text-muted-foreground md:hidden">
                  {formatRelativeTime(event.createdAt)}
                </p>
              </div>
              <p className="text-sm font-mono font-medium truncate">
                {event.name}
              </p>
              <div>
                <Badge
                  variant={badgeVariant(event.type)}
                  className="text-[10px]"
                >
                  {event.type}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {describeEvent(event)}
              </p>
            </div>
          ))}
        </div>
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          variant="outline"
          onClick={() => loadMore(50)}
          disabled={status === "LoadingMore"}
        >
          {status === "LoadingMore" ? "Loading events..." : "Load more events"}
        </Button>
      )}
    </div>
  );
}
