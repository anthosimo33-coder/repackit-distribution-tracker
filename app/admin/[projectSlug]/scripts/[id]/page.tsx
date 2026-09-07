"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import {
  useProjectPath,
  useProjectSlug,
} from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { formatNumber } from "@/lib/format";
import {
  ArrowLeftIcon,
  PlusIcon,
  Trash2Icon,
  DownloadIcon,
  EyeIcon,
  Loader2Icon,
  SendIcon,
  BarChart3Icon,
  GraduationCapIcon,
  SearchIcon,
} from "lucide-react";
import {
  assembleScript,
  countCombinations,
  KIND_LABELS,
  SCRIPT_KINDS,
  usefulShortLabel,
  type ScriptKind,
} from "@/lib/scriptAssembly";
import {
  BRICK_MODE_OPTIONS,
  resolveBrickMode,
  brickModeDisplay,
  type BrickMode,
} from "@/lib/script-mode";
import {
  ScriptDestinationZones,
  ScriptInstructionList,
} from "@/components/scripts/ScriptDestinationZones";
import { GraduateHookDialog } from "@/components/admin/GraduateHookDialog";
import { HookAvailabilityBadge } from "@/components/admin/HookAvailabilityBadge";
import {
  hookAvailabilityFor,
  isHookAvailable,
  type HookAvailability,
} from "@/convex/hookAvailability";
import { COMBO_COOLDOWN_DAYS_FALLBACK } from "@/convex/comboCooldown";
import { campaignNameMatches, LAB_CAMPAIGN_NAME } from "@/convex/graduation";
import { AssignScriptCampaignDialog } from "@/components/admin/AssignScriptCampaignDialog";
import type { FunctionReturnType } from "convex/server";
import { useLabel } from "@/lib/use-label";

/**
 * BANC DE MONTAGE — l'écran d'une campagne de scripts.
 *
 * Le modèle n'a pas changé (une vidéo = 1 hook + 1 flux + 1 cta) ; la manière de
 * le manipuler, si. Trois sections empilées obligeaient à dépasser cinquante
 * hooks au doigt pour atteindre les quatre flux, et chaque correction de texte
 * passait par une modale à ouvrir puis refermer.
 *
 * Ici : on choisit un TYPE (onglets), on CHERCHE, on clique une ligne, on écrit
 * dans le volet de droite — la liste reste visible pendant l'édition, et
 * l'aperçu montre en permanence le bloc tel qu'il arrivera dans la fiche de la
 * créatrice, consigne comprise.
 */

type CampaignDetail = NonNullable<
  FunctionReturnType<typeof api.scripts.getCampaign>
>;
type Brick = CampaignDetail["bricks"][number];

/**
 * Pluriel d'affichage des types, pour les onglets et les compteurs. KIND_LABELS
 * reste la source du NOM d'un type (« Hook », « Flux », « Description ») ; ici
 * on ne fait que le mettre au pluriel — « 3 sur 5 hook » se lit mal, et « Flux »
 * est déjà invariable.
 */
const KIND_PLURAL: Record<ScriptKind, string> = {
  hook: "hooks",
  flux: "flux",
  cta: "descriptions",
};

/** Valeur du select « aucune créatrice » (Select n'accepte pas ""). */
const NO_CREATOR = "__none__";
/** Cible d'édition = une brique à CRÉER (le volet sert aussi de formulaire). */
const NEW_BRICK = "__new__";

/**
 * Clé de comparaison pour la recherche : minuscules, accents pliés. « PARDON »
 * doit se trouver en tapant « pardon », et « vérif » en tapant « verif » — un
 * champ de recherche qui exige les accents ne sert à rien sur des hooks écrits
 * en majuscules accentuées.
 */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function ScriptCampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as Id<"scriptCampaigns">;
  const projectPath = useProjectPath();
  const campaign = useProjectQuery(api.scripts.getCampaign, { id });
  const droits = usePermissions();

  const [importOpen, setImportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  // ─── Barre d'outils : type, recherche, filtres ─────────────────────────────
  const [kind, setKind] = useState<ScriptKind>("hook");
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [onlyWithInstruction, setOnlyWithInstruction] = useState(false);
  // « Disponible pour » — savoir en un regard quels hooks sont assignables à une
  // créatrice AUJOURD'HUI.
  const [availableFor, setAvailableFor] = useState<string>(NO_CREATOR);
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  // ─── Sélection ─────────────────────────────────────────────────────────────
  /** Brique éditée dans le volet droit (ou NEW_BRICK). null = la première. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Cases cochées — sélection MULTIPLE, indépendante de la brique éditée. */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [graduating, setGraduating] = useState<Id<"scriptBricks"> | null>(null);
  /** L'éditeur a des modifications non enregistrées (voir `pick`). */
  const [dirty, setDirty] = useState(false);
  /** Enregistrement publié par l'éditeur, appelé AVANT de changer de ligne :
   *  quitter une ligne modifiée ne doit jamais perdre la saisie. */
  const [saveDraft, setSaveDraft] = useState<(() => Promise<boolean>) | null>(
    null,
  );

  const creators = useProjectQuery(api.creators.listCreators, {});
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const hookUsages = useProjectQuery(
    api.scripts.hookUsagesForCampaign,
    availableFor === NO_CREATOR ? "skip" : { campaignId: id },
  );
  // Fenêtre de cooldown DU PROJET (réglage produit). Le badge « Cooldown → JJ/MM »
  // doit annoncer la durée que le tirage applique réellement ; la lire dans une
  // constante du client la ferait mentir dès le premier réglage.
  const cooldownSettings = useProjectQuery(
    api.projects.getComboCooldownSettings,
    {},
  );
  // PERF PAR BRIQUE, fenêtre « latest » : la médiane des vues et le nombre de
  // runs à l'endroit où se prend la décision d'activer ou de couper. Fenêtre la
  // plus couvrante (dernier relevé de CHAQUE post) — les fenêtres J+X
  // normalisées restent le domaine de l'onglet Analytics. Query GARDÉE : un
  // gestionnaire sans le bloc analytics garde l'écran, sans les chiffres.
  const perf = useProjectQuery(
    api.scriptAnalytics.perfByBrick,
    droits.skipUnless("content.analytics", {
      campaignId: id,
      window: "latest" as const,
    }),
  );
  const perfByBrick = useMemo(
    () => new Map((perf ?? []).map((p) => [p.brickId as string, p])),
    [perf],
  );
  // Date visée = MAINTENANT : la question posée est « assignable aujourd'hui ».
  const [now] = useState(() => Date.now());

  const bricks = useMemo(() => campaign?.bricks ?? [], [campaign]);

  // Plateformes réellement servies par cette créatrice : l'unicité à vie est
  // PAR PLATEFORME, l'évaluer sur les trois en dur inventerait des collisions.
  const creatorPlatforms = useMemo(
    () => [
      ...new Set(
        (comptes ?? [])
          .filter((c) => c.creatorId === availableFor)
          .map((c) => c.plateforme as string),
      ),
    ],
    [comptes, availableFor],
  );
  const availabilityOf = (brickId: string): HookAvailability | undefined => {
    if (availableFor === NO_CREATOR || hookUsages === undefined) return undefined;
    return hookAvailabilityFor({
      usages: hookUsages[brickId] ?? [],
      creatorId: availableFor,
      platforms: creatorPlatforms,
      targetAt: now,
      // Le repli sur le défaut ne dure que le temps du chargement de la query —
      // c'est la même valeur que le serveur appliquerait à un projet sans
      // réglage, donc le badge ne clignote jamais vers une durée inventée.
      cooldownMs:
        (cooldownSettings?.effective ?? COMBO_COOLDOWN_DAYS_FALLBACK) *
        86_400_000,
    });
  };

  const ofKind = bricks.filter((b) => b.kind === kind);
  const needle = fold(search.trim());
  const shown = ofKind.filter((b) => {
    if (onlyActive && !b.active) return false;
    if (onlyWithInstruction && !b.instruction) return false;
    if (needle && !fold(`${b.content} ${b.label}`).includes(needle)) return false;
    // La disponibilité n'a de sens que pour les HOOKS : l'unicité porte sur le
    // combo entier, pas sur un flux ou un cta isolé.
    if (onlyAvailable && kind === "hook" && availableFor !== NO_CREATOR) {
      const a = availabilityOf(b._id as string);
      if (a !== undefined && !isHookAvailable(a)) return false;
    }
    return true;
  });

  const editing: Brick | "new" | null =
    selectedId === NEW_BRICK
      ? "new"
      : (shown.find((b) => b._id === selectedId) ??
        ofKind.find((b) => b._id === selectedId) ??
        shown[0] ??
        null);

  /** Change de cible d'édition — en enregistrant d'abord si la saisie a bougé. */
  async function pick(next: string | null) {
    if (dirty && saveDraft) {
      const ok = await saveDraft();
      if (!ok) return; // saisie invalide : on ne quitte pas la ligne
    }
    setSelectedId(next);
  }

  async function switchKind(k: ScriptKind) {
    if (k === kind) return;
    if (dirty && saveDraft) {
      const ok = await saveDraft();
      if (!ok) return;
    }
    setKind(k);
    setSelectedId(null);
    setChecked(new Set());
  }

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

  const combos = countCombinations(bricks);
  const isLab = campaignNameMatches(campaign.name, LAB_CAMPAIGN_NAME);
  const activeCount = ofKind.filter((b) => b.active).length;
  const checkedIds = [...checked].filter((cid) =>
    ofKind.some((b) => b._id === cid),
  ) as Id<"scriptBricks">[];

  return (
    <div className="space-y-4">
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

      {/* ─── Barre d'outils ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
        <div
          className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
          role="tablist"
          aria-label="Type de brique"
        >
          {SCRIPT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === kind}
              onClick={() => switchKind(k)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                k === kind
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
              )}
            >
              {KIND_LABELS[k]}
              <span className="ml-1.5 tabular-nums text-xs text-slate-400">
                {bricks.filter((b) => b.kind === k).length}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-w-40 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Chercher dans le texte des ${KIND_PLURAL[kind]}…`}
            aria-label="Chercher une brique"
            className="h-8 pl-8"
          />
        </div>

        <FilterChip pressed={onlyActive} onClick={() => setOnlyActive((v) => !v)}>
          Actives seulement
        </FilterChip>
        <FilterChip
          pressed={onlyWithInstruction}
          onClick={() => setOnlyWithInstruction((v) => !v)}
        >
          💡 Avec consigne
        </FilterChip>

        <Select
          value={availableFor}
          onValueChange={(v) => v && setAvailableFor(v)}
        >
          <SelectTrigger
            id="dispo-pour"
            className="h-8 w-52"
            aria-label="Disponible pour"
          >
            <SelectValue>
              {availableFor === NO_CREATOR
                ? "Dispo pour…"
                : `Dispo pour ${
                    (creators ?? []).find((c) => c._id === availableFor)?.name ??
                    "?"
                  }`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CREATOR}>— aucune créatrice —</SelectItem>
            {(creators ?? []).map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {availableFor !== NO_CREATOR && (
          <FilterChip
            pressed={onlyAvailable}
            onClick={() => setOnlyAvailable((v) => !v)}
          >
            Masquer les indisponibles
          </FilterChip>
        )}
        {availableFor !== NO_CREATOR && creatorPlatforms.length === 0 && (
          <span className="text-xs text-amber-700">
            Cette créatrice n&apos;a aucun compte déclaré — aucune collision
            d&apos;unicité n&apos;est calculable.
          </span>
        )}
      </div>

      {/* ─── Les deux volets ───────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="space-y-2" aria-label="Briques de la campagne">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-slate-500" data-testid="brick-count">
              <span className="font-medium text-slate-700">{shown.length}</span>{" "}
              sur {ofKind.length} {KIND_PLURAL[kind]}
              {activeCount !== ofKind.length && (
                <span className="text-slate-400">
                  {" "}
                  · {activeCount} active{activeCount > 1 ? "s" : ""}
                </span>
              )}
            </p>
            <Button size="sm" variant="outline" onClick={() => pick(NEW_BRICK)}>
              <PlusIcon className="mr-2 size-4" />
              Ajouter
            </Button>
          </div>

          {checkedIds.length > 0 && (
            <BulkBar
              ids={checkedIds}
              onDone={() => setChecked(new Set())}
              kindLabel={KIND_PLURAL[kind]}
            />
          )}

          {shown.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-slate-400">
                {ofKind.length === 0
                  ? `Aucune brique « ${KIND_LABELS[kind].toLowerCase()} ».`
                  : "Aucune brique ne correspond aux filtres."}
              </CardContent>
            </Card>
          ) : (
            <div
              className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
              data-testid="brick-list"
            >
              {shown.map((b) => (
                <BrickRow
                  key={b._id}
                  brick={b}
                  selected={editing !== "new" && editing?._id === b._id}
                  checked={checked.has(b._id as string)}
                  onCheck={(on) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(b._id as string);
                      else next.delete(b._id as string);
                      return next;
                    })
                  }
                  onSelect={() => pick(b._id as string)}
                  perf={perfByBrick.get(b._id as string)}
                  availability={
                    b.kind === "hook" ? availabilityOf(b._id as string) : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section
          className="lg:sticky lg:top-4 lg:self-start"
          aria-label="Édition de la brique sélectionnée"
        >
          <BrickEditor
            key={editing === "new" ? `new:${kind}` : (editing?._id ?? "vide")}
            campaignId={campaign._id}
            kind={kind}
            brick={editing === "new" ? null : editing}
            creating={editing === "new"}
            bricks={bricks}
            isLab={isLab}
            onDirtyChange={setDirty}
            registerSave={(fn) => setSaveDraft(() => fn)}
            onCreated={(newId) => setSelectedId(newId as string)}
            onDeleted={() => setSelectedId(null)}
            onGraduate={(bid) => setGraduating(bid)}
          />
        </section>
      </div>

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
      <GraduateHookDialog
        brickId={graduating}
        open={graduating !== null}
        onOpenChange={(o) => !o && setGraduating(null)}
      />
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
        pressed
          ? "border-transparent bg-primary/10 text-primary"
          : "border-slate-200 bg-white text-slate-600 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

/* ─── Une ligne de la liste ─────────────────────────────────────────────────
 * La ligne n'est PAS un bouton : elle porte une case à cocher et un
 * interrupteur, qu'un bouton ne peut pas englober (HTML invalide, et le clic
 * sur l'interrupteur sélectionnerait la ligne). C'est le bloc de TEXTE qui est
 * le bouton de sélection — la surface qu'on vise naturellement.
 */
function BrickRow({
  brick,
  selected,
  checked,
  onCheck,
  onSelect,
  perf,
  availability,
}: {
  brick: Brick;
  selected: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onSelect: () => void;
  perf?: { viewsMedian: number | null; postCount: number };
  /** Disponibilité pour la créatrice sélectionnée ; absent = aucune sélection. */
  availability?: HookAvailability;
}) {
  const tLabel = useLabel();
  const update = useProjectMutation(api.scripts.updateBrick);
  const snytch = isSnytchProject(useProjectSlug());
  const showMode = snytch && (brick.kind === "hook" || brick.kind === "flux");
  const modeDisplay = brickModeDisplay(resolveBrickMode(brick.mode));

  async function setActive(active: boolean) {
    try {
      await update({ id: brick._id, active });
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  // content = le texte qui PART dans le script → principal. label n'est qu'un
  // « nom court » utile de façon occasionnelle (souvent un doublon du content ou
  // une ancienne version) → affiché en note SEULEMENT s'il apporte qqch.
  const note = usefulShortLabel(brick.label, brick.content);

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 transition-colors",
        selected
          ? "bg-primary/5 shadow-[inset_3px_0_0] shadow-primary"
          : "hover:bg-slate-50",
        !brick.active && "opacity-60",
      )}
      data-testid="brick-row"
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheck(v === true)}
        aria-label="Sélectionner la brique"
        className="mt-1"
      />
      <Switch
        checked={brick.active}
        onCheckedChange={setActive}
        aria-label="Activer la brique"
        className="mt-0.5"
      />
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 space-y-1 text-left"
      >
        <p className="line-clamp-2 text-sm font-medium text-slate-900">
          {brick.content}
        </p>
        {(brick.instruction || note || availability || !brick.active) && (
          <span className="flex flex-wrap items-center gap-1.5">
            {brick.instruction && (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                data-testid="brick-instruction-tag"
              >
                💡 consigne
              </Badge>
            )}
            {!brick.active && (
              <Badge variant="outline" className="text-[10px] text-slate-500">
                inactive
              </Badge>
            )}
            {availability && <HookAvailabilityBadge availability={availability} />}
            {note && (
              <span className="truncate text-xs italic text-slate-400">
                {note}
              </span>
            )}
          </span>
        )}
      </button>
      {showMode && (
        <span
          className="mt-0.5 shrink-0 text-base leading-none"
          title={tLabel(modeDisplay.labelKey)}
          aria-label={tLabel(modeDisplay.labelKey)}
          data-testid="brick-mode-indicator"
        >
          {modeDisplay.icon}
        </span>
      )}
      {/* PERF — médiane des vues et nombre de runs, là où se prend la décision
          d'activer ou de couper. Absente tant que la query n'a pas répondu, ou
          si le bloc analytics n'est pas accordé. */}
      {perf && (
        <div
          className="w-20 shrink-0 text-right tabular-nums"
          title="Médiane des vues, au dernier relevé de chaque post"
          data-testid="brick-perf"
        >
          {/* Aucun run : un « — » seul, sans « 0 run » sous chaque ligne — une
              colonne de zéros ne dit rien et alourdit la liste. */}
          <p className="text-sm font-semibold text-slate-900">
            {perf.postCount === 0 ? "—" : formatNumber(perf.viewsMedian)}
          </p>
          {perf.postCount > 0 && (
            <p className="text-[11px] text-slate-400">
              {perf.postCount} run{perf.postCount > 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Volet d'édition ─────────────────────────────────────────────────────── */

function BrickEditor({
  campaignId,
  kind,
  brick,
  creating,
  bricks,
  isLab,
  onDirtyChange,
  registerSave,
  onCreated,
  onDeleted,
  onGraduate,
}: {
  campaignId: Id<"scriptCampaigns">;
  kind: ScriptKind;
  brick: Brick | null;
  creating: boolean;
  bricks: Brick[];
  isLab: boolean;
  onDirtyChange: (d: boolean) => void;
  registerSave: (fn: () => Promise<boolean>) => void;
  onCreated: (id: Id<"scriptBricks">) => void;
  onDeleted: () => void;
  onGraduate: (id: Id<"scriptBricks">) => void;
}) {
  const tLabel = useLabel();
  const create = useProjectMutation(api.scripts.createBrick);
  const update = useProjectMutation(api.scripts.updateBrick);
  const remove = useProjectMutation(api.scripts.deleteBrick);
  const snytch = isSnytchProject(useProjectSlug());
  const showMode = snytch && (kind === "hook" || kind === "flux");

  const [label, setLabel] = useState(brick?.label ?? "");
  const [content, setContent] = useState(brick?.content ?? "");
  const [instruction, setInstruction] = useState(brick?.instruction ?? "");
  const [mode, setMode] = useState<BrickMode>(resolveBrickMode(brick?.mode));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  /** Marque la saisie comme modifiée en même temps qu'elle change. */
  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      if (!dirty) {
        setDirty(true);
        onDirtyChange(true);
      }
    };
  }

  async function save(): Promise<boolean> {
    if (label.trim().length === 0) {
      toast.error("Le nom court est requis.");
      return false;
    }
    setBusy(true);
    try {
      if (brick) {
        await update({
          id: brick._id,
          label,
          content,
          // Toujours envoyée : vider le champ EFFACE la consigne (le serveur
          // ramène une saisie blanche à l'absence).
          instruction,
          ...(showMode ? { mode } : {}),
        });
        toast.success("Brique mise à jour");
      } else {
        const newId = await create({
          campaignId,
          kind,
          label,
          content,
          ...(instruction.trim() ? { instruction } : {}),
          ...(showMode ? { mode } : {}),
        });
        toast.success("Brique ajoutée");
        onCreated(newId);
      }
      setDirty(false);
      onDirtyChange(false);
      return true;
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // L'écran appelle `save` avant de changer de ligne : une saisie en cours ne
  // doit pas disparaître parce qu'on a cliqué ailleurs. Publié une seule fois
  // par montage (le composant est remonté à chaque changement de cible, cf.
  // `key`), donc la fonction publiée ferme toujours sur l'état courant.
  const [registered, setRegistered] = useState(false);
  if (!registered) {
    setRegistered(true);
    registerSave(save);
  }

  async function onDelete() {
    if (!brick) return;
    setBusy(true);
    try {
      await remove({ id: brick._id });
      toast.success("Brique supprimée");
      onDeleted();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  if (!brick && !creating) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-400">
          Choisis une brique dans la liste, ou ajoutes-en une.
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (dirty) void save();
        }
      }}
    >
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {creating ? "Nouvelle brique" : "Modifier"} — {KIND_LABELS[kind]}
            </h2>
            {dirty && (
              <span className="text-xs text-amber-700" data-testid="brick-dirty">
                modifications non enregistrées
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brick-content">
              Texte{" "}
              <span className="font-normal text-slate-400">
                — part dans le script
              </span>
            </Label>
            <Textarea
              id="brick-content"
              value={content}
              onChange={(e) => touch(setContent)(e.target.value)}
              rows={6}
            />
          </div>

          {/* CONSIGNE — texte libre OPTIONNEL, lu par la créatrice sous ce bloc
              dans sa fiche. Ce n'est PAS du script : rien n'en part dans la
              vidéo ni dans la description. */}
          <div className="space-y-1.5">
            <Label htmlFor="brick-instruction">
              Instruction{" "}
              <span className="font-normal text-slate-400">
                — optionnelle, lue par la créatrice
              </span>
            </Label>
            <Textarea
              id="brick-instruction"
              value={instruction}
              onChange={(e) => touch(setInstruction)(e.target.value)}
              rows={2}
              placeholder="Ex. l'élément précis qui justifie la vérification."
              className="border-amber-200 bg-amber-50/40"
            />
            <p className="text-xs text-slate-400">
              Affichée sous ce bloc dans la fiche de la créatrice, jamais dans le
              texte à dire ni dans la description. Vider le champ la retire.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="brick-label">Nom court (interne)</Label>
              <Input
                id="brick-label"
                value={label}
                onChange={(e) => touch(setLabel)(e.target.value)}
                placeholder="Ex. Flux 2 — scan & clone"
              />
            </div>
            {/* SNYTCH — mode d'usage dans la vidéo (hook/flux) : dire / afficher
                / les deux. Ce que la créatrice verra étiqueté sur ce bloc. */}
            {showMode && (
              <div className="space-y-1.5">
                <Label htmlFor="brick-mode">Dans la vidéo</Label>
                <Select
                  value={mode}
                  onValueChange={(v) => v && touch(setMode)(v as BrickMode)}
                >
                  <SelectTrigger id="brick-mode" className="w-full">
                    {/* Sans enfants, le déclencheur rend la valeur brute
                        (« les_deux ») au lieu du libellé (« Les deux »). */}
                    <SelectValue>
                      {tLabel(
                        BRICK_MODE_OPTIONS.find((o) => o.value === mode)
                          ?.labelKey ?? "",
                      ) || mode}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {BRICK_MODE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {tLabel(o.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-slate-400">
              ⌘S enregistre — changer de ligne aussi.
            </span>
            <div className="flex items-center gap-2">
              {/* Graduer n'a de sens que pour un hook ENCORE actif du LAB : un
                  hook déjà désactivé a, en principe, déjà été gradué. */}
              {brick && isLab && brick.kind === "hook" && brick.active && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onGraduate(brick._id)}
                >
                  <GraduationCapIcon className="mr-2 size-3.5" />
                  Graduer
                </Button>
              )}
              {brick && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:text-rose-700"
                  onClick={onDelete}
                  disabled={busy}
                  aria-label="Supprimer"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
              <Button onClick={() => save()} disabled={busy || !dirty}>
                {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                {creating ? "Ajouter" : "Enregistrer"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <CreatorPreview
        kind={kind}
        bricks={bricks}
        draft={{ content, instruction, mode }}
      />
    </div>
  );
}

/* ─── Aperçu créatrice, permanent ───────────────────────────────────────────
 * Le volet montre le bloc en cours d'édition DANS son script : la saisie
 * courante, complétée par la première brique active de chaque autre type.
 * C'est la seule surface où l'on voit si la consigne se lit bien — l'aperçu de
 * la modale, lui, sert à inspecter un combo précis.
 */
function CreatorPreview({
  kind,
  bricks,
  draft,
}: {
  kind: ScriptKind;
  bricks: Brick[];
  draft: { content: string; instruction: string; mode: BrickMode };
}) {
  const snytch = isSnytchProject(useProjectSlug());

  /** Texte + consigne d'un slot : la SAISIE EN COURS pour le slot édité, la
   *  première brique active sinon. Taper met l'aperçu à jour, sans enregistrer. */
  function slot(k: ScriptKind): {
    content: string;
    instruction: string;
    mode: BrickMode;
  } | null {
    if (k === kind) {
      return {
        content: draft.content,
        instruction: draft.instruction,
        mode: draft.mode,
      };
    }
    const b = bricks.find((x) => x.kind === k && x.active);
    if (!b) return null;
    return {
      content: b.content,
      instruction: b.instruction ?? "",
      mode: resolveBrickMode(b.mode),
    };
  }

  const hook = slot("hook");
  const flux = slot("flux");
  const cta = slot("cta");
  if (
    !hook ||
    !flux ||
    !cta ||
    [hook, flux, cta].some((b) => b.content.trim().length === 0)
  ) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-xs text-slate-400">
          L&apos;aperçu s&apos;affiche dès qu&apos;une brique active de chaque
          type porte du texte.
        </CardContent>
      </Card>
    );
  }

  const instructions = (
    [
      ["hook", hook],
      ["flux", flux],
      ["cta", cta],
    ] as const
  ).flatMap(([s, b]) => {
    const text = b.instruction.trim();
    return text ? [{ slot: s, text }] : [];
  });

  return (
    <div className="space-y-2" data-testid="editor-preview">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Ce que verra la créatrice
        <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
          — {KIND_LABELS[kind].toLowerCase()}{" "}
          en cours d&apos;édition
        </span>
      </p>
      {snytch ? (
        <ScriptDestinationZones
          videoBlocks={[
            { text: hook.content.trim(), mode: hook.mode },
            { text: flux.content.trim(), mode: flux.mode },
          ]}
          descriptionScript={cta.content.trim()}
          instructions={instructions}
        />
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <SimpleMarkdown
              content={assembleScript({
                hook: hook.content,
                flux: flux.content,
                cta: cta.content,
              })}
            />
            <ScriptInstructionList items={instructions} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Actions en lot ──────────────────────────────────────────────────────── */

function BulkBar({
  ids,
  onDone,
  kindLabel,
}: {
  ids: Id<"scriptBricks">[];
  onDone: () => void;
  kindLabel: string;
}) {
  const setActive = useProjectMutation(api.scripts.setBricksActive);
  const setInstruction = useProjectMutation(api.scripts.setBricksInstruction);
  const removeMany = useProjectMutation(api.scripts.deleteBricks);
  const [busy, setBusy] = useState(false);
  const [instrOpen, setInstrOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [text, setText] = useState("");

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onDone();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
      data-testid="bulk-bar"
    >
      <span className="text-xs text-slate-700">
        <span className="font-semibold">{ids.length}</span> {kindLabel}{" "}
        sélectionné{ids.length > 1 ? "s" : ""}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(
              () => setActive({ ids, active: true }),
              `${ids.length} brique${ids.length > 1 ? "s activées" : " activée"}`,
            )
          }
        >
          Activer
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(
              () => setActive({ ids, active: false }),
              `${ids.length} brique${ids.length > 1 ? "s désactivées" : " désactivée"}`,
            )
          }
        >
          Désactiver
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setText("");
            setInstrOpen(true);
          }}
        >
          Consigne…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-rose-600 hover:text-rose-700"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2Icon className="mr-1.5 size-3.5" />
          Supprimer
        </Button>
      </div>

      <Dialog open={instrOpen} onOpenChange={setInstrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Consigne pour {ids.length} brique{ids.length > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              La MÊME consigne est posée sur toute la sélection, en remplaçant
              celle qui s&apos;y trouve. Laisser vide RETIRE la consigne.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            aria-label="Consigne"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstrOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                await run(
                  () => setInstruction({ ids, instruction: text }),
                  text.trim() ? "Consigne posée" : "Consigne retirée",
                );
                setInstrOpen(false);
              }}
            >
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Supprimer {ids.length} brique{ids.length > 1 ? "s" : ""} ?
            </DialogTitle>
            <DialogDescription>
              Irréversible. Les scripts DÉJÀ assignés ne bougent pas — leur texte
              est figé —, mais ces briques ne seront plus tirées.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                await run(
                  () => removeMany({ ids }),
                  `${ids.length} brique${ids.length > 1 ? "s supprimées" : " supprimée"}`,
                );
                setConfirmOpen(false);
              }}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Dialogues conservés ─────────────────────────────────────────────────── */

function ImportHooksDialog({
  open,
  onOpenChange,
  campaignId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignId: Id<"scriptCampaigns">;
}) {
  const hooks = useProjectQuery(api.hooks.listHooks, open ? {} : "skip");
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
            reste intacte).
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

  // Les CONSIGNES des trois briques choisies, dans l'ordre de montage — même
  // rendu que côté créatrice (encart ambre sous le bloc), pour que l'aperçu
  // continue de tenir sa promesse : « ce que verra la créatrice ».
  const previewInstructions = (
    [
      ["hook", hook],
      ["flux", flux],
      ["cta", cta],
    ] as const
  ).flatMap(([slot, b]) => {
    const text = b?.instruction?.trim();
    return text ? [{ slot, text }] : [];
  });

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
                instructions={previewInstructions}
              />
            ) : (
              <div className="space-y-3">
                <SimpleMarkdown content={assembled} />
                <ScriptInstructionList items={previewInstructions} />
              </div>
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
