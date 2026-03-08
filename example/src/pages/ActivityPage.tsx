import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import { formatAbsoluteTime, formatCountLabel, formatRelativeTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardAction,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MagnifyingGlass, FunnelSimple } from "@phosphor-icons/react";

type Environment = "production" | "testing";

const EVENT_FILTERS = ["all", "created", "updated", "rotated", "deleted"] as const;
type EventFilter = (typeof EVENT_FILTERS)[number];

export function ActivityPage({ workspace }: { workspace: string }) {
  const [environment, setEnvironment] = useState<Environment>("production");
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

  function badgeVariant(type: string) {
    switch (type) {
      case "created": return "default" as const;
      case "rotated": return "secondary" as const;
      case "deleted": return "destructive" as const;
      default: return "outline" as const;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            Activity
          </p>
          <h2 className="text-sm font-medium mt-1">
            Audit trail for {workspace}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={environment}
            onValueChange={(val) => setEnvironment(val as Environment)}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="production">Production</SelectItem>
              <SelectItem value="testing">Testing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Visible events</p>
            <p className="text-lg font-medium tabular-nums mt-1">{filtered.length}</p>
            <p className="text-xs text-muted-foreground">{formatCountLabel(filtered.length, "event")}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Latest</p>
            <p className="text-lg font-medium mt-1">{latestEvent ? latestEvent.type : "—"}</p>
            <p className="text-xs text-muted-foreground">
              {latestEvent ? formatRelativeTime(latestEvent.createdAt) : "No activity"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card size="sm">
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search provider, type, metadata..."
                className="pl-7"
              />
            </div>
            <div className="flex border border-border p-0.5">
              {EVENT_FILTERS.map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={typeFilter === value ? "default" : "ghost"}
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
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Spinner />
          <span className="text-xs">Loading activity</span>
        </div>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matching events</EmptyTitle>
            <EmptyDescription>
              Broaden the filter or create a connection to see the audit trail.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((event) => (
            <Card key={event.eventId} size="sm">
              <CardHeader>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    {formatAbsoluteTime(event.createdAt)}
                  </p>
                  <CardTitle className="mt-0.5">{event.name}</CardTitle>
                </div>
                <CardAction>
                  <Badge variant={badgeVariant(event.type)}>
                    {event.type}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {event.metadata?.deletedReason
                    ? `Deleted via ${String(event.metadata.deletedReason).replace(/_/g, " ")}`
                    : event.metadata?.previousKeyVersion
                      ? `Moved from version ${event.metadata.previousKeyVersion} to ${event.metadata.newKeyVersion}.`
                      : `Occurred ${formatRelativeTime(event.createdAt)}.`}
                </p>
                {Object.keys(event.metadata ?? {}).length > 0 && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 pt-3 border-t">
                    {Object.entries(event.metadata ?? {}).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{key}</p>
                        <p className="text-xs mt-0.5">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
