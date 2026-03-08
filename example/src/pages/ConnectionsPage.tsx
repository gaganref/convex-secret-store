import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import { formatAbsoluteTime, formatCountLabel, formatRelativeTime } from "@/lib/format";
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
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  PencilSimple,
  Trash,
  ArrowsClockwise,
} from "@phosphor-icons/react";

type Environment = "production" | "testing";
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

type ConnectionRow =
  NonNullable<ReturnType<typeof useQuery<typeof api.example.listConnections>>>["page"][number];

export function ConnectionsPage({ workspace }: { workspace: string }) {
  const [environment, setEnvironment] = useState<Environment>("production");
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

  const byName = useMemo(() => {
    const rows = new Map<string, ConnectionRow>();
    for (const row of connections?.page ?? []) {
      rows.set(row.name, row);
    }
    return rows;
  }, [connections]);

  const configuredCount = connections?.page.length ?? 0;
  const expiredCount =
    connections?.page.filter((row) => row.effectiveState === "expired").length ?? 0;

  async function handleCreate(formData: FormData) {
    if (composeProvider === null) return;
    const ttlDaysRaw = String(formData.get("ttlDays") ?? "").trim();
    const ttlDays = ttlDaysRaw.length === 0 ? null : Number(ttlDaysRaw);
    const ttlMs = ttlDays === null ? null : ttlDays * 24 * 60 * 60 * 1000;
    setSubmitState("Saving");
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
    setSubmitState(null);
    setComposeProvider(null);
  }

  async function handleEdit(formData: FormData) {
    if (editTarget === null) return;
    const expiresAtInput = String(formData.get("expiresAt") ?? "").trim();
    const expiresAt =
      expiresAtInput.length === 0 ? null : new Date(expiresAtInput).getTime();
    setSubmitState("Updating");
    await updateConnection({
      workspace,
      environment,
      provider: editTarget.name as Provider,
      label: String(formData.get("label") ?? "") || null,
      owner: String(formData.get("owner") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
      expiresAt,
    });
    setSubmitState(null);
    setEditTarget(null);
  }

  async function handleDelete() {
    if (deleteTarget === null) return;
    setSubmitState("Removing");
    await removeConnection({ workspace, environment, provider: deleteTarget });
    setSubmitState(null);
    setDeleteTarget(null);
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
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Environment:</span>
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
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Configured</p>
            <p className="text-lg font-medium tabular-nums mt-1">{configuredCount}</p>
            <p className="text-xs text-muted-foreground">{formatCountLabel(configuredCount, "provider")}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Expired</p>
            <p className="text-lg font-medium tabular-nums mt-1">{expiredCount}</p>
            <p className="text-xs text-muted-foreground">{expiredCount > 0 ? "Needs refresh" : "All clear"}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Env</p>
            <p className="text-lg font-medium mt-1">{environment === "production" ? "Prod" : "Test"}</p>
            <p className="text-xs text-muted-foreground">Active scope</p>
          </CardContent>
        </Card>
      </div>

      {/* Provider grid */}
      {connections === undefined ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Spinner />
          <span className="text-xs">Loading connections</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PROVIDERS.map((provider) => {
            const row = byName.get(provider.name);
            const isConfigured = row !== undefined;
            const isExpired = row?.effectiveState === "expired";
            return (
              <Card key={provider.name}>
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

                <CardContent>
                  <CardDescription>{provider.summary}</CardDescription>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Key ver</p>
                      <p className="text-xs mt-0.5">{row?.keyVersion ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Updated</p>
                      <p className="text-xs mt-0.5">{row ? formatRelativeTime(row.updatedAt) : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Expires</p>
                      <p className="text-xs mt-0.5">{row?.expiresAt ? formatAbsoluteTime(row.expiresAt) : "No expiry"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Owner</p>
                      <p className="text-xs mt-0.5">{row?.metadata?.owner ?? "Unassigned"}</p>
                    </div>
                  </div>
                  {(row?.metadata?.label || row?.metadata?.notes) && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {row?.metadata?.label && (
                        <p className="text-xs font-medium">{row.metadata.label}</p>
                      )}
                      {row?.metadata?.notes && (
                        <p className="text-xs text-muted-foreground">{row.metadata.notes}</p>
                      )}
                    </div>
                  )}
                </CardContent>

                <CardFooter className="gap-2">
                  <Button size="xs" onClick={() => setComposeProvider(provider.name)}>
                    <Plus size={12} data-icon="inline-start" />
                    {isConfigured ? "Replace" : "Add"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setEditTarget(row ?? null)}
                    disabled={!isConfigured}
                  >
                    <PencilSimple size={12} data-icon="inline-start" />
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() => setDeleteTarget(provider.name)}
                    disabled={!isConfigured}
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
        onOpenChange={(open) => !open && setComposeProvider(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {composeProvider
                ? `${byName.has(composeProvider) ? "Replace" : "Add"} ${composeProvider} secret`
                : ""}
            </DialogTitle>
            <DialogDescription>
              Secret values are never shown after save.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate(new FormData(e.currentTarget));
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="value">Secret value</Label>
              <Textarea name="value" id="value" rows={3} required placeholder="Paste the credential" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="label">Label</Label>
              <Input
                name="label"
                id="label"
                defaultValue={composeProvider ? byName.get(composeProvider)?.metadata?.label ?? "" : ""}
                placeholder="Primary production token"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner">Owner</Label>
              <Input
                name="owner"
                id="owner"
                defaultValue={composeProvider ? byName.get(composeProvider)?.metadata?.owner ?? "" : ""}
                placeholder="platform"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                name="notes"
                id="notes"
                rows={2}
                defaultValue={composeProvider ? byName.get(composeProvider)?.metadata?.notes ?? "" : ""}
                placeholder="Optional context"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ttlDays">Expire after days</Label>
              <Input name="ttlDays" id="ttlDays" type="number" min="1" step="1" placeholder="Leave blank for no expiry" />
            </div>
            <DialogFooter>
              {submitState && <span className="text-xs text-muted-foreground mr-auto">{submitState}...</span>}
              <Button type="submit">
                {byName.has(composeProvider ?? "") ? "Replace secret" : "Save secret"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? `Edit ${editTarget.name} details` : ""}
            </DialogTitle>
            <DialogDescription>
              Only metadata and expiry are changed. The encrypted value stays untouched.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleEdit(new FormData(e.currentTarget));
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-label">Label</Label>
              <Input name="label" id="edit-label" defaultValue={editTarget?.metadata?.label ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-owner">Owner</Label>
              <Input name="owner" id="edit-owner" defaultValue={editTarget?.metadata?.owner ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea name="notes" id="edit-notes" rows={3} defaultValue={editTarget?.metadata?.notes ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-expiresAt">Absolute expiry</Label>
              <Input
                name="expiresAt"
                id="edit-expiresAt"
                type="datetime-local"
                defaultValue={
                  editTarget?.expiresAt
                    ? new Date(editTarget.expiresAt).toISOString().slice(0, 16)
                    : ""
                }
              />
            </div>
            <DialogFooter>
              {submitState && <span className="text-xs text-muted-foreground mr-auto">{submitState}...</span>}
              <Button type="submit">Save details</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget}</DialogTitle>
            <DialogDescription>
              This permanently deletes the stored secret and records a deleted event.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {submitState ? "Removing..." : "Remove connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
