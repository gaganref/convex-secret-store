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
import { ArrowsClockwise, Broom, Plant } from "@phosphor-icons/react";
import { type Environment } from "@/lib/navigation";
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
  const [rotationResult, setRotationResult] = useState<Awaited<
    ReturnType<typeof runRotationBatch>
  > | null>(null);
  const [cleanupResult, setCleanupResult] = useState<Awaited<
    ReturnType<typeof runCleanup>
  > | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const legacyCount = useMemo(() => {
    return (
      snapshot?.versionCounts.find((entry) => entry.keyVersion === 1)?.count ??
      0
    );
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
      setOperationError(
        getErrorMessage(error, "Could not seed the legacy connection."),
      );
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
      setOperationError(
        getErrorMessage(error, "Could not run the rotation batch."),
      );
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
            Advanced
          </p>
          <h2 className="text-sm font-medium mt-1">
            Rotation and cleanup without touching plaintext
          </h2>
          <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
            These are secondary reference operations. The selected workspace is
            used for the snapshot and demo seed flow; rotation and cleanup still
            run across the component store.
          </p>
        </div>
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
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">
              Active key v{snapshot.activeVersion}
            </Badge>
            <Badge variant="outline">
              {formatCountLabel(snapshot.totalSecrets, "stored secret")}
            </Badge>
            <Badge variant={legacyCount > 0 ? "secondary" : "outline"}>
              {legacyCount > 0
                ? formatCountLabel(legacyCount, "legacy row")
                : "No legacy rows"}
            </Badge>
            <Badge
              variant={snapshot.expiredSecrets > 0 ? "destructive" : "outline"}
            >
              {snapshot.expiredSecrets > 0
                ? formatCountLabel(snapshot.expiredSecrets, "expired secret")
                : "No expired secrets"}
            </Badge>
          </div>

          <Card size="sm">
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Key inventory
                </p>
                <CardTitle className="mt-0.5">Configured versions</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {snapshot.configuredVersions.map((version) => (
                  <Badge
                    key={version}
                    variant={
                      version === snapshot.activeVersion ? "default" : "outline"
                    }
                  >
                    v{version} ·{" "}
                    {snapshot.versionCounts.find(
                      (entry) => entry.keyVersion === version,
                    )?.count ?? 0}{" "}
                    rows
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Rotation
                  </p>
                  <CardTitle className="mt-0.5">
                    Move old key versions forward
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription>
                  Rewrap DEKs from version 1 onto the active key version. The
                  underlying secret plaintext is not rewritten, only the
                  wrapping layer changes.
                </CardDescription>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void handleRotate()}
                    disabled={isOperating}
                  >
                    <ArrowsClockwise size={12} data-icon="inline-start" />
                    Rotate v1 rows
                  </Button>
                </div>
                <details className="border border-border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Demo helper
                  </summary>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Demo-only helper: seed one legacy GitHub secret in this
                      workspace so rotation has an old-version row to process.
                    </p>
                    <Button
                      size="xs"
                      onClick={() => void handleSeedLegacy()}
                      disabled={isOperating}
                    >
                      <Plant size={12} data-icon="inline-start" />
                      Seed legacy
                    </Button>
                  </div>
                </details>
                {rotationResult && (
                  <div className="flex flex-wrap gap-2 border-t pt-3 text-xs">
                    <Badge variant="outline">
                      {rotationResult.processed} processed
                    </Badge>
                    <Badge variant="outline">
                      {rotationResult.rotated} rotated
                    </Badge>
                    <Badge variant="outline">
                      {rotationResult.skipped} skipped
                    </Badge>
                    <Badge
                      variant={rotationResult.isDone ? "default" : "outline"}
                    >
                      {rotationResult.isDone
                        ? "Batch complete"
                        : "More rows remain"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Cleanup
                  </p>
                  <CardTitle className="mt-0.5">Delete expired rows</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription>
                  Sweep expired secrets in bounded batches. Each deletion writes
                  a matching audit event first, so the removal stays visible in
                  Activity.
                </CardDescription>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void handleCleanup()}
                    disabled={isOperating}
                  >
                    <Broom size={12} data-icon="inline-start" />
                    Run cleanup batch
                  </Button>
                </div>
                {cleanupResult && (
                  <div className="flex flex-wrap gap-2 border-t pt-3 text-xs">
                    <Badge variant="outline">
                      {cleanupResult.deletedSecrets} secrets deleted
                    </Badge>
                    <Badge variant="outline">
                      {cleanupResult.deletedEvents} events written
                    </Badge>
                    <Badge
                      variant={cleanupResult.isDone ? "default" : "outline"}
                    >
                      {cleanupResult.isDone
                        ? "Batch complete"
                        : "More rows remain"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {operationState && (
        <Card size="sm">
          <CardContent>
            <div
              className="flex items-center gap-2 text-muted-foreground"
              role="status"
              aria-live="polite"
            >
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
              Add a provider secret on the Connections page, then come back to
              try rotation or cleanup flows.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
