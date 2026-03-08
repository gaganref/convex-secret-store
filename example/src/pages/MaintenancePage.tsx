import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import { formatCountLabel } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  ArrowsClockwise,
  Broom,
  Plant,
} from "@phosphor-icons/react";
import { type Environment, ENVIRONMENT_OPTIONS } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/utils";

export function MaintenancePage({
  workspace,
  environment,
}: {
  workspace: string;
  environment: Environment;
}) {
  const snapshot = useQuery(api.example.getMaintenanceSnapshot, {
    workspace,
    environment,
  });
  const seedLegacyConnection = useMutation(api.example.seedLegacyConnection);
  const runRotationBatch = useMutation(api.example.runRotationBatch);
  const runCleanup = useMutation(api.example.runCleanup);

  const [operationState, setOperationState] = useState<string | null>(null);
  const [rotationResult, setRotationResult] =
    useState<Awaited<ReturnType<typeof runRotationBatch>> | null>(null);
  const [cleanupResult, setCleanupResult] =
    useState<Awaited<ReturnType<typeof runCleanup>> | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const legacyCount = useMemo(() => {
    return snapshot?.versionCounts.find((entry) => entry.keyVersion === 1)?.count ?? 0;
  }, [snapshot]);
  const isOperating = operationState !== null;

  async function handleSeedLegacy() {
    setOperationState("Seeding legacy row");
    setOperationError(null);
    try {
      await seedLegacyConnection({
        workspace,
        environment,
        provider: "github",
        value: "ghp_demo_legacy_token",
      });
    } catch (error) {
      setOperationError(getErrorMessage(error, "Could not seed the legacy connection."));
    } finally {
      setOperationState(null);
    }
  }

  async function handleRotate() {
    setOperationState("Running rotation batch");
    setOperationError(null);
    try {
      const result = await runRotationBatch({
        fromVersion: 1,
        batchSize: 25,
        cursor: null,
      });
      setRotationResult(result);
    } catch (error) {
      setOperationError(getErrorMessage(error, "Could not run the rotation batch."));
    } finally {
      setOperationState(null);
    }
  }

  async function handleCleanup() {
    setOperationState("Running cleanup");
    setOperationError(null);
    try {
      const result = await runCleanup({
        batchSize: 50,
        retentionMs: 30 * 24 * 60 * 60 * 1000,
      });
      setCleanupResult(result);
    } catch (error) {
      setOperationError(getErrorMessage(error, "Could not run cleanup."));
    } finally {
      setOperationState(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            Maintenance
          </p>
          <h2 className="text-sm font-medium mt-1">
            Operate the store without touching plaintext
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Viewing snapshot:</span>
          <Badge variant="outline">
            {ENVIRONMENT_OPTIONS.find((option) => option.value === environment)?.label}
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Versions</p>
            <p className="text-lg font-medium tabular-nums mt-1">
              {snapshot?.configuredVersions.join(", ") ?? "..."}
            </p>
            <p className="text-xs text-muted-foreground">
              {snapshot ? `Active: v${snapshot.activeVersion}` : "Loading"}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Legacy rows</p>
            <p className="text-lg font-medium tabular-nums mt-1">{legacyCount}</p>
            <p className="text-xs text-muted-foreground">
              {legacyCount > 0 ? "Ready to rotate" : "No old rows"}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Active</p>
            <p className="text-lg font-medium tabular-nums mt-1">{snapshot?.activeSecrets ?? "..."}</p>
            <p className="text-xs text-muted-foreground">
              {snapshot ? formatCountLabel(snapshot.totalSecrets, "stored secret") : "Loading"}
            </p>
          </CardContent>
        </Card>
      </div>

      {snapshot === undefined ? (
        <div
          className="flex items-center justify-center py-12 text-muted-foreground gap-2"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <span className="text-xs">Loading maintenance snapshot</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Version Inventory */}
          <Card>
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Configured keys
                </p>
                <CardTitle className="mt-0.5">Version inventory</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {snapshot.configuredVersions.map((version) => (
                  <div
                    key={version}
                    className="flex items-center justify-between gap-3 p-2.5 border bg-muted/30"
                  >
                    <div>
                      <p className="text-xs font-medium">Version {version}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {version === snapshot.activeVersion ? "Used for new writes" : "Decrypt-only"}
                      </p>
                    </div>
                    <Badge variant={version === snapshot.activeVersion ? "default" : "secondary"}>
                      {snapshot.versionCounts.find((e) => e.keyVersion === version)?.count ?? 0} rows
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Rotation */}
          <Card>
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Rotation
                </p>
                <CardTitle className="mt-0.5">Move v1 rows forward</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Seed a legacy row in the selected scope, then run a store-wide rotation batch to rewrap DEKs onto the active KEK.
              </CardDescription>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="xs" onClick={() => void handleSeedLegacy()} disabled={isOperating}>
                  <Plant size={12} data-icon="inline-start" />
                  Seed legacy
                </Button>
                <Button size="xs" variant="outline" onClick={() => void handleRotate()} disabled={isOperating}>
                  <ArrowsClockwise size={12} data-icon="inline-start" />
                  Rotate all v1 rows
                </Button>
              </div>
              {rotationResult && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 pt-3 border-t">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Processed</p>
                    <p className="text-xs mt-0.5 tabular-nums">{rotationResult.processed}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Rotated</p>
                    <p className="text-xs mt-0.5 tabular-nums">{rotationResult.rotated}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Skipped</p>
                    <p className="text-xs mt-0.5 tabular-nums">{rotationResult.skipped}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Done</p>
                    <p className="text-xs mt-0.5">{rotationResult.isDone ? "Yes" : "No"}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cleanup */}
          <Card>
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Cleanup
                </p>
                <CardTitle className="mt-0.5">Delete expired rows</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Cleanup is store-wide, runs in bounded batches, and writes a deleted event before removing each expired secret.
              </CardDescription>
              <div className="mt-3">
                <Button size="xs" variant="outline" onClick={() => void handleCleanup()} disabled={isOperating}>
                  <Broom size={12} data-icon="inline-start" />
                  Run cleanup batch
                </Button>
              </div>
              {cleanupResult && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 pt-3 border-t">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Deleted secrets</p>
                    <p className="text-xs mt-0.5 tabular-nums">{cleanupResult.deletedSecrets}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Deleted events</p>
                    <p className="text-xs mt-0.5 tabular-nums">{cleanupResult.deletedEvents}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Done</p>
                    <p className="text-xs mt-0.5">{cleanupResult.isDone ? "Yes" : "No"}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {operationState && (
        <Card size="sm">
          <CardContent>
            <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
              <Spinner />
              <span className="text-xs">{operationState}...</span>
            </div>
          </CardContent>
        </Card>
      )}

      {operationError && (
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-destructive" role="alert">
              {operationError}
            </p>
          </CardContent>
        </Card>
      )}

      {!operationState && snapshot && snapshot.totalSecrets === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No secrets stored yet</EmptyTitle>
            <EmptyDescription>
              Add a provider secret on the Connections page, then come back to exercise cleanup and rotation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
