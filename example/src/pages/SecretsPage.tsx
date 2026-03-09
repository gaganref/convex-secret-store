import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format";
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
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Plus, Trash, Eye } from "@phosphor-icons/react";
import { type Environment } from "@/lib/navigation";
import { getErrorMessage } from "@/lib/utils";

type SecretRow = NonNullable<
  ReturnType<typeof useQuery<typeof api.example.listSecrets>>
>["page"][number];

export function SecretsPage({
  workspace,
  environment,
}: {
  workspace: string;
  environment: Environment;
}) {
  const result = useQuery(api.example.listSecrets, {
    workspace,
    environment,
    paginationOpts: { numItems: 50, cursor: null },
  });

  const putSecret = useMutation(api.example.putSecret);
  const removeSecret = useMutation(api.example.removeSecret);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rows = result?.page ?? [];
  const stats = useMemo(() => {
    const total = rows.length;
    const expired = rows.filter((r) => r.effectiveState === "expired").length;
    return { total, expired, active: total - expired };
  }, [rows]);

  const isSubmitting = submitState !== null;

  async function handleCreate(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const value = String(formData.get("value") ?? "");
    const ttlDaysRaw = String(formData.get("ttlDays") ?? "").trim();
    const ttlDays = ttlDaysRaw.length === 0 ? null : Number(ttlDaysRaw);

    if (!name) {
      setSubmitError("Name is required.");
      return;
    }
    if (ttlDays !== null && (!Number.isFinite(ttlDays) || ttlDays <= 0)) {
      setSubmitError("Expiry must be a positive number of days.");
      return;
    }

    setSubmitState("Saving");
    setSubmitError(null);
    try {
      await putSecret({
        workspace,
        environment,
        name,
        value,
        ttlMs: ttlDays === null ? null : ttlDays * 24 * 60 * 60 * 1000,
      });
      setCreateOpen(false);
    } catch (error) {
      setSubmitError(getErrorMessage(error, "Could not save the secret."));
    } finally {
      setSubmitState(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSubmitState("Removing");
    setSubmitError(null);
    try {
      await removeSecret({ workspace, environment, name: deleteTarget });
      setDeleteTarget(null);
    } catch (error) {
      setSubmitError(getErrorMessage(error, "Could not remove the secret."));
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
            Environment secrets
          </p>
          <h2 className="text-sm font-medium mt-1">
            {workspace} / {environment}
          </h2>
        </div>
        <Button
          size="xs"
          onClick={() => {
            setSubmitError(null);
            setCreateOpen(true);
          }}
        >
          <Plus size={12} data-icon="inline-start" />
          Add secret
        </Button>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{stats.total} secrets</Badge>
        <Badge variant={stats.expired > 0 ? "destructive" : "outline"}>
          {stats.expired > 0 ? `${stats.expired} expired` : "None expired"}
        </Badge>
        <Badge variant="outline">{environment}</Badge>
      </div>

      {/* Table */}
      {result === undefined ? (
        <div
          className="flex items-center justify-center py-12 text-muted-foreground gap-2"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <span className="text-xs">Loading secrets</span>
        </div>
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No secrets yet</EmptyTitle>
            <EmptyDescription>
              Add a secret to get started, or use Settings to seed demo data.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden border border-border bg-card">
          {/* Table header */}
          <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_80px_120px_120px_60px_auto] gap-3 border-b border-border px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Name</span>
            <span>Status</span>
            <span>Updated</span>
            <span>Expires</span>
            <span>Key</span>
            <span>Actions</span>
          </div>
          {rows.map((row) => (
            <SecretTableRow
              key={row.name}
              row={row}
              onDelete={() => {
                setSubmitError(null);
                setDeleteTarget(row.name);
              }}
              onPreview={() => setPreviewTarget(row.name)}
              disabled={isSubmitting}
            />
          ))}
        </div>
      )}

      {/* Create/Replace Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setCreateOpen(false);
            setSubmitError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add or replace secret</DialogTitle>
            <DialogDescription>
              The value is encrypted client-side and never shown again after
              save. Use the same name to replace an existing secret.
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
                <Label htmlFor="name">Name</Label>
                <Input
                  name="name"
                  id="name"
                  required
                  placeholder="e.g. DATABASE_URL"
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="value">Value</Label>
                <Textarea
                  name="value"
                  id="value"
                  rows={3}
                  required
                  placeholder="Paste the secret value"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ttlDays">
                  Expire after days{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  name="ttlDays"
                  id="ttlDays"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Leave blank for no expiry"
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
                Save secret
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
            <DialogTitle>
              Remove <span className="font-mono">{deleteTarget}</span>
            </DialogTitle>
            <DialogDescription>
              This deletes the encrypted secret and writes an audit event.
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
              {submitState ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <PreviewDialog
        workspace={workspace}
        environment={environment}
        name={previewTarget}
        onClose={() => setPreviewTarget(null)}
      />
    </div>
  );
}

function SecretTableRow({
  row,
  onDelete,
  onPreview,
  disabled,
}: {
  row: SecretRow;
  onDelete: () => void;
  onPreview: () => void;
  disabled: boolean;
}) {
  const isExpired = row.effectiveState === "expired";

  return (
    <div className="grid gap-2 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_80px_120px_120px_60px_auto] md:items-center">
      <p className="text-sm font-mono font-medium truncate">{row.name}</p>
      <div>
        <Badge variant={isExpired ? "destructive" : "default"} className="text-[10px]">
          {isExpired ? "Expired" : "Active"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatRelativeTime(row.updatedAt)}
      </p>
      <p className="text-xs text-muted-foreground">
        {row.expiresAt ? formatAbsoluteTime(row.expiresAt) : "Never"}
      </p>
      <p className="text-xs text-muted-foreground">v{row.keyVersion}</p>
      <div className="flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          onClick={onPreview}
          disabled={disabled}
          aria-label={`Preview ${row.name}`}
        >
          <Eye size={13} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 text-destructive"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Delete ${row.name}`}
        >
          <Trash size={13} />
        </Button>
      </div>
    </div>
  );
}

function PreviewDialog({
  workspace,
  environment,
  name,
  onClose,
}: {
  workspace: string;
  environment: Environment;
  name: string | null;
  onClose: () => void;
}) {
  const preview = useQuery(
    api.example.previewSecret,
    name === null
      ? "skip"
      : { workspace, environment, name },
  );

  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{name}</span>
          </DialogTitle>
          <DialogDescription>
            Server-side preview. The value was decrypted on the server and
            masked before reaching the browser.
          </DialogDescription>
        </DialogHeader>
        {preview === undefined ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Spinner />
            <span className="text-xs">Loading preview</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  preview.resolution === "active"
                    ? "default"
                    : preview.resolution === "expired"
                      ? "destructive"
                      : "outline"
                }
              >
                {preview.resolution}
              </Badge>
            </div>
            {preview.maskedValue && (
              <div className="border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Masked value
                </p>
                <p className="mt-1 font-mono text-sm break-all">
                  {preview.maskedValue}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {preview.serverNote}
            </p>
            {preview.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Updated {formatRelativeTime(preview.updatedAt)}
                {preview.expiresAt &&
                  ` \u00b7 Expires ${formatAbsoluteTime(preview.expiresAt)}`}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
