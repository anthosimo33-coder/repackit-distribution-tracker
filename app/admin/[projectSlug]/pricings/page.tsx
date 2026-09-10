"use client";

import { useMemo, useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { PricingCreatorsDialog } from "@/components/pricing/PricingCreatorsDialog";
import { usePermissions } from "@/components/project/use-permissions";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { formatMoney } from "@/lib/format-rate";
import { formatDate } from "@/lib/format";
import { currencySymbol } from "@/lib/currency";
import {
  compareLadders,
  fixedPerVideo,
  formatSeuil,
  ladderSummary,
  pricingKind,
  sortedTiers,
  PRICING_KIND_LABEL,
  type PricingKind,
} from "@/lib/pricing-shape";
import {
  estimateMissionEarnings,
  evaluateBonusTiers,
  tiersOf,
  type BonusTier,
} from "@/lib/pricing-engine";
import { PayCurrencyWarning } from "@/components/PayCurrencyWarning";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { PermissionGate } from "@/components/project/PermissionGate";

type Pricing = FunctionReturnType<typeof api.pricing.listPricings>[number];
type Template = FunctionReturnType<
  typeof api.pricing.listBonusTemplates
>[number];

type TierForm = {
  seuilVues: string;
  rewardType: "cash" | "nature";
  montant: string;
  libelle: string;
  /** NATURE — ce que l'objet nous coûte réellement (jamais son prix public). */
  coutReel: string;
};

const EMPTY = {
  name: "",
  montantFixe: "",
  nbVideosCible: "",
  tauxCPM: "",
  seuilVuesFixe: "",
};

function emptyTier(): TierForm {
  return {
    seuilVues: "",
    rewardType: "cash",
    montant: "",
    libelle: "",
    coutReel: "",
  };
}

function tiersToForm(tiers: BonusTier[]): TierForm[] {
  return sortedTiers(tiers).map((t) => ({
    seuilVues: String(t.seuilVues),
    rewardType: t.rewardType,
    montant: t.montant != null ? String(t.montant) : "",
    libelle: t.libelle ?? "",
    coutReel: t.coutReel != null ? String(t.coutReel) : "",
  }));
}

/**
 * Paliers saisis → paliers du domaine. `coutReel` vide reste ABSENT, jamais 0 :
 * « pas encore chiffré » n'est pas « gratuit », et un 0 entrerait tel quel dans
 * le coût complet du moteur.
 */
function formToTiers(tiers: TierForm[]): BonusTier[] {
  return tiers.map((t) => ({
    seuilVues: Number(t.seuilVues),
    rewardType: t.rewardType,
    montant: t.rewardType === "cash" ? Number(t.montant) : undefined,
    libelle: t.rewardType === "nature" ? t.libelle.trim() : undefined,
    coutReel:
      t.rewardType === "nature" && t.coutReel.trim() !== ""
        ? Number(t.coutReel)
        : undefined,
  }));
}

const KIND_CLASS: Record<PricingKind, string> = {
  cpm: "bg-blue-50 text-blue-700",
  fixe: "bg-emerald-50 text-emerald-700",
  mixte: "bg-violet-50 text-violet-700",
  aucun: "bg-slate-100 text-slate-600",
};

/**
 * Admin — barèmes de paie (pricings) du projet, et bibliothèque de MODÈLES
 * d'échelle de bonus.
 *
 * L'écran rendait ses barèmes en prose (« Fixe 0,00 $ pour 60 vidéos · CPM
 * 1,00 $/1000 vues · 1 000 000 → 200,00 $ · … ») : rien n'était aligné, donc
 * rien ne se comparait. Il aligne désormais les termes en colonnes, dit la
 * NATURE d'un barème là où il affichait un « 0,00 $ » trompeur, et signale
 * qu'une échelle de bonus a divergé de son modèle.
 *
 * Deux règles de fond, rappelées partout où elles mordent :
 *   - Fixe et CPM sont FIGÉS à l'attribution (pricingSnapshot) → les modifier
 *     n'affecte que les futures attributions ;
 *   - les PALIERS sont lus EN DIRECT → les modifier change la grille de toutes
 *     les créatrices qui en dépendent, tout de suite.
 */
function PricingsPageContenu() {
  // Devise de la PAIE créatrices (dollars) — montants ET symboles des libellés
  // (fixe, CPM, cash) dérivés de projects.payCurrency, jamais codés en dur.
  const payCurrency = useProject().project.payCurrency;
  const money = useMemo(
    () => (n: number) => formatMoney(n, payCurrency),
    [payCurrency],
  );

  const pricings = useProjectQuery(api.pricing.listPricings, {
    includeArchived: true,
  });
  const templates = useProjectQuery(api.pricing.listBonusTemplates, {});
  const create = useProjectMutation(api.pricing.createPricing);
  const update = useProjectMutation(api.pricing.updatePricing);
  const archive = useProjectMutation(api.pricing.archivePricing);
  const remove = useProjectMutation(api.pricing.deletePricing);
  const setDefaultBonus = useProjectMutation(api.pricing.setDefaultBonusPricing);
  const createTemplate = useProjectMutation(api.pricing.createBonusTemplate);

  // Assignations dont le barème FIGÉ ne correspond plus aux termes actuels du
  // pricing. Éditer un barème en place n'affecte que les futures attributions —
  // rien ne le montrait jusqu'ici, et l'écart restait invisible parce que le
  // pricingId, lui, ne change pas.
  const drift = useProjectQuery(api.pricing.listPricingSnapshotDrift, {});
  const [driftFor, setDriftFor] = useState<string | null>(null);
  // « Créatrices sur cette grille » écrit `creators.bonusPricingId`, un champ de
  // RÉMUNÉRATION : le droit qui le garde côté serveur (setPricingCreators) est
  // celui qui décide si l'entrée de menu existe. Un manager sans ce droit garde
  // l'écran des barèmes sans pouvoir déplacer l'argent de quelqu'un.
  const peutPoserLesGrilles = usePermissions().has("creators.pay_terms");
  const [creatorsFor, setCreatorsFor] = useState<Pricing | null>(null);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"active" | "archived" | "all">("active");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pricing | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [tiers, setTiers] = useState<TierForm[]>([]);
  const [templateId, setTemplateId] = useState<Id<"bonusTemplates"> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const defaultPricing = pricings?.find((p) => p.isDefaultBonus) ?? null;

  const visible = useMemo(() => {
    if (!pricings) return [];
    const q = query.trim().toLowerCase();
    return pricings.filter((p) => {
      if (scope === "active" && p.status !== "active") return false;
      if (scope === "archived" && p.status !== "archived") return false;
      return q === "" || p.name.toLowerCase().includes(q);
    });
  }, [pricings, query, scope]);

  const activeCount = pricings?.filter((p) => p.status === "active").length ?? 0;
  const archivedCount =
    pricings?.filter((p) => p.status === "archived").length ?? 0;

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY });
    setTiers([]);
    setTemplateId(null);
    setOpen(true);
  }

  function openEdit(p: Pricing) {
    setEditing(p);
    setForm({
      name: p.name,
      montantFixe: String(p.montantFixe),
      nbVideosCible: String(p.nbVideosCible),
      tauxCPM: String(p.tauxCPM),
      seuilVuesFixe: p.seuilVuesFixe > 0 ? String(p.seuilVuesFixe) : "",
    });
    setTiers(tiersToForm(p.bonusTiers ?? []));
    setTemplateId(p.bonusTemplateId ?? null);
    setOpen(true);
  }

  /** Duplique un barème : le geste JUSTE pour changer un tarif, puisque
   *  modifier en place ne restampe aucune vidéo déjà attribuée. */
  function openDuplicate(p: Pricing) {
    setEditing(null);
    setForm({
      name: `${p.name} (copie)`,
      montantFixe: String(p.montantFixe),
      nbVideosCible: String(p.nbVideosCible),
      tauxCPM: String(p.tauxCPM),
      seuilVuesFixe: p.seuilVuesFixe > 0 ? String(p.seuilVuesFixe) : "",
    });
    setTiers(tiersToForm(p.bonusTiers ?? []));
    setTemplateId(p.bonusTemplateId ?? null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const args = {
      name: form.name.trim(),
      montantFixe: Number(form.montantFixe),
      nbVideosCible: Number(form.nbVideosCible),
      tauxCPM: Number(form.tauxCPM),
      // Champ VIDE = aucune condition, jamais 0 : `Number("")` vaut 0 et aurait
      // enregistré « seuil de 0 vue » sur tous les barèmes qui n'en ont pas.
      seuilVuesFixe:
        form.seuilVuesFixe.trim() === "" ? 0 : Number(form.seuilVuesFixe),
      bonusTiers: formToTiers(tiers),
      // Toujours transmis, y compris à null : sans ça, une simple modification
      // de nom effacerait la provenance et l'écran cesserait de signaler la
      // divergence.
      bonusTemplateId: templateId,
    };
    setBusy(true);
    try {
      if (editing) await update({ id: editing._id, ...args });
      else await create(args);
      toast.success(editing ? "Barème mis à jour" : "Barème créé");
      setOpen(false);
    } catch (err) {
      toast.error(convexErrorMessage(err, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(p: Pricing) {
    try {
      await archive({ id: p._id, archived: p.status === "active" });
      toast.success(p.status === "active" ? "Barème archivé" : "Barème réactivé");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  async function handleDelete(p: Pricing) {
    try {
      await remove({ id: p._id });
      toast.success("Barème supprimé");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  async function handleSetDefaultBonus(value: string | null) {
    const none = value === null || value === "none";
    try {
      const res = await setDefaultBonus({
        pricingId: none ? null : (value as Id<"pricings">),
      });
      toast.success(
        none
          ? "Grille de bonus par défaut retirée"
          : `Grille par défaut appliquée${
              res.synced > 0
                ? ` · ${res.synced} créatrice${res.synced > 1 ? "s" : ""} concernée${res.synced > 1 ? "s" : ""}`
                : ""
            }`,
      );
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  /** Fait d'une échelle existante un modèle réutilisable, en un geste. */
  async function saveAsTemplate(p: Pricing) {
    try {
      await createTemplate({
        name: `Échelle — ${p.name}`,
        tiers: tiersOf(p),
      });
      toast.success(`Modèle « Échelle — ${p.name} » créé`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  const grillesDispo =
    pricings?.filter(
      (p) => p.status === "active" && (p.bonusTiers?.length ?? 0) > 0,
    ) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PayCurrencyWarning payCurrency={payCurrency} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pricings
          </h1>
          <p className="text-sm text-slate-500">
            Fixe mensuel par vidéo, CPM aux vues, paliers de bonus au cumul à vie.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="mr-2 size-4" />
          Nouveau pricing
        </Button>
      </header>

      {/* Grille de bonus par défaut — UNE ligne, sur la même surface que ce
          qu'elle désigne. C'était une carte de 200 px avec quatre lignes
          d'explication, qui repoussait la liste sous la ligne de flottaison. */}
      {grillesDispo.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <span className="text-slate-500">Grille de bonus par défaut</span>
          <Select
            value={defaultPricing?._id ?? "none"}
            onValueChange={handleSetDefaultBonus}
            items={[
              { value: "none", label: "Aucune (grille par créatrice)" },
              ...grillesDispo.map((p) => ({ value: p._id, label: p.name })),
            ]}
          >
            <SelectTrigger
              className="h-8 w-full min-w-0 sm:w-80"
              aria-label="Grille de bonus par défaut du projet"
            >
              {/* Sans SelectValue, le déclencheur ne rend RIEN ; sans `items`
                  sur la racine, il rend la valeur brute (un id Convex). */}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucune (grille par créatrice)</SelectItem>
              {grillesDispo.map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-400 sm:ml-auto">
            {defaultPricing
              ? `${defaultPricing.bonusCreatorCount} créatrice${defaultPricing.bonusCreatorCount > 1 ? "s" : ""} en héritent · une grille perso prime`
              : "Chaque créatrice n'a que sa grille perso, s'il y en a une"}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un barème…"
          aria-label="Rechercher un barème"
          className="h-9 w-full sm:max-w-64"
        />
        <div className="ml-auto flex overflow-hidden rounded-lg border border-slate-200 bg-white">
          {(
            [
              ["active", `Actifs${activeCount ? ` · ${activeCount}` : ""}`],
              [
                "archived",
                `Archivés${archivedCount ? ` · ${archivedCount}` : ""}`,
              ],
              ["all", "Tous"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              aria-pressed={scope === key}
              className={`px-3 py-1.5 text-xs ${
                scope === key
                  ? "bg-slate-100 font-medium text-slate-900"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {pricings === undefined ? (
        <Skeleton className="h-56 w-full" />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
          {pricings.length === 0
            ? "Aucun barème. Crée ton premier barème de paie."
            : "Aucun barème ne correspond."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="min-w-3xl">
            <div className="grid grid-cols-[minmax(13rem,1.4fr)_6rem_6.5rem_minmax(13rem,1.3fr)_2.25rem] items-center gap-4 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[10.5px] font-medium tracking-wider text-slate-400 uppercase">
              <span>Barème</span>
              <span className="text-right">Fixe / vidéo</span>
              <span className="text-right">CPM</span>
              <span>Paliers de bonus</span>
              <span className="sr-only">Actions</span>
            </div>
            {visible.map((p) => (
              <PricingRow
                key={p._id}
                pricing={p}
                money={money}
                isDefaultRow={p.isDefaultBonus}
                templates={templates ?? []}
                driftCount={
                  drift?.find((x) => x.pricingId === p._id)?.driftCount ?? 0
                }
                onEdit={() => openEdit(p)}
                onDuplicate={() => openDuplicate(p)}
                onShowDrift={() => setDriftFor(p._id)}
                onSetDefault={() => handleSetDefaultBonus(p._id)}
                onEditCreators={
                  peutPoserLesGrilles ? () => setCreatorsFor(p) : null
                }
                onSaveAsTemplate={() => saveAsTemplate(p)}
                onArchive={() => toggleArchive(p)}
                onDelete={() => handleDelete(p)}
              />
            ))}
          </div>
        </div>
      )}

      <TemplatesSection
        templates={templates}
        pricings={pricings ?? []}
        money={money}
        payCurrency={payCurrency}
      />

      {creatorsFor && (
        <PricingCreatorsDialog
          pricingId={creatorsFor._id}
          pricingName={creatorsFor.name}
          open
          onOpenChange={(o) => !o && setCreatorsFor(null)}
        />
      )}

      {/* Détail de la dérive — les barèmes figés qui ne correspondent plus. */}
      <Dialog
        open={driftFor !== null}
        onOpenChange={(o) => !o && setDriftFor(null)}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          {(() => {
            const d = drift?.find((x) => x.pricingId === driftFor);
            if (!d) return null;
            const terms = (m: number, n: number, c: number) =>
              `${money(m)} / ${n} vidéos · CPM ${money(c)}`;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Barèmes figés — {d.pricingName}</DialogTitle>
                  <DialogDescription>
                    Le barème est figé à l&apos;attribution : ces assignations
                    gardent les termes en vigueur ce jour-là, et leur paie ne
                    changera pas si tu modifies le barème. Termes actuels :{" "}
                    {terms(
                      d.current.montantFixe,
                      d.current.nbVideosCible,
                      d.current.tauxCPM,
                    )}
                    .
                  </DialogDescription>
                </DialogHeader>
                {/* min-w-0 : DialogContent est une GRILLE — sans lui, l'enfant
                    prend sa largeur de contenu et le `truncate` plus bas ne
                    s'applique jamais (le dialogue déborde à l'horizontale). */}
                <div className="min-w-0 space-y-4">
                  {d.generations.map((g) => (
                    <div
                      key={`${g.montantFixe}-${g.nbVideosCible}-${g.tauxCPM}`}
                      className="space-y-1.5 rounded-md border border-slate-200 p-3"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {g.count} assignation{g.count > 1 ? "s" : ""} à{" "}
                        {terms(g.montantFixe, g.nbVideosCible, g.tauxCPM)}
                      </p>
                      <ul className="space-y-0.5 text-xs text-slate-500">
                        {g.sample.map((a) => (
                          <li key={a.assignmentId} className="flex min-w-0 gap-2">
                            <span className="w-20 shrink-0 tabular-nums">
                              {formatDate(a.createdAt)}
                            </span>
                            <span className="flex-1 truncate">{a.creatorName}</span>
                            <span className="shrink-0">{a.status}</span>
                          </li>
                        ))}
                        {g.count > g.sample.length && (
                          <li className="italic">
                            … et {g.count - g.sample.length} autre
                            {g.count - g.sample.length > 1 ? "s" : ""} (échantillon
                            borné)
                          </li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <PricingEditorDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        form={form}
        setForm={setForm}
        tiers={tiers}
        setTiers={setTiers}
        templateId={templateId}
        setTemplateId={setTemplateId}
        templates={templates ?? []}
        pricings={pricings ?? []}
        editingId={editing?._id ?? null}
        payCurrency={payCurrency}
        money={money}
        busy={busy}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

/** Une ligne de barème : nom + nature à gauche, termes alignés, échelle, menu. */
function PricingRow({
  pricing: p,
  money,
  isDefaultRow,
  templates,
  driftCount,
  onEdit,
  onDuplicate,
  onShowDrift,
  onSetDefault,
  onEditCreators,
  onSaveAsTemplate,
  onArchive,
  onDelete,
}: {
  pricing: Pricing;
  money: (n: number) => string;
  isDefaultRow: boolean;
  templates: Template[];
  driftCount: number;
  onEdit: () => void;
  onDuplicate: () => void;
  onShowDrift: () => void;
  onSetDefault: () => void;
  /** null = l'utilisateur n'a pas le droit de toucher aux conditions de paie. */
  onEditCreators: (() => void) | null;
  onSaveAsTemplate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const kind = pricingKind(p);
  const tiers = tiersOf(p);
  const perVideo = fixedPerVideo(p);
  const canDelete = p.assignmentCount === 0;

  return (
    <div
      className={`grid grid-cols-[minmax(13rem,1.4fr)_6rem_6.5rem_minmax(13rem,1.3fr)_2.25rem] items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
        p.status === "archived" ? "bg-slate-50/40" : ""
      } ${isDefaultRow ? "bg-violet-50/30" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="truncate text-left text-sm font-semibold text-slate-900 hover:underline"
          >
            {p.name}
          </button>
          {isDefaultRow && (
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-800">
              Grille par défaut
            </span>
          )}
          {p.status === "archived" && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">
              Archivé
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase ${KIND_CLASS[kind]}`}
          >
            {PRICING_KIND_LABEL[kind]}
          </span>
          {/* CONDITION DE VUES — à côté de la nature du barème, parce qu'elle en
              change la nature : un « fixe seul » conditionné n'est pas un
              forfait, c'est un forfait sous réserve. Absente = rien n'est rendu,
              les huit barèmes existants ne bougent pas. */}
          {p.seuilVuesFixe > 0 && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-amber-800"
              title={`Le fixe n'est dû que si les vidéos du mois cumulent au moins ${new Intl.NumberFormat("fr-FR").format(p.seuilVuesFixe)} vues.`}
            >
              conditionné · {formatSeuil(p.seuilVuesFixe)} vues
            </span>
          )}
          <span>{p.nbVideosCible} vidéos</span>
          {p.bonusCreatorCount > 0 && (
            <span>
              · {p.bonusCreatorCount} créatrice
              {p.bonusCreatorCount > 1 ? "s" : ""} sur cette grille
            </span>
          )}
        </div>
        {driftCount > 0 && (
          <button
            type="button"
            onClick={onShowDrift}
            className="mt-1.5 w-fit rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-left text-[11.5px] text-amber-900 hover:bg-amber-100"
          >
            {driftCount} assignation{driftCount > 1 ? "s" : ""} sur un barème figé
            différent
          </button>
        )}
      </div>

      <NumCell
        value={kind === "cpm" || kind === "aucun" ? null : money(perVideo)}
        unit={
          kind === "cpm" || kind === "aucun"
            ? "pas de fixe"
            : `${money(p.montantFixe)} / ${p.nbVideosCible}`
        }
      />
      <NumCell
        value={kind === "fixe" || kind === "aucun" ? null : money(p.tauxCPM)}
        unit={kind === "fixe" || kind === "aucun" ? "pas de CPM" : "/ 1 000 vues"}
      />

      <LadderCell
        tiers={tiers}
        money={money}
        template={templates.find((t) => t._id === p.bonusTemplateId) ?? null}
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Actions du barème ${p.name}`}
              className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onClick={onEdit}>Modifier le barème</DropdownMenuItem>
          <DropdownMenuItem onClick={onDuplicate}>Dupliquer</DropdownMenuItem>
          {onEditCreators && (
            <DropdownMenuItem onClick={onEditCreators}>
              Créatrices sur cette grille…
            </DropdownMenuItem>
          )}
          {/* Amorce la bibliothèque depuis une échelle qui EXISTE : sans elle,
              le seul chemin vers un premier modèle était de retaper les six
              paliers à la main — exactement ce qu'un modèle sert à éviter. */}
          {tiers.length > 0 && (
            <DropdownMenuItem onClick={onSaveAsTemplate}>
              Enregistrer l&apos;échelle comme modèle
            </DropdownMenuItem>
          )}
          {tiers.length > 0 && !isDefaultRow && p.status === "active" && (
            <DropdownMenuItem onClick={onSetDefault}>
              Définir comme grille par défaut
            </DropdownMenuItem>
          )}
          {driftCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onShowDrift}>
                Voir les {driftCount} barèmes figés
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onArchive}>
            {p.status === "active" ? "Archiver" : "Réactiver"}
          </DropdownMenuItem>
          {/* Désactivé AVEC son motif plutôt que proposé puis refusé par le
              serveur : `deletePricing` lève dès qu'une vidéo porte le barème. */}
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            onClick={canDelete ? onDelete : undefined}
          >
            <span className="flex w-full items-baseline justify-between gap-2">
              Supprimer
              {!canDelete && (
                <small className="text-[11px] text-slate-400">
                  {p.assignmentCount} vidéo{p.assignmentCount > 1 ? "s" : ""}
                </small>
              )}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Cellule numérique alignée. `value` à null = le barème ne paie PAS par ce
 * canal : un tiret, pas un « 0,00 $ » qui inviterait à comparer ce qui n'est
 * pas comparable.
 */
function NumCell({ value, unit }: { value: string | null; unit: string }) {
  return (
    <div className="text-right tabular-nums">
      <span
        className={`text-sm font-semibold tracking-tight ${
          value === null ? "text-slate-300" : "text-slate-900"
        }`}
      >
        {value ?? "—"}
      </span>
      <span className="block text-[11px] font-normal text-slate-400">
        {unit}
      </span>
    </div>
  );
}

/** Micro-échelle + sommet + divergence, UNIQUEMENT face à un modèle assumé. */
function LadderCell({
  tiers,
  money,
  template,
}: {
  tiers: BonusTier[];
  money: (n: number) => string;
  template: Template | null;
}) {
  const summary = ladderSummary(tiers, money);
  if (summary.count === 0) {
    return <span className="text-xs text-slate-300">Aucun palier</span>;
  }

  // On ne compare QU'À UN MODÈLE — une provenance que quelqu'un a posée.
  //
  // La première version comparait aussi à la grille par défaut du projet : le
  // badge s'allumait alors sur presque chaque ligne (un barème brésilien n'a
  // aucune raison de porter l'échelle française), et un avertissement qui se
  // déclenche partout n'avertit plus de rien. Personne n'a décidé que ces
  // échelles-là devaient coïncider ; le modèle, lui, est un engagement explicite.
  const cmp = template ? compareLadders(tiers, template.tiers) : null;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="flex h-4 items-end gap-0.5">
          {summary.steps.map((h, i) => (
            <span
              key={i}
              style={{ height: `${Math.round(h * 16)}px` }}
              className={`w-1 rounded-[1px] ${
                i === summary.steps.length - 1 ? "bg-violet-600" : "bg-violet-300"
              }`}
            />
          ))}
        </span>
        <span className="min-w-0 truncate text-xs text-slate-600">
          <b className="font-semibold text-slate-900">
            {summary.count} palier{summary.count > 1 ? "s" : ""}
          </b>
          {summary.topLabel && (
            <span className="text-slate-500"> · jusqu&apos;à {summary.topLabel}</span>
          )}
        </span>
      </div>
      {cmp && !cmp.identical && (
        <span className="mt-1 inline-block rounded-md border border-amber-200 bg-amber-50/70 px-1.5 py-0.5 text-[11px] text-amber-900">
          ≠ du modèle « {template!.name} » — {cmp.differing} palier
          {cmp.differing > 1 ? "s divergent" : " diverge"}
        </span>
      )}
      {cmp?.identical && (
        <span className="mt-1 block text-[11px] text-slate-400">
          Identique au modèle « {template!.name} »
        </span>
      )}
    </div>
  );
}

/**
 * BIBLIOTHÈQUE DE MODÈLES d'échelle. Un modèle ne paie rien : l'appliquer
 * RECOPIE ses paliers dans les barèmes choisis, et c'est le barème qui paie.
 */
function TemplatesSection({
  templates,
  pricings,
  money,
  payCurrency,
}: {
  templates: Template[] | undefined;
  pricings: Pricing[];
  money: (n: number) => string;
  payCurrency: string | null | undefined;
}) {
  const createTpl = useProjectMutation(api.pricing.createBonusTemplate);
  const updateTpl = useProjectMutation(api.pricing.updateBonusTemplate);
  const deleteTpl = useProjectMutation(api.pricing.deleteBonusTemplate);
  const applyTpl = useProjectMutation(api.pricing.applyBonusTemplate);

  const [editorFor, setEditorFor] = useState<Template | "new" | null>(null);
  const [applyFor, setApplyFor] = useState<Template | null>(null);

  async function handleDelete(t: Template) {
    try {
      await deleteTpl({ id: t._id });
      toast.success("Modèle supprimé");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  return (
    <section className="space-y-2 pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Modèles d&apos;échelle de bonus
          </h2>
          <p className="text-xs text-slate-500">
            Une échelle saisie une fois, à piquer dans n&apos;importe quel
            barème. Un modèle ne paie rien : l&apos;appliquer recopie ses paliers
            dans le barème.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditorFor("new")}>
          <PlusIcon className="mr-1.5 size-3.5" />
          Nouveau modèle
        </Button>
      </div>

      {templates === undefined ? (
        <Skeleton className="h-20 w-full" />
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
          Aucun modèle. Le plus court : sur un barème dont l&apos;échelle te
          convient, menu «&nbsp;···&nbsp;» → «&nbsp;Enregistrer l&apos;échelle
          comme modèle&nbsp;». Sinon, pars d&apos;une page blanche.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {templates.map((t) => {
            const users = pricings.filter((p) => p.bonusTemplateId === t._id);
            const diverged = users.filter(
              (p) => !compareLadders(tiersOf(p), t.tiers).identical,
            );
            const summary = ladderSummary(t.tiers, money);
            return (
              <div
                key={t._id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => setEditorFor(t)}
                  className="text-sm font-medium text-slate-900 hover:underline"
                >
                  {t.name}
                </button>
                <span className="text-xs text-slate-500">
                  {summary.count} palier{summary.count > 1 ? "s" : ""}
                  {summary.topLabel ? ` · jusqu'à ${summary.topLabel}` : ""}
                </span>
                <span className="text-xs text-slate-400">
                  {users.length === 0
                    ? "Aucun barème"
                    : `${users.length} barème${users.length > 1 ? "s" : ""}`}
                  {diverged.length > 0 && (
                    <span className="text-amber-700">
                      {" "}
                      · {diverged.length} a divergé
                    </span>
                  )}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setApplyFor(t)}
                  >
                    Appliquer…
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(t)}
                  >
                    Supprimer
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TemplateEditorDialog
        target={editorFor}
        onClose={() => setEditorFor(null)}
        payCurrency={payCurrency}
        onSave={async (name, tiers) => {
          if (editorFor === "new") await createTpl({ name, tiers });
          else if (editorFor) await updateTpl({ id: editorFor._id, name, tiers });
        }}
      />

      <ApplyTemplateDialog
        template={applyFor}
        pricings={pricings}
        money={money}
        onClose={() => setApplyFor(null)}
        onApply={async (pricingIds) => {
          const res = await applyTpl({
            templateId: applyFor!._id,
            pricingIds,
          });
          toast.success(
            `Modèle appliqué à ${res.pricings} barème${res.pricings > 1 ? "s" : ""}` +
              (res.creatorsSynced > 0
                ? ` · ${res.creatorsSynced} créatrice${res.creatorsSynced > 1 ? "s" : ""} resynchronisée${res.creatorsSynced > 1 ? "s" : ""}`
                : ""),
          );
        }}
      />
    </section>
  );
}

/** Éditeur de modèle : un nom, une échelle. Aucun fixe, aucun CPM. */
function TemplateEditorDialog({
  target,
  onClose,
  payCurrency,
  onSave,
}: {
  target: Template | "new" | null;
  onClose: () => void;
  payCurrency: string | null | undefined;
  onSave: (name: string, tiers: BonusTier[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [tiers, setTiers] = useState<TierForm[]>([]);
  const [busy, setBusy] = useState(false);
  // Clé de remontage : le dialogue se réinitialise à chaque cible plutôt que de
  // garder la saisie du modèle précédent.
  const key = target === "new" ? "new" : (target?._id ?? "none");

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      key={key}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {target === "new" ? "Nouveau modèle" : "Modifier le modèle"}
          </DialogTitle>
          <DialogDescription>
            Modifier un modèle ne change AUCUN barème : rien ne bouge tant que tu
            ne l&apos;appliques pas, et l&apos;application annonce d&apos;abord
            combien de créatrices elle touche.
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSave(name.trim(), formToTiers(tiers));
              toast.success(
                target === "new" ? "Modèle créé" : "Modèle mis à jour",
              );
              onClose();
            } catch (err) {
              toast.error(convexErrorMessage(err, "Une erreur est survenue."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <TemplateNameField
            target={target}
            name={name}
            setName={setName}
            tiers={tiers}
            setTiers={setTiers}
          />
          <TierEditor
            tiers={tiers}
            setTiers={setTiers}
            payCurrency={payCurrency}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {target === "new" ? "Créer" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Amorce le formulaire depuis la cible (une seule fois, au montage du dialogue). */
function TemplateNameField({
  target,
  name,
  setName,
  tiers,
  setTiers,
}: {
  target: Template | "new" | null;
  name: string;
  setName: (v: string) => void;
  tiers: TierForm[];
  setTiers: (v: TierForm[]) => void;
}) {
  const [seeded, setSeeded] = useState(false);
  if (!seeded && target) {
    setSeeded(true);
    if (target !== "new") {
      setName(target.name);
      setTiers(tiersToForm(target.tiers));
    } else if (tiers.length === 0) {
      setTiers([emptyTier()]);
    }
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="tpl-name">Nom du modèle</Label>
      <Input
        id="tpl-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Échelle Snytch standard"
        required
      />
    </div>
  );
}

/** Choix des barèmes à réécrire, avec l'effectif touché AVANT d'écrire. */
function ApplyTemplateDialog({
  template,
  pricings,
  money,
  onClose,
  onApply,
}: {
  template: Template | null;
  pricings: Pricing[];
  money: (n: number) => string;
  onClose: () => void;
  onApply: (pricingIds: Id<"pricings">[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const candidates = pricings.filter((p) => p.status === "active");
  const impacted = candidates
    .filter((p) => selected.has(p._id))
    .reduce((s, p) => s + p.bonusCreatorCount, 0);

  return (
    <Dialog
      open={template !== null}
      onOpenChange={(o) => !o && onClose()}
      key={template?._id ?? "none"}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Appliquer « {template?.name} »</DialogTitle>
          <DialogDescription>
            Les paliers du modèle REMPLACENT l&apos;échelle des barèmes cochés.
            Les paliers sont lus en direct : les créatrices concernées voient la
            nouvelle échelle immédiatement, et celles qui ont déjà franchi un
            palier ajouté le débloquent tout de suite. Les bonus déjà débloqués
            sont immuables — abaisser un seuil en ajoute, le relever n&apos;en
            retire aucun.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-1">
          {candidates.map((p) => {
            const cmp = template
              ? compareLadders(tiersOf(p), template.tiers)
              : null;
            return (
              <label
                key={p._id}
                className="flex min-w-0 items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-slate-50"
              >
                <Checkbox
                  checked={selected.has(p._id)}
                  onCheckedChange={(c) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (c) next.add(p._id);
                      else next.delete(p._id);
                      return next;
                    })
                  }
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-900">
                    {p.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {cmp?.identical
                      ? "déjà identique au modèle"
                      : `${cmp?.differing ?? 0} palier${(cmp?.differing ?? 0) > 1 ? "s" : ""} sera réécrit`}
                    {p.bonusCreatorCount > 0 &&
                      ` · ${p.bonusCreatorCount} créatrice${p.bonusCreatorCount > 1 ? "s" : ""}`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {impacted > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <b>
              {impacted} créatrice{impacted > 1 ? "s" : ""}
            </b>{" "}
            {impacted > 1 ? "verront" : "verra"} cette échelle. Sommet du modèle :{" "}
            {ladderSummary(template?.tiers ?? [], money).topLabel ?? "—"}.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            disabled={busy || selected.size === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onApply([...selected] as Id<"pricings">[]);
                onClose();
              } catch (e) {
                toast.error(convexErrorMessage(e, "Une erreur est survenue."));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Appliquer à {selected.size} barème{selected.size > 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Éditeur de barème : termes, simulation vivante, échelle de paliers. */
function PricingEditorDialog({
  open,
  onOpenChange,
  editing,
  form,
  setForm,
  tiers,
  setTiers,
  templateId,
  setTemplateId,
  templates,
  pricings,
  editingId,
  payCurrency,
  money,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Pricing | null;
  form: typeof EMPTY;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY>>;
  tiers: TierForm[];
  setTiers: React.Dispatch<React.SetStateAction<TierForm[]>>;
  templateId: Id<"bonusTemplates"> | null;
  setTemplateId: (v: Id<"bonusTemplates"> | null) => void;
  templates: Template[];
  pricings: Pricing[];
  editingId: Id<"pricings"> | null;
  payCurrency: string | null | undefined;
  money: (n: number) => string;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const createTpl = useProjectMutation(api.pricing.createBonusTemplate);
  const [viewsIdx, setViewsIdx] = useState(4);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Modifier le barème" : "Nouveau barème"}
          </DialogTitle>
          <DialogDescription>
            Le fixe et le CPM sont figés à l&apos;attribution : les modifier
            n&apos;affecte que les FUTURES attributions. Les paliers, eux, sont
            lus en direct.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="min-w-0 space-y-4">
          {/* L'avertissement de dérive, là où la dérive se CRÉE — plutôt que
              constaté après coup dans un bandeau de la liste. */}
          {editing && editing.assignmentCount > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              <b>
                {editing.assignmentCount} vidéo
                {editing.assignmentCount > 1 ? "s sont attribuées" : " est attribuée"}{" "}
                sur ce barème.
              </b>{" "}
              Modifier le fixe ou le CPM ici ne changera rien à leur paie — elle
              est figée au jour de l&apos;attribution. Pour payer un nouveau
              tarif, duplique le barème et attribue le nouveau.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Nom</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="montantFixe">
                Montant fixe ({currencySymbol(payCurrency)})
              </Label>
              <Input
                id="montantFixe"
                type="number"
                step="0.01"
                min={0}
                value={form.montantFixe}
                onChange={(e) =>
                  setForm((f) => ({ ...f, montantFixe: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nbVideosCible">Nb vidéos cible</Label>
              <Input
                id="nbVideosCible"
                type="number"
                min={1}
                value={form.nbVideosCible}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nbVideosCible: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tauxCPM">
                CPM ({currencySymbol(payCurrency)}/1000 vues)
              </Label>
              <Input
                id="tauxCPM"
                type="number"
                step="0.01"
                min={0}
                value={form.tauxCPM}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tauxCPM: e.target.value }))
                }
                required
              />
            </div>
          </div>

          {/* CONDITION DE VUES SUR LE FIXE — sous les trois montants, parce
              qu'elle les conditionne. Masquée quand le barème n'a pas de fixe :
              un seuil qui ne conditionne rien n'a pas à se saisir (le serveur le
              refuse d'ailleurs). */}
          {Number(form.montantFixe) > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="seuilVuesFixe">
                Seuil de vues qui conditionne le fixe (optionnel)
              </Label>
              <Input
                id="seuilVuesFixe"
                type="number"
                min={0}
                step={1000}
                placeholder="Aucune condition"
                value={form.seuilVuesFixe}
                onChange={(e) =>
                  setForm((f) => ({ ...f, seuilVuesFixe: e.target.value }))
                }
              />
              <p className="text-xs leading-relaxed text-slate-500">
                Les vidéos du mois doivent cumuler au moins ce nombre de vues
                payées pour que le fixe soit dû.{" "}
                <strong>En dessous, le fixe du mois vaut 0</strong> — le seuil ne
                s&apos;abaisse pas si moins de vidéos sont livrées. Le CPM et les
                paliers de bonus, eux, ne sont pas concernés.
              </p>
            </div>
          )}

          <PayoutPreview
            form={form}
            tiers={tiers}
            money={money}
            viewsIdx={viewsIdx}
            setViewsIdx={setViewsIdx}
          />

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Paliers de bonus (cumul de vues à vie)</Label>
              <div className="flex gap-2">
                <ReuseLadderMenu
                  templates={templates}
                  pricings={pricings}
                  editingId={editingId}
                  onPickTemplate={(t) => {
                    setTiers(tiersToForm(t.tiers));
                    setTemplateId(t._id);
                    toast.success(`Échelle «\u00a0${t.name}\u00a0» recopiée`);
                  }}
                  onPickPricing={(pr) => {
                    setTiers(tiersToForm(tiersOf(pr)));
                    // La provenance suit l'échelle : reprendre celle d'un barème
                    // issu d'un modèle, c'est en descendre aussi.
                    setTemplateId(pr.bonusTemplateId ?? null);
                    toast.success(`Échelle de «\u00a0${pr.name}\u00a0» recopiée`);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTiers((ts) => [...ts, emptyTier()])}
                >
                  + Palier
                </Button>
              </div>
            </div>

            {tiers.length === 0 ? (
              <p className="text-xs text-slate-400">
                Aucun palier. Reprends l&apos;échelle d&apos;un modèle ou
                d&apos;un autre barème, ou ajoute des paliers cash (
                {currencySymbol(payCurrency)}) ou nature (iPhone…).
              </p>
            ) : (
              <>
                <TierEditor
                  tiers={tiers}
                  setTiers={setTiers}
                  payCurrency={payCurrency}
                />
                <ScaleProvenance
                  template={templates.find((t) => t._id === templateId) ?? null}
                  tiers={tiers}
                  onDetach={() => setTemplateId(null)}
                />
                <button
                  type="button"
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline"
                  onClick={async () => {
                    const name = form.name.trim() || "Nouvelle échelle";
                    try {
                      const res = await createTpl({
                        name: `Échelle — ${name}`,
                        tiers: formToTiers(tiers),
                      });
                      setTemplateId(res.templateId);
                      toast.success("Échelle enregistrée comme modèle");
                    } catch (e) {
                      toast.error(
                        convexErrorMessage(e, "Une erreur est survenue."),
                      );
                    }
                  }}
                >
                  Enregistrer cette échelle comme modèle
                </button>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {editing ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * PROVENANCE de l'échelle en cours de saisie. Dire d'où elle vient — et si elle
 * s'en est écartée — évite le piège du modèle : croire qu'un barème « suit » un
 * modèle alors que l'application ne fait que RECOPIER. Se détacher est explicite,
 * pour qu'une échelle repartie de zéro cesse de se comparer à un modèle dont
 * elle ne descend plus.
 */
function ScaleProvenance({
  template,
  tiers,
  onDetach,
}: {
  template: Template | null;
  tiers: TierForm[];
  onDetach: () => void;
}) {
  if (!template) return null;
  const cmp = compareLadders(formToTiers(tiers), template.tiers);
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
      <span>
        Échelle issue du modèle{" "}
        <b className="font-medium text-slate-700">{template.name}</b>
        {cmp.identical
          ? " · identique"
          : ` · ${cmp.differing} palier${cmp.differing > 1 ? "s" : ""} divergent`}
      </span>
      <button
        type="button"
        onClick={onDetach}
        className="text-slate-400 underline hover:text-slate-700"
      >
        Détacher
      </button>
    </p>
  );
}

/**
 * REPRENDRE UNE ÉCHELLE — modèles d'abord, barèmes existants ensuite.
 *
 * La première version n'offrait que les modèles, et seulement s'il en existait
 * déjà un. Sur un projet qui n'en a aucun, le bouton n'apparaissait donc pas du
 * tout : le seul chemin vers un premier modèle était de retaper les six paliers
 * à la main. C'est l'exact contraire de ce qu'un modèle sert à éviter.
 *
 * Les échelles EXISTENT déjà, sur les barèmes. On les propose donc telles
 * quelles : c'est le stock réel du projet, disponible dès le premier jour.
 */
function ReuseLadderMenu({
  templates,
  pricings,
  editingId,
  onPickTemplate,
  onPickPricing,
}: {
  templates: Template[];
  pricings: Pricing[];
  editingId: Id<"pricings"> | null;
  onPickTemplate: (t: Template) => void;
  onPickPricing: (p: Pricing) => void;
}) {
  // Un barème sans palier n'a rien à prêter, et on ne se reprend pas soi-même.
  const sources = pricings.filter(
    (p) => p._id !== editingId && tiersOf(p).length > 0,
  );
  if (templates.length === 0 && sources.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            Reprendre une échelle
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        {/* Un intitulé de section est une PART DE GROUPE chez base-ui : hors
            d'un <DropdownMenuGroup>, il lève « MenuGroupRootContext is missing »
            à l'ouverture du menu. Ni tsc ni eslint ne le voient — seule
            l'ouverture réelle du menu le montre. */}
        {templates.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Modèles</DropdownMenuLabel>
            {templates.map((t) => (
              <DropdownMenuItem key={t._id} onClick={() => onPickTemplate(t)}>
                <LadderOption name={t.name} count={t.tiers.length} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {sources.length > 0 && (
          <>
            {templates.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Barèmes existants</DropdownMenuLabel>
              {sources.map((p) => (
                <DropdownMenuItem key={p._id} onClick={() => onPickPricing(p)}>
                  <LadderOption name={p.name} count={tiersOf(p).length} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LadderOption({ name, count }: { name: string; count: number }) {
  return (
    <span className="flex w-full items-baseline justify-between gap-2">
      <span className="truncate">{name}</span>
      <small className="shrink-0 text-[11px] text-slate-400">
        {count} palier{count > 1 ? "s" : ""}
      </small>
    </span>
  );
}

/** Paliers de vues de la simulation — de la vidéo modeste au très gros succès. */
const VIEW_STEPS = [
  10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000,
];

/**
 * SIMULATION VIVANTE. Le formulaire faisait saisir 580, 60 et 0 sans jamais
 * montrer ce que ça paie. Le moteur est celui du portail créatrice
 * (`estimateMissionEarnings`) : ce que l'admin lit ici est ce qu'elle lira
 * là-bas. Les paliers y sont ajoutés à part, parce qu'ils se jouent sur le
 * CUMUL À VIE et non par mission.
 */
function PayoutPreview({
  form,
  tiers,
  money,
  viewsIdx,
  setViewsIdx,
}: {
  form: typeof EMPTY;
  tiers: TierForm[];
  money: (n: number) => string;
  viewsIdx: number;
  setViewsIdx: (i: number) => void;
}) {
  const views = VIEW_STEPS[viewsIdx] ?? VIEW_STEPS[0];
  const nbVideos = Math.max(1, Number(form.nbVideosCible) || 0);
  const snapshot = {
    pricingId: "preview",
    montantFixe: Number(form.montantFixe) || 0,
    nbVideosCible: nbVideos,
    tauxCPM: Number(form.tauxCPM) || 0,
  };
  const perVideo = estimateMissionEarnings(snapshot, views);
  const cycle = perVideo.total * nbVideos;
  const cumul = views * nbVideos;
  const bonus = evaluateBonusTiers(
    cumul,
    formToTiers(tiers).filter((t) => Number.isFinite(t.seuilVues)),
  );

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold tracking-wider text-violet-800 uppercase">
        Ce que touche une créatrice
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {money(cycle + bonus.cashCrossedTotal)}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
        {nbVideos} vidéo{nbVideos > 1 ? "s" : ""} à {formatSeuil(views)} vues ={" "}
        {money(perVideo.fixed * nbVideos)} de fixe + {money(perVideo.cpm * nbVideos)}{" "}
        de CPM
        {bonus.crossed.length > 0 && (
          <>
            {" "}
            + {money(bonus.cashCrossedTotal)} de paliers ({bonus.crossed.length}{" "}
            franchi{bonus.crossed.length > 1 ? "s" : ""} à {formatSeuil(cumul)}{" "}
            vues cumulées
            {bonus.natureCrossed.length > 0 &&
              `, dont ${bonus.natureCrossed.map((t) => t.libelle).join(", ")}`}
            )
          </>
        )}
      </p>
      <input
        type="range"
        min={0}
        max={VIEW_STEPS.length - 1}
        step={1}
        value={viewsIdx}
        onChange={(e) => setViewsIdx(Number(e.target.value))}
        aria-label="Vues par vidéo pour la simulation"
        className="mt-2.5 w-full accent-violet-600"
      />
      <div className="flex justify-between text-[10px] text-slate-400">
        {VIEW_STEPS.map((v) => (
          <span key={v}>{formatSeuil(v)}</span>
        ))}
      </div>
    </div>
  );
}

/** Liste de paliers en COLONNE : les seuils s'alignent, donc ils se comparent. */
function TierEditor({
  tiers,
  setTiers,
  payCurrency,
}: {
  tiers: TierForm[];
  setTiers: React.Dispatch<React.SetStateAction<TierForm[]>>;
  payCurrency: string | null | undefined;
}) {
  function updateTier(i: number, patch: Partial<TierForm>) {
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  return (
    <div className="min-w-0 space-y-2">
      {tiers.map((t, i) => (
        <div
          key={i}
          className="flex min-w-0 flex-wrap items-end gap-2 rounded-md border border-slate-200 p-2"
        >
          <div className="min-w-[7rem] flex-1 space-y-1">
            <Label className="text-xs">Seuil de vues</Label>
            <Input
              type="number"
              min={0}
              value={t.seuilVues}
              onChange={(e) => updateTier(i, { seuilVues: e.target.value })}
              className="tabular-nums"
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select
              value={t.rewardType}
              onValueChange={(v) =>
                v && updateTier(i, { rewardType: v as "cash" | "nature" })
              }
              items={[
                { value: "cash", label: `Cash ${currencySymbol(payCurrency)}` },
                { value: "nature", label: "Nature" },
              ]}
            >
              <SelectTrigger aria-label="Type de récompense" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">
                  Cash {currencySymbol(payCurrency)}
                </SelectItem>
                <SelectItem value="nature">Nature</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[8rem] flex-1 space-y-1">
            {t.rewardType === "cash" ? (
              <>
                <Label className="text-xs">
                  Montant ({currencySymbol(payCurrency)})
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={t.montant}
                  onChange={(e) => updateTier(i, { montant: e.target.value })}
                  required
                />
              </>
            ) : (
              <>
                <Label className="text-xs">Libellé</Label>
                <Input
                  placeholder="iPhone 15"
                  value={t.libelle}
                  onChange={(e) => updateTier(i, { libelle: e.target.value })}
                  required
                />
              </>
            )}
          </div>
          {/* Coût réel — NATURE seulement. Facultatif : sans lui la récompense
              reste visible mais non chiffrée (tiret), elle n'entre alors dans
              aucun total. Ce n'est PAS le prix public et ce n'est jamais montré
              à la créatrice. */}
          {t.rewardType === "nature" && (
            <div className="min-w-[8rem] flex-1 space-y-1">
              <Label className="text-xs">
                Coût réel ({currencySymbol(payCurrency)})
              </Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                placeholder="ce qu'il nous coûte"
                value={t.coutReel}
                onChange={(e) => updateTier(i, { coutReel: e.target.value })}
              />
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}
          >
            Retirer
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * Garde d'écran : pricing.manage. Le menu ne propose plus cette page à qui n'a pas le
 * bloc, mais son URL répond toujours — sans cette enveloppe, y arriver par un
 * favori déclenche les queries de la page, qui lèvent, et on lit une erreur
 * technique au lieu d'une phrase.
 *
 * ⚠️ Ce n'est PAS la barrière : le serveur refuse déjà chaque appel.
 */
export default function PricingsPage() {
  return (
    <PermissionGate bloc="pricing.manage">
      <PricingsPageContenu />
    </PermissionGate>
  );
}
