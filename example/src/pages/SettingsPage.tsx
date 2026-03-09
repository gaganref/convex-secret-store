import { useState } from "react";
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
import { ArrowsClockwise, Broom, Plant } from "@phosphor-icons/react";
import { type Environment } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/utils";

export function SettingsPage({
  workspace,
  environment,
}: {
  workspace: string;
  environment: Environment;
}) {
  const snapshot = useQuery(api.example.getSettingsSnapshot, {
    workspace,
    environment,
  });
  const runRotationBatch = useMutation(api.example.runRotationBatch);
  const runCleanup = useMutation(api.example.runCleanup);
  const seedDemoData = useMutation(api.example.seedDemoData);

  const [operationState, setOperationState] = useState<string | null>(null);
  const [rotationResult, setRotationResult] = useState<Awaited<
    ReturnType<typeof runRotationBatch>
  > | null>(null);
  const [cleanupResult, setCleanupResult] = useState<Awaited<
    ReturnType<typeof runCleanup>
  > | null>(null);
  const [seedResult, setSeedResult] = useState<number | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const legacyCount =
    snapshot?.versionCounts.find((e) => e.keyVersion === 1)?.count ?? 0;
  const isOperating = operationState !== null;

  async function handleRotate() {
    setOperationState("Rotating");
    setOperationError(null);
    try {
      const result = await runRotationBatch({
        fromVersion: 1,
        batchSize: 25,
        cursor: null,
      });
      setRotationResult(result);
    } catch (error) {
      setOperationError(getErrorMessage(error, "Rotation failed."));
    } finally {
      setOperationState(null);
    }
  }

  async function handleCleanup() {
    setOperationState("Cleaning up");
    setOperationError(null);
    try {
      const result = await runCleanup({
        batchSize: 50,
        retentionMs: 30 * 24 * 60 * 60 * 1000,
      });
      setCleanupResult(result);
    } catch (error) {
      setOperationError(getErrorMessage(error, "Cleanup failed."));
    } finally {
      setOperationState(null);
    }
  }

  async function handleSeed() {
    setOperationState("Seeding");
    setOperationError(null);
    setSeedResult(null);
    try {
      const result = await seedDemoData({ workspace, environment });
      setSeedResult(result.seeded);
    } catch (error) {
      setOperationError(getErrorMessage(error, "Seeding failed."));
    } finally {
      setOperationState(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest">
          Settings
        </p>
        <h2 className="text-sm font-medium mt-1">Store-wide maintenance</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Rotation and cleanup affect the mounted secret store across all
          workspaces and environments. Only demo seeding below is scoped to{" "}
          <span className="font-mono">
            {workspace} / {environment}
          </span>
          .
        </p>
      </div>

      {snapshot === undefined ? (
        <div
          className="flex items-center justify-center py-12 text-muted-foreground gap-2"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <span className="text-xs">Loading settings</span>
        </div>
      ) : (
        <>
          {/* Key versions */}
          <Card size="sm">
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Current scope
                </p>
                <CardTitle className="mt-0.5">Version summary</CardTitle>
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
                    v{version}{" "}
                    {version === snapshot.activeVersion ? "(active)" : ""} ·{" "}
                    {snapshot.versionCounts.find(
                      (e) => e.keyVersion === version,
                    )?.count ?? 0}{" "}
                    rows
                  </Badge>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  {formatCountLabel(snapshot.totalSecrets, "secret")} in this
                  scope
                </Badge>
                <Badge
                  variant={snapshot.expiredSecrets > 0 ? "destructive" : "outline"}
                >
                  {snapshot.expiredSecrets > 0
                    ? formatCountLabel(snapshot.expiredSecrets, "expired")
                    : "None expired"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Rotation */}
          <Card size="sm">
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Rotation
                </p>
                <CardTitle className="mt-0.5">Rewrap old key versions</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <CardDescription>
                Rewrap DEKs from v1 onto the active key for the entire mounted
                secret store. The secret plaintext is not rewritten.
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void handleRotate()}
                  disabled={isOperating || legacyCount === 0}
                >
                  <ArrowsClockwise size={12} data-icon="inline-start" />
                  Rotate v1 rows
                </Button>
                <span className="text-xs text-muted-foreground">
                  {legacyCount > 0
                    ? `${legacyCount} row${legacyCount !== 1 ? "s" : ""} on v1`
                    : "No v1 rows to rotate"}
                </span>
              </div>
              {rotationResult && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">
                    {rotationResult.processed} processed
                  </Badge>
                  <Badge variant="outline">
                    {rotationResult.rotated} rotated
                  </Badge>
                  <Badge variant="outline">
                    {rotationResult.skipped} skipped
                  </Badge>
                  <Badge variant={rotationResult.isDone ? "default" : "outline"}>
                    {rotationResult.isDone ? "Complete" : "More remain"}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cleanup */}
          <Card size="sm">
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Cleanup
                </p>
                <CardTitle className="mt-0.5">
                  Delete expired secrets and old events
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <CardDescription>
                Sweep expired secrets and old audit events across the entire
                mounted secret store in bounded batches.
              </CardDescription>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void handleCleanup()}
                disabled={isOperating}
              >
                <Broom size={12} data-icon="inline-start" />
                Run cleanup batch
              </Button>
              {cleanupResult && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">
                    {cleanupResult.deletedSecrets} secrets deleted
                  </Badge>
                  <Badge variant="outline">
                    {cleanupResult.deletedEvents} events deleted
                  </Badge>
                  <Badge variant={cleanupResult.isDone ? "default" : "outline"}>
                    {cleanupResult.isDone ? "Complete" : "More remain"}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Seed demo data */}
          <Card size="sm">
            <CardHeader>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Demo
                </p>
                <CardTitle className="mt-0.5">Seed demo data</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <CardDescription>
                Populate{" "}
                <span className="font-mono">
                  {workspace} / {environment}
                </span>{" "}
                with sample secrets (DATABASE_URL, OPENAI_API_KEY, etc.)
                including one legacy-version secret for rotation demos.
              </CardDescription>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  onClick={() => void handleSeed()}
                  disabled={isOperating}
                >
                  <Plant size={12} data-icon="inline-start" />
                  Seed demo data
                </Button>
                {seedResult !== null && (
                  <span className="text-xs text-muted-foreground">
                    {seedResult > 0
                      ? `${seedResult} secret${seedResult !== 1 ? "s" : ""} seeded`
                      : "All demo secrets already exist"}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {operationState && (
        <div
          className="flex items-center gap-2 text-muted-foreground px-1"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <span className="text-xs">{operationState}...</span>
        </div>
      )}

      {operationError && (
        <p className="text-xs text-destructive px-1" role="alert">
          {operationError}
        </p>
      )}
    </div>
  );
}
