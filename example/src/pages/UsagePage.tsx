import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format";
import { type Environment } from "@/lib/navigation";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { SecurityExplainer } from "@/components/security-explainer";

type Provider =
  | "openai"
  | "anthropic"
  | "resend"
  | "stripe"
  | "slack"
  | "github";

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  resend: "Resend",
  stripe: "Stripe",
  slack: "Slack",
  github: "GitHub",
};

export function UsagePage({
  workspace,
  environment,
}: {
  workspace: string;
  environment: Environment;
}) {
  const connections = useQuery(api.example.listConnections, {
    workspace,
    environment,
    paginationOpts: { numItems: 50, cursor: null },
  });

  const configuredConnections = (connections?.page ?? []).filter(
    (row) =>
      row.effectiveState === "active" || row.effectiveState === "expired",
  );

  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(
    null,
  );
  const activeSelectedProvider = configuredConnections.some(
    (row) => row.name === selectedProvider,
  )
    ? selectedProvider
    : ((configuredConnections[0]?.name as Provider | undefined) ?? null);

  const usagePreview = useQuery(
    api.example.getUsagePreview,
    activeSelectedProvider === null
      ? "skip"
      : {
          workspace,
          environment,
          provider: activeSelectedProvider,
        },
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest">
          Usage
        </p>
        <h2 className="mt-1 text-sm font-medium">
          Safe server-side consumption for {workspace}
        </h2>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
          This tab shows the reference boundary: a client requests intent, then
          a server wrapper consumes the stored secret and returns only safe
          output.
        </p>
      </div>

      <SecurityExplainer mode="usage" />

      {connections === undefined ? (
        <div
          className="flex items-center justify-center gap-2 py-12 text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <span className="text-xs">Loading configured providers</span>
        </div>
      ) : configuredConnections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No configured providers yet</EmptyTitle>
            <EmptyDescription>
              Add a provider secret on the Connections page, then come back here
              to inspect the server-side usage pattern.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {configuredConnections.map((row) => (
              <Button
                key={row.name}
                size="xs"
                variant={
                  activeSelectedProvider === row.name ? "default" : "ghost"
                }
                onClick={() => setSelectedProvider(row.name as Provider)}
              >
                {PROVIDER_LABELS[row.name as Provider]}
              </Button>
            ))}
          </div>

          {usagePreview === undefined ? (
            <div
              className="flex items-center justify-center gap-2 py-12 text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Spinner />
              <span className="text-xs">Resolving server preview</span>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Reference server wrapper
                  </p>
                  <CardTitle className="mt-0.5">
                    {usagePreview.provider}
                  </CardTitle>
                </div>
                <CardAction>
                  <Badge
                    variant={
                      usagePreview.resolution === "active"
                        ? "default"
                        : usagePreview.resolution === "expired"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {usagePreview.resolution}
                  </Badge>
                </CardAction>
              </CardHeader>

              <CardContent className="space-y-4">
                <CardDescription>{usagePreview.serverNote}</CardDescription>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 border border-border bg-muted/20 p-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Masked token
                      </p>
                      <p className="mt-1 text-sm">
                        {usagePreview.maskedToken ?? "Unavailable"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Auth header preview
                      </p>
                      <p className="mt-1 break-all text-xs">
                        {usagePreview.authHeaderPreview ?? "Unavailable"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 border border-border bg-muted/20 p-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Returned to browser
                      </p>
                      <p className="mt-1 text-xs">
                        {usagePreview.networkSafe
                          ? "Masked data only"
                          : "Not safe"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Owner
                      </p>
                      <p className="mt-1 text-xs">
                        {usagePreview.owner ?? "Unassigned"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Updated
                      </p>
                      <p className="mt-1 text-xs">
                        {usagePreview.updatedAt
                          ? formatRelativeTime(usagePreview.updatedAt)
                          : "Unavailable"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Expires
                      </p>
                      <p className="mt-1 text-xs">
                        {usagePreview.expiresAt
                          ? formatAbsoluteTime(usagePreview.expiresAt)
                          : "No expiry"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3 text-xs text-muted-foreground">
                  Demo behavior: this page returns a masked preview so you can
                  inspect the boundary. A real app would usually return provider
                  results, signed payloads, or status only.
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
