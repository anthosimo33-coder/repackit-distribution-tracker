"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProjectPath, useProjectSlug } from "@/components/project/ProjectProvider";
import { isSnytchProject } from "@/lib/snytch-drive";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  PlusIcon,
  Trash2Icon,
  PencilIcon,
  DownloadIcon,
  EyeIcon,
  Loader2Icon,
  SendIcon,
  BarChart3Icon,
} from "lucide-react";
import {
  assembleScript,
  countCombinations,
  KIND_LABELS,
  SCRIPT_KINDS,
  usefulShortLabel,
  type ScriptKind,
  type ScriptTier,
} from "@/lib/scriptAssembly";
import { SCRIPT_TIERS, tierLabel } from "@/lib/script-tier";
import {
  BRICK_MODE_OPTIONS,
  resolveBrickMode,
  brickModeDisplay,
  type BrickMode,
} from "@/lib/script-mode";
import { ScriptDestinationZones } from "@/components/scripts/ScriptDestinationZones";
import { TierBadge } from "@/components/admin/TierBadge";
import { AssignScriptCampaignDialog } from "@/components/admin/AssignScriptCampaignDialog";
import type { FunctionReturnType } from "convex/server";

type CampaignDetail = NonNullable<
  FunctionReturnType<typeof api.scripts.getCampaign>
>;
type Brick = CampaignDetail["bricks"][number];

export default function ScriptCampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as Id<"scriptCampaigns">;
  const projectPath = useProjectPath();
  const campaign = useProjectQuery(api.scripts.getCampaign, { id });

  const [importOpen, setImportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  if (campaign === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (campaign === null) {
    return (
      <div className="space-y-4">
        <Link
          href={projectPath("/scripts")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-4" />
          Scripts
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Campagne introuvable.
          </CardContent>
        </Card>
      </div>
    );
  }

  const combos = countCombinations(campaign.bricks);

  return (
    <div className="space-y-6">
      <Link
        href={projectPath("/scripts")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        Scripts
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {campaign.name}
          </h1>
          <p className="text-sm text-slate-500" data-testid="combo-count">
            <span className="font-semibold text-slate-900">{combos.total}</span>{" "}
            combinaison{combos.total > 1 ? "s" : ""} possible
            {combos.total > 1 ? "s" : ""}
            <span className="text-slate-400">
              {" "}
              ({combos.byKind.hook} hooks × {combos.byKind.flux} flux ×{" "}
              {combos.byKind.cta} cta)
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={projectPath(`/scripts/${campaign._id}/analytics`)}
            className={buttonVariants({ variant: "outline" })}
          >
            <BarChart3Icon className="mr-2 size-4" />
            Analytics
          </Link>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <DownloadIcon className="mr-2 size-4" />
            Importer des hooks
          </Button>
          <Button
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            disabled={combos.total === 0}
          >
            <EyeIcon className="mr-2 size-4" />
            Aperçu d&apos;un script
          </Button>
          <Button
            onClick={() => setAssignOpen(true)}
            disabled={combos.total === 0 || campaign.status === "archived"}
          >
            <SendIcon className="mr-2 size-4" />
            Assigner cette campagne
          </Button>
        </div>
      </header>

      {SCRIPT_KINDS.map((kind) => (
        <BrickSection
          key={kind}
          kind={kind}
          campaignId={campaign._id}
          bricks={campaign.bricks.filter((b) => b.kind === kind)}
        />
      ))}

      <ImportHooksDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        campaignId={campaign._id}
      />
      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        campaign={campaign}
      />
      <AssignScriptCampaignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        campaignId={campaign._id}
        campaignName={campaign.name}
      />
    </div>
  );
}

function BrickSection({
  kind,
  campaignId,
  bricks,
}: {
  kind: ScriptKind;
  campaignId: Id<"scriptCampaigns">;
  bricks: Brick[];
}) {
  const [dialogBrick, setDialogBrick] = useState<Brick | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const activeCount = bricks.filter((b) => b.active).length;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {KIND_LABELS[kind]}{" "}
          <span className="text-slate-400">
            ({activeCount}/{bricks.length} active{activeCount > 1 ? "s" : ""})
          </span>
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="mr-2 size-4" />
          Ajouter
        </Button>
      </div>
      {bricks.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-slate-400">
            Aucune brique « {KIND_LABELS[kind].toLowerCase()} ».
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {bricks.map((b) => (
            <BrickRow key={b._id} brick={b} onEdit={() => setDialogBrick(b)} />
          ))}
        </div>
      )}

      <BrickDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        campaignId={campaignId}
        kind={kind}
        brick={null}
      />
      <BrickDialog
        open={dialogBrick !== null}
        onOpenChange={(o) => !o && setDialogBrick(null)}
        campaignId={campaignId}
        kind={kind}
        brick={dialogBrick}
      />
    </section>
  );
}

function BrickRow({ brick, onEdit }: { brick: Brick; onEdit: () => void }) {
  const update = useProjectMutation(api.scripts.updateBrick);
  const remove = useProjectMutation(api.scripts.deleteBrick);
  // Mode (zone vidéo) : Snytch + hook/flux uniquement. Indicateur en un coup
  // d'œil dans la ligne ; l'édition se fait dans la BrickDialog.
  const snytch = isSnytchProject(useProjectSlug());
  const showMode =
    snytch && (brick.kind === "hook" || brick.kind === "flux");
  const modeDisplay = brickModeDisplay(resolveBrickMode(brick.mode));

  async function setActive(active: boolean) {
    try {
      await update({ id: brick._id, active });
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }
  async function setTier(tier: ScriptTier | "none") {
    try {
      await update({ id: brick._id, tier: tier === "none" ? null : tier });
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }
  async function onDelete() {
    try {
      await remove({ id: brick._id });
      toast.success("Brique supprimée");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  // content = le texte qui PART dans le script → principal. label n'est qu'un
  // « nom court » utile de façon occasionnelle (souvent un doublon du content ou
  // une ancienne version) → affiché en note SEULEMENT s'il apporte qqch.
  const note = usefulShortLabel(brick.label, brick.content);

  return (
    <Card className={cn(!brick.active && "opacity-60")}>
      <CardContent className="flex items-start gap-3 p-3">
        <Switch
          checked={brick.active}
          onCheckedChange={setActive}
          aria-label="Activer la brique"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="line-clamp-3 text-sm font-medium text-slate-900">
            {brick.content}
          </p>
          {note && (
            <p className="truncate text-xs italic text-slate-400">
              note : {note}
            </p>
          )}
        </div>
        {brick.kind === "hook" && (
          <Select
            value={brick.tier ?? "none"}
            onValueChange={(v) => v && setTier(v as ScriptTier | "none")}
          >
            <SelectTrigger className="h-8 w-28" aria-label="Tier du hook">
              <SelectValue>
                {brick.tier ? <TierBadge tier={brick.tier} /> : "Tier"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {SCRIPT_TIERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {tierLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {showMode && (
          <span
            className="mt-0.5 shrink-0 text-base leading-none"
            title={modeDisplay.label}
            aria-label={modeDisplay.label}
            data-testid="brick-mode-indicator"
          >
            {modeDisplay.icon}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0"
          onClick={onEdit}
          aria-label="Modifier"
        >
          <PencilIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0 text-rose-600 hover:text-rose-700"
          onClick={onDelete}
          aria-label="Supprimer"
        >
          <Trash2Icon className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function BrickDialog({
  open,
  onOpenChange,
  campaignId,
  kind,
  brick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignId: Id<"scriptCampaigns">;
  kind: ScriptKind;
  brick: Brick | null;
}) {
  const create = useProjectMutation(api.scripts.createBrick);
  const update = useProjectMutation(api.scripts.updateBrick);
  const isEdit = brick !== null;
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [tier, setTier] = useState<ScriptTier | "none">("none");
  const [mode, setMode] = useState<BrickMode>("les_deux");
  const [busy, setBusy] = useState(false);
  // Mode (zone vidéo) : Snytch + hook/flux uniquement.
  const snytch = isSnytchProject(useProjectSlug());
  const showMode = snytch && (kind === "hook" || kind === "flux");

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setLabel(brick?.label ?? "");
      setContent(brick?.content ?? "");
      setTier(brick?.tier ?? "none");
      setMode(resolveBrickMode(brick?.mode));
    }
  }

  async function onSubmit() {
    if (label.trim().length === 0) {
      toast.error("Le label est requis.");
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await update({
          id: brick._id,
          label,
          content,
          ...(kind === "hook"
            ? { tier: tier === "none" ? null : tier }
            : {}),
          ...(showMode ? { mode } : {}),
        });
        toast.success("Brique mise à jour");
      } else {
        await create({
          campaignId,
          kind,
          label,
          content,
          ...(kind === "hook" && tier !== "none" ? { tier } : {}),
          ...(showMode ? { mode } : {}),
        });
        toast.success("Brique ajoutée");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier" : "Ajouter"} — {KIND_LABELS[kind]}
          </DialogTitle>
          <DialogDescription>
            {kind === "hook"
              ? "Un hook accroche la vidéo. Classe sa puissance par tier."
              : "Le texte de la brique (markdown)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brick-label">Label (nom court)</Label>
            <Input
              id="brick-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex. Flux 2 — scan & clone"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brick-content">Contenu (markdown)</Label>
            <Textarea
              id="brick-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
            />
          </div>
          {kind === "hook" && (
            <div className="space-y-1.5">
              <Label htmlFor="brick-tier">Tier</Label>
              <Select
                value={tier}
                onValueChange={(v) => v && setTier(v as ScriptTier | "none")}
              >
                <SelectTrigger id="brick-tier" className="w-32">
                  <SelectValue>
                    {tier === "none" ? "—" : tierLabel(tier)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {SCRIPT_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tierLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* SNYTCH — mode d'usage dans la vidéo (hook/flux) : dire / afficher /
              les deux. Ce que la créatrice verra étiqueté sur ce bloc. */}
          {showMode && (
            <div className="space-y-1.5">
              <Label htmlFor="brick-mode">Dans la vidéo</Label>
              <Select
                value={mode}
                onValueChange={(v) => v && setMode(v as BrickMode)}
              >
                <SelectTrigger id="brick-mode" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRICK_MODE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Annuler
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {isEdit ? "Enregistrer" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportHooksDialog({
  open,
  onOpenChange,
  campaignId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignId: Id<"scriptCampaigns">;
}) {
  const hooks = useProjectQuery(
    api.hooks.listHooks,
    open ? {} : "skip",
  );
  const importHooks = useProjectMutation(api.scripts.importHooks);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onImport() {
    if (selected.size === 0) {
      toast.error("Sélectionne au moins un hook.");
      return;
    }
    setBusy(true);
    try {
      const r = await importHooks({
        campaignId,
        hookIds: [...selected] as Id<"hooks">[],
      });
      toast.success(
        `${r.imported} hook${r.imported > 1 ? "s" : ""} importé${r.imported > 1 ? "s" : ""}.`,
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Importer des hooks</DialogTitle>
          <DialogDescription>
            Les hooks sélectionnés sont COPIÉS comme briques (la bibliothèque
            reste intacte). Classe-les ensuite par tier.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {hooks === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : hooks.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              La bibliothèque de hooks est vide.
            </p>
          ) : (
            hooks.map((h) => (
              <button
                key={h._id}
                type="button"
                onClick={() => toggle(h._id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors",
                  selected.has(h._id)
                    ? "border-primary bg-primary/5"
                    : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                    selected.has(h._id)
                      ? "border-primary bg-primary text-white"
                      : "border-slate-300",
                  )}
                >
                  {selected.has(h._id) && "✓"}
                </span>
                <span className="min-w-0 flex-1">{h.text}</span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Annuler
          </Button>
          <Button onClick={onImport} disabled={busy || selected.size === 0}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Importer ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({
  open,
  onOpenChange,
  campaign,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: CampaignDetail;
}) {
  // Choix d'une brique active par kind (défaut : la première active).
  const activeByKind = (kind: ScriptKind) =>
    campaign.bricks.filter((b) => b.kind === kind && b.active);

  const [picks, setPicks] = useState<Record<ScriptKind, string | null>>({
    hook: null,
    flux: null,
    cta: null,
  });

  // SNYTCH — l'aperçu montre les DEUX zones de destination (ce que verra la
  // créatrice) ; hors Snytch, rendu classique (script enchaîné, titres visibles).
  const snytch = isSnytchProject(useProjectSlug());

  function resolve(kind: ScriptKind): Brick | null {
    const actives = activeByKind(kind);
    if (actives.length === 0) return null;
    const picked = picks[kind]
      ? actives.find((b) => b._id === picks[kind])
      : null;
    return picked ?? actives[0];
  }

  const hook = resolve("hook");
  const flux = resolve("flux");
  const cta = resolve("cta");
  const ready = hook && flux && cta;

  const assembled = ready
    ? assembleScript({
        hook: hook.content,
        flux: flux.content,
        cta: cta.content,
      })
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aperçu d&apos;un script monté</DialogTitle>
          <DialogDescription>
            {snytch
              ? "Ce que verra la créatrice : 🎬 hook + flux vont dans la vidéo, 📝 la description va sous la publication."
              : "Le rendu final d'une vidéo (ce que verra le créateur), sans les briques séparées."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SCRIPT_KINDS.map((kind) => {
            const actives = activeByKind(kind);
            const cur = resolve(kind);
            return (
              <div key={kind} className="min-w-0 space-y-1">
                <Label className="block truncate text-xs text-slate-500">
                  {KIND_LABELS[kind]}
                </Label>
                <Select
                  value={cur?._id ?? ""}
                  onValueChange={(v) =>
                    v && setPicks((p) => ({ ...p, [kind]: v }))
                  }
                >
                  <SelectTrigger className="h-8 w-full min-w-0 text-xs">
                    <SelectValue>
                      <span className="block truncate">
                        {cur?.label ?? "—"}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {actives.map((b) => (
                      <SelectItem key={b._id} value={b._id}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>

        <div
          className="max-h-[45vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4"
          data-testid="preview-output"
        >
          {ready ? (
            snytch ? (
              <ScriptDestinationZones
                videoBlocks={[
                  {
                    text: hook.content.trim(),
                    mode: resolveBrickMode(hook.mode),
                  },
                  {
                    text: flux.content.trim(),
                    mode: resolveBrickMode(flux.mode),
                  },
                ]}
                descriptionScript={cta.content.trim()}
              />
            ) : (
              <SimpleMarkdown content={assembled} />
            )
          ) : (
            <p className="text-sm text-slate-500">
              Active au moins une brique de chaque type pour prévisualiser.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
