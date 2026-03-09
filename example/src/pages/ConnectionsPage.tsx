import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import {
  formatAbsoluteTime,
  formatCountLabel,
  formatRelativeTime,
} from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardAction,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { type Environment } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/utils";
import { SecurityExplainer } from "@/components/security-explainer";

type Provider =
  | "openai"
  | "anthropic"
  | "resend"
  | "stripe"
  | "slack"
  | "github";

const PROVIDERS: Array<{
  name: Provider;
  label: string;
  category: string;
  summary: string;
}> = [
  {
    name: "openai",
    label: "OpenAI",
    category: "AI",
    summary: "Reasoning and generation workloads.",
  },
  {
    name: "anthropic",
    label: "Anthropic",
    category: "AI",
    summary: "Fallback and policy-sensitive model access.",
  },
  {
    name: "resend",
    label: "Resend",
    category: "Messaging",
    summary: "Transactional email delivery credentials.",
  },
  {
    name: "stripe",
    label: "Stripe",
    category: "Billing",
    summary: "Payments and subscription webhooks.",
  },
  {
    name: "slack",
    label: "Slack",
    category: "Ops",
    summary: "Incident notifications and automation.",
  },
  {
    name: "github",
    label: "GitHub",
    category: "Platform",
    summary: "App installations and workflow integrations.",
  },
];

type ConnectionRow = NonNullable<
  ReturnType<typeof useQuery<typeof api.example.listConnections>>
>["page"][number];

export function ConnectionsPage({
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
  const upsertConnection = useMutation(api.example.upsertConnection);
  const updateConnection = useMutation(api.example.updateConnection);
  const removeConnection = useMutation(api.example.removeConnection);

  const [composeProvider, setComposeProvider] = useState<Provider | null>(null);
  const [editTarget, setEditTarget] = useState<ConnectionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [submitState, setSubmitState] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const byName = useMemo(() => {
    const rows = new Map<string, ConnectionRow>();
    for (const row of connections?.page ?? []) {
      rows.set(row.name, row);
    }
    return rows;
  }, [connections]);

  const configuredCount = connections?.page.length ?? 0;
  const expiredCount =
    connections?.page.filter((row) => row.effectiveState === "expired")
      .length ?? 0;
  const isSubmitting = submitState !== null;
  const missingCount = PROVIDERS.length - configuredCount;

  async function handleCreate(formData: FormData) {
    if (composeProvider === null) return;
    const ttlDaysRaw = String(formData.get("ttlDays") ?? "").trim();
    const ttlDays = ttlDaysRaw.length === 0 ? null : Number(ttlDaysRaw);
    if (ttlDays !== null && (!Number.isFinite(ttlDays) || ttlDays <= 0)) {
      setSubmitError("Expiry must be a positive number of days.");
      return;
    }
    const ttlMs = ttlDays === null ? null : ttlDays * 24 * 60 * 60 * 1000;
    setSubmitState("Saving");
    setSubmitError(null);
    try {
      await upsertConnection({
        workspace,
        environment,
        provider: composeProvider,
        value: String(formData.get("value") ?? ""),
        label: String(formData.get("label") ?? "") || undefined,
        owner: String(formData.get("owner") ?? "") || undefined,
        notes: String(formData.get("notes") ?? "") || undefined,
        ttlMs,
      });
      setComposeProvider(null);
    } catch (error) {
      setSubmitError(getErrorMessage(error, "Could not save the connection."));
    } finally {
      setSubmitState(null);
    }
  }

  async function handleEdit(formData: FormData) {
    if (editTarget === null) return;
    const expiresAtInput = String(formData.get("expiresAt") ?? "").trim();
    const expiresAt =
      expiresAtInput.length === 0 ? null : new Date(expiresAtInput).getTime();
    if (expiresAt !== null && Number.isNaN(expiresAt)) {
      setSubmitError("Expiry must be a valid date and time.");
      return;
    }
    setSubmitState("Updating");
    setSubmitError(null);
    try {
      await updateConnection({
        workspace,
        environment,
        provider: editTarget.name as Provider,
        label: String(formData.get("label") ?? "") || null,
        owner: String(formData.get("owner") ?? "") || null,
        notes: String(formData.get("notes") ?? "") || null,
        expiresAt,
      });
      setEditTarget(null);
    } catch (error) {
      setSubmitError(
        getErrorMessage(error, "Could not update the connection."),
      );
    } finally {
      setSubmitState(null);
    }
  }

  async function handleDelete() {
    if (deleteTarget === null) return;
    setSubmitState("Removing");
    setSubmitError(null);
    try {
      await removeConnection({
        workspace,
        environment,
        provider: deleteTarget,
      });
      setDeleteTarget(null);
    } catch (error) {
      setSubmitError(
        getErrorMessage(error, "Could not remove the connection."),
      );
    } finally {
      setSubmitState(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            Connections
          </p>
          <h2 className="text-sm font-medium mt-1">
            Provider credentials for {workspace}
          </h2>
          <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
            Start with the provider secret only. Owner, notes, and expiry are
            optional, and those fields stay plaintext so they should remain low
            sensitivity.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">
          {formatCountLabel(configuredCount, "configured provider")}
        </Badge>
        <Badge variant={expiredCount > 0 ? "destructive" : "outline"}>
          {expiredCount > 0
            ? formatCountLabel(expiredCount, "expired provider")
            : "No expired providers"}
        </Badge>
        <Badge variant="outline">
          {formatCountLabel(missingCount, "missing provider")}
        </Badge>
        <Badge variant="outline">
          {environment === "production" ? "Production scope" : "Testing scope"}
        </Badge>
      </div>

      <SecurityExplainer mode="storage" />

      {/* Provider grid */}
      {connections === undefined ? (
        <div
          className="flex items-center justify-center py-12 text-muted-foreground gap-2"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <span className="text-xs">Loading connections</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const row = byName.get(provider.name);
            const isConfigured = row !== undefined;
            const isExpired = row?.effectiveState === "expired";
            return (
              <Card key={provider.name} className="gap-0">
                <CardHeader>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                      {provider.category}
                    </p>
                    <CardTitle className="mt-0.5">{provider.label}</CardTitle>
                  </div>
                  <CardAction>
                    <Badge
                      variant={
                        !isConfigured
                          ? "outline"
                          : isExpired
                            ? "destructive"
                            : "default"
                      }
                    >
                      {!isConfigured
                        ? "Missing"
                        : isExpired
                          ? "Expired"
                          : "Active"}
                    </Badge>
                  </CardAction>
                </CardHeader>

                <CardContent className="space-y-3">
                  <CardDescription>{provider.summary}</CardDescription>
                  {isConfigured ? (
                    <>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                            Updated
                          </p>
                          <p className="mt-0.5 text-xs">
                            {formatRelativeTime(row.updatedAt)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                            Owner
                          </p>
                          <p className="mt-0.5 text-xs">
                            {row.metadata?.owner ?? "Unassigned"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                            Expires
                          </p>
                          <p className="mt-0.5 text-xs">
                            {row.expiresAt
                              ? formatAbsoluteTime(row.expiresAt)
                              : "No expiry"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                            Key ver
                          </p>
                          <p className="mt-0.5 text-xs">v{row.keyVersion}</p>
                        </div>
                      </div>
                      {(row.metadata?.label || row.metadata?.notes) && (
                        <div className="border-t pt-3 space-y-1">
                          {row.metadata?.label && (
                            <p className="text-xs font-medium">
                              {row.metadata.label}
                            </p>
                          )}
                          {row.metadata?.notes && (
                            <p className="text-xs text-muted-foreground">
                              {row.metadata.notes}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="border-t pt-3">
                      <p className="text-xs text-muted-foreground">
                        No secret stored for this provider in the current
                        workspace and environment.
                      </p>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="gap-2 border-t/80">
                  <Button
                    size="xs"
                    onClick={() => {
                      setSubmitError(null);
                      setComposeProvider(provider.name);
                    }}
                    disabled={isSubmitting}
                  >
                    <Plus size={12} data-icon="inline-start" />
                    {isConfigured ? "Replace secret" : "Add secret"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setSubmitError(null);
                      setEditTarget(row ?? null);
                    }}
                    disabled={isSubmitting || !isConfigured}
                  >
                    <PencilSimple size={12} data-icon="inline-start" />
                    Details
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() => {
                      setSubmitError(null);
                      setDeleteTarget(provider.name);
                    }}
                    disabled={isSubmitting || !isConfigured}
                  >
                    <Trash size={12} data-icon="inline-start" />
                    Remove
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Replace Dialog */}
      <Dialog
        open={composeProvider !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setComposeProvider(null);
            setSubmitError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {composeProvider
                ? `${byName.has(composeProvider) ? "Replace" : "Add"} ${composeProvider} secret`
                : ""}
            </DialogTitle>
            <DialogDescription>
              Secret values are encrypted and never shown again after save.
              Advanced details remain plaintext metadata.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate(new FormData(e.currentTarget));
            }}
          >
            <fieldset disabled={isSubmitting} className="contents">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="value">Secret value</Label>
                <Textarea
                  name="value"
                  id="value"
                  rows={3}
                  required
                  placeholder="Paste the credential"
                />
              </div>
              <details className="border border-border bg-muted/20 p-3">
                <summary className="cursor-pointer text-xs font-medium">
                  Advanced details (plaintext metadata)
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="label">Label</Label>
                    <Input
                      name="label"
                      id="label"
                      defaultValue={
                        composeProvider
                          ? (byName.get(composeProvider)?.metadata?.label ?? "")
                          : ""
                      }
                      placeholder="Primary production token"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="owner">Owner</Label>
                    <Input
                      name="owner"
                      id="owner"
                      defaultValue={
                        composeProvider
                          ? (byName.get(composeProvider)?.metadata?.owner ?? "")
                          : ""
                      }
                      placeholder="platform"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      name="notes"
                      id="notes"
                      rows={2}
                      defaultValue={
                        composeProvider
                          ? (byName.get(composeProvider)?.metadata?.notes ?? "")
                          : ""
                      }
                      placeholder="Optional plaintext context"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ttlDays">Expire after days</Label>
                    <Input
                      name="ttlDays"
                      id="ttlDays"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Leave blank for no expiry"
                    />
                  </div>
                </div>
              </details>
            </fieldset>
            <DialogFooter>
              <div className="mr-auto flex flex-col gap-1">
                {submitState && (
                  <span
                    className="text-xs text-muted-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {submitState}...
                  </span>
                )}
                {submitError && (
                  <span className="text-xs text-destructive" role="alert">
                    {submitError}
                  </span>
                )}
              </div>
              <Button type="submit" disabled={isSubmitting}>
                {byName.has(composeProvider ?? "")
                  ? "Replace secret"
                  : "Save secret"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setEditTarget(null);
            setSubmitError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? `Edit ${editTarget.name} details` : ""}
            </DialogTitle>
            <DialogDescription>
              This only changes plaintext metadata and expiry. The encrypted
              secret value stays untouched.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleEdit(new FormData(e.currentTarget));
            }}
          >
            <fieldset disabled={isSubmitting} className="contents">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-label">Label</Label>
                <Input
                  name="label"
                  id="edit-label"
                  defaultValue={editTarget?.metadata?.label ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-owner">Owner</Label>
                <Input
                  name="owner"
                  id="edit-owner"
                  defaultValue={editTarget?.metadata?.owner ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  name="notes"
                  id="edit-notes"
                  rows={3}
                  defaultValue={editTarget?.metadata?.notes ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-expiresAt">Absolute expiry</Label>
                <Input
                  name="expiresAt"
                  id="edit-expiresAt"
                  type="datetime-local"
                  defaultValue={
                    editTarget?.expiresAt
                      ? new Date(editTarget.expiresAt)
                          .toISOString()
                          .slice(0, 16)
                      : ""
                  }
                />
              </div>
            </fieldset>
            <DialogFooter>
              <div className="mr-auto flex flex-col gap-1">
                {submitState && (
                  <span
                    className="text-xs text-muted-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {submitState}...
                  </span>
                )}
                {submitError && (
                  <span className="text-xs text-destructive" role="alert">
                    {submitError}
                  </span>
                )}
              </div>
              <Button type="submit" disabled={isSubmitting}>
                Save details
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setDeleteTarget(null);
            setSubmitError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget}</DialogTitle>
            <DialogDescription>
              This removes the stored secret for this scope and writes a
              matching deleted audit event.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <div className="mr-auto">
              {submitError && (
                <span className="text-xs text-destructive" role="alert">
                  {submitError}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={isSubmitting}
            >
              {submitState ? "Removing..." : "Remove connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
