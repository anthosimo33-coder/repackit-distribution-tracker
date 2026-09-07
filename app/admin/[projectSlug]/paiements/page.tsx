"use client";

import { useMemo, useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { formatMoney, moneyColumnHeader } from "@/lib/format-rate";
import { formatCycleRange } from "@/lib/pay-cycle";
import { downloadCsv } from "@/lib/csv";
import { WhopRevenueCard } from "@/components/whop/WhopRevenueCard";
import { ProfitabilityCard } from "@/components/ProfitabilityCard";
import { PayCurrencyWarning } from "@/components/PayCurrencyWarning";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronRightIcon,
  DownloadIcon,
  Loader2Icon,
} from "lucide-react";
import { PermissionGate } from "@/components/project/PermissionGate";
import { usePermissions } from "@/components/project/use-permissions";

/**
 * Paiements admin — CYCLES J+30 GLISSANTS par créateur (fenêtre de 30 j ancrée
 * sur son 1er post). 1 ligne = 1 (créateur, cycle) : le regroupement calendaire
 * global (« période du mois ») n'existe plus (chaque créateur a son propre cycle).
 * Marquer payé se fait PAR CYCLE (markCyclePaid). Le montant est inchangé (même
 * moteur cappé 150$/vidéo) — seul le découpage change.
 *
 * Scalabilité 30+ créateurs : marquage EN MASSE (sélection multiple + « tout ce
 * qui est dû ») avec confirmation chiffrée. Il boucle sur markCyclePaid, donc le
 * gel des montants et l'idempotence sont exactement ceux du bouton unitaire —
 * aucun calcul n'est refait. markPeriodPaid n'est PAS utilisé : il cible la clé
 * `period` (= date ISO du début de cycle), propre à chaque créateur depuis le
 * modèle J+30 glissant, donc il ne couvrirait qu'un sous-ensemble arbitraire.
 */

type Payment = FunctionReturnType<typeof api.payments.listPayments>[number];

/** Les cycles OUVERTS d'une créatrice, réunis : c'est l'unité du virement. */
type CreatorGroup = {
  creatorId: string;
  creatorName: string;
  paymentMethod: string | null;
  paymentDetails: string | null;
  cycles: Payment[];
  /** Somme des restes à verser de ses cycles ouverts (acomptes déduits). */
  remaining: number;
};

/** Rows ORPHELINES de listPayments (créateur supprimé) : leur clé est préfixée
 *  ainsi et leur ancre de cycle est perdue (cycleIndex synthétique = 0). */
const ORPHAN_KEY_PREFIX = "orphan:";

/**
 * Un cycle est marquable EN MASSE s'il est dû ET rattaché à un créateur vivant.
 *
 * Les rows orphelines sont exclues : markCyclePaid ré-ancre la fenêtre sur
 * creators.firstPostAt, qui n'existe plus pour un créateur supprimé (la mutation
 * rejetterait « Créateur introuvable »). Elles gardent leur bouton unitaire.
 */
function isBulkPayable(p: Payment): boolean {
  return p.status !== "paid" && !p.key.startsWith(ORPHAN_KEY_PREFIX);
}

const KIND_LABEL: Record<string, string> = {
  base: "Base",
  bonus: "Bonus",
  fixed: "Fixe",
  cpm: "CPM",
  bonus_tier: "Palier",
  challenge: "Prime de défi",
};
const KIND_BADGE: Record<string, string> = {
  base: "bg-slate-200 text-slate-600",
  bonus: "bg-indigo-50 text-indigo-600",
  fixed: "bg-emerald-50 text-emerald-600",
  cpm: "bg-sky-50 text-sky-600",
  bonus_tier: "bg-amber-50 text-amber-600",
  // Couleur PROPRE : reprendre l'ambre des paliers ferait lire deux natures de
  // gain comme une seule dans le grand livre.
  challenge: "bg-rose-50 text-rose-600",
};

function BreakdownLine({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  /** Devise de la PAIE créatrices (dollars), threadée depuis PaymentRow. */
  currency?: string | null;
}) {
  return (
    <li className="flex items-center justify-between gap-4 text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums text-slate-700">
        {formatMoney(amount, currency)}
      </span>
    </li>
  );
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  sepa: "SEPA",
  paypal: "PayPal",
  usdt: "USDT",
  autre: "Autre",
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  accruing: {
    label: "En cours",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  paid: {
    label: "Payé",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

function PaiementsPageContenu() {
  const droitsNav = usePermissions();
  // Devise de la PAIE créatrices (dollars, projects.payCurrency) — appliquée à
  // TOUS les montants de cet écran (cumul, en attente, cycles, lignes).
  const payCurrency = useProject().project.payCurrency;
  const [now] = useState(() => Date.now());
  const payments = useProjectQuery(api.payments.listPayments, {});
  const rows = payments ?? [];
  const total = rows.reduce((s, p) => s + p.totalDue, 0);

  // ── Paiement EN MASSE ──────────────────────────────────────────────────────
  // On boucle sur markCyclePaid (la mutation unitaire déjà en place) : c'est le
  // MÊME chemin de code que le bouton par ligne, donc le gel des montants et
  // l'idempotence (cycle déjà payé → no-op) sont ceux existants. Aucun calcul
  // n'est refait ici, on ne fait que déclencher en masse.
  const markCyclePaid = useProjectMutation(api.payments.markCyclePaid);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);

  const payableRows = useMemo(
    () => (payments ?? []).filter(isBulkPayable),
    [payments],
  );
  const selectedRows = useMemo(
    () => payableRows.filter((p) => selected.has(p.key)),
    [payableRows, selected],
  );
  const payableTotal = payableRows.reduce((s, p) => s + p.remainingDue, 0);
  const selectedTotal = selectedRows.reduce((s, p) => s + p.remainingDue, 0);
  // Vidéos rémunérées dont AUCUNE vue n'a pu être mesurée, sur la sélection.
  // On signale, on ne bloque pas (arbitrage produit) : le bouton reste actif,
  // mais on ne paie plus sans le savoir. Sept vidéos Snytch cumulant 78 476
  // vues réelles ont été payées « 0 vue » faute de cette phrase.
  const selectedUnmeasured = selectedRows.reduce(
    (s, p) => s + (p.pricingBreakdown?.unmeasuredPayablePosts ?? 0),
    0,
  );
  const selectedCreators = new Set(selectedRows.map((p) => p.creatorId)).size;
  const allSelected =
    payableRows.length > 0 && selectedRows.length === payableRows.length;

  // ─── Regroupement PAR CRÉATRICE des cycles encore ouverts ──────────────────
  // Un virement se fait à une PERSONNE : ses cycles, sa méthode et son total
  // tiennent ensemble. Trié par montant dû décroissant — l'écran répond « qui
  // dois-je payer, combien », pas « qu'est-ce qui s'est passé quand ».
  const groupes = useMemo(() => {
    const m = new Map<string, CreatorGroup>();
    for (const p of rows) {
      if (p.status === "paid") continue;
      const k = p.creatorId as string;
      const g = m.get(k) ?? {
        creatorId: k,
        creatorName: p.creatorName,
        paymentMethod: p.creatorPaymentMethod,
        paymentDetails: p.creatorPaymentDetails,
        cycles: [],
        remaining: 0,
      };
      g.cycles.push(p);
      g.remaining = Math.round((g.remaining + p.remainingDue) * 100) / 100;
      m.set(k, g);
    }
    return [...m.values()].sort(
      (a, b) =>
        b.remaining - a.remaining ||
        a.creatorName.localeCompare(b.creatorName, "fr"),
    );
  }, [rows]);
  // Les zéros ne disparaissent pas — ils se replient. Une créatrice à 0 $ qui
  // devrait être payée est une information ; elle ne mérite juste pas une
  // ligne pleine largeur au milieu de celles qui portent 276 $.
  const groupesAvecDu = groupes.filter((g) => g.remaining > 0);
  const groupesAZero = groupes.filter((g) => g.remaining <= 0);
  const [zerosOuverts, setZerosOuverts] = useState(false);
  const cyclesDus = groupesAvecDu.reduce(
    (n, g) => n + g.cycles.filter((c) => c.remainingDue > 0).length,
    0,
  );
  // Depuis combien de jours traîne le plus ancien cycle qui doit encore de
  // l'argent — le seul repère d'urgence de cet écran. `now` est figé au montage
  // (comme ailleurs dans l'app) : une horloge lue en plein rendu n'est pas pure,
  // et le compilateur React refuse de mémoriser autour.
  const debutsDus = groupesAvecDu.flatMap((g) =>
    g.cycles.filter((c) => c.remainingDue > 0).map((c) => c.cycleStart),
  );
  const ageDuPlusVieux =
    debutsDus.length === 0
      ? null
      : Math.floor((now - Math.min(...debutsDus)) / 86_400_000);
  // Historique : le plus récemment payé d'abord.
  const reglees = useMemo(
    () =>
      rows
        .filter((p) => p.status === "paid")
        .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0)),
    [rows],
  );

  /** « Tout payer » : sélectionne SES cycles dus puis ouvre la confirmation —
   *  jamais de virement sans le récap chiffré, quel que soit le bouton cliqué. */
  function payAll(g: CreatorGroup) {
    setSelected(new Set(g.cycles.filter(isBulkPayable).map((c) => c.key)));
    setConfirmOpen(true);
  }

  /** Coche/décoche d'un coup tous les cycles payables d'une créatrice. */
  function toggleCreator(g: CreatorGroup) {
    const keys = g.cycles.filter(isBulkPayable).map((c) => c.key);
    const tous = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (tous) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(payableRows.map((p) => p.key)),
    );
  }

  async function runBulkPay() {
    // Snapshot AVANT la boucle : la query est réactive, les rows payées sortent
    // de payableRows au fil de l'eau — on ne veut pas que la cible bouge.
    const targets = selectedRows.map((p) => ({
      key: p.key,
      creatorId: p.creatorId,
      cycleIndex: p.cycleIndex,
      creatorName: p.creatorName,
    }));
    if (targets.length === 0) return;
    setBulkBusy(true);
    setBulkTotal(targets.length);
    setBulkDone(0);
    let ok = 0;
    const failedKeys: string[] = [];
    const failedNames: string[] = [];
    for (const t of targets) {
      try {
        await markCyclePaid({
          creatorId: t.creatorId,
          cycleIndex: t.cycleIndex,
        });
        ok++;
      } catch {
        // Cas partiel : on continue, l'échec n'annule pas les cycles déjà passés.
        failedKeys.push(t.key);
        failedNames.push(t.creatorName);
      }
      setBulkDone((d) => d + 1);
    }
    // Ne restent sélectionnés que les échecs → retry en un clic.
    setSelected(new Set(failedKeys));
    setBulkBusy(false);
    setConfirmOpen(false);
    if (ok > 0) {
      toast.success(
        `${ok} cycle${ok > 1 ? "s" : ""} marqué${ok > 1 ? "s" : ""} payé${ok > 1 ? "s" : ""}.`,
      );
    }
    if (failedNames.length > 0) {
      toast.error(
        `${failedNames.length} échec${failedNames.length > 1 ? "s" : ""} : ${failedNames
          .slice(0, 3)
          .join(", ")}${failedNames.length > 3 ? "…" : ""}`,
      );
    }
  }

  return (
    <div className="space-y-6">
      <PayCurrencyWarning payCurrency={payCurrency} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Paiements
          </h1>
          <p className="text-sm text-slate-500">
            {payments === undefined
              ? "Chargement…"
              : rows.length === 0
                ? "Aucun paiement pour l'instant."
                : `${rows.length} cycle${rows.length > 1 ? "s" : ""} · ${formatMoney(total, payCurrency)} au total sur l'historique`}
          </p>
          <p className="text-xs text-slate-400">
            Cycles de 30 jours propres à chaque créateur (ancrés sur son 1er
            post).
          </p>
        </div>
        {rows.length > 0 && (
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv("paiements-cycles.csv", [
                [
                  "Créateur",
                  "Email",
                  "Méthode",
                  "Coordonnées",
                  "Cycle",
                  // Devise venue de la DONNÉE, jamais d'un littéral : l'en-tête
                  // annonçait « (€) » au-dessus de montants en dollars.
                  //
                  // UNE devise pour TOUTE la colonne — l'en-tête ne peut mentir
                  // que si l'export mélangeait des projets. Il ne le peut pas :
                  // `listPayments` est un adminQuery borné à ctx.projectId, les
                  // créateurs sont lus by_project (convex/payments.ts:657) et
                  // même les lignes ORPHELINES (fiche supprimée) passent par
                  // by_project_period (:688). Une ligne du CSV vient donc
                  // toujours du projet courant, dont `payCurrency` est la devise.
                  //
                  // Aucune garde d'exécution n'est posée ici, et c'est délibéré :
                  // elle ne pourrait pas se déclencher. Les lignes ne portent ni
                  // projectId ni devise (la table `payments` n'a aucun champ
                  // currency), il n'y a donc rien à comparer — ce serait une
                  // garde aveugle de plus, du même genre que le currencyCount
                  // corrigé en #76.
                  //
                  // CE QUI RENDRAIT L'EN-TÊTE FAUX : un export cross-projet. Il
                  // faudrait alors une devise PAR LIGNE, donc d'abord une devise
                  // sur la donnée de paie — c'est la décision D1 du backlog, pas
                  // un correctif d'affichage.
                  moneyColumnHeader("Total dû", payCurrency),
                  "Statut",
                ],
                ...rows.map((p) => [
                  p.creatorName,
                  p.creatorEmail,
                  p.creatorPaymentMethod
                    ? (PAYMENT_METHOD_LABELS[p.creatorPaymentMethod] ??
                      p.creatorPaymentMethod)
                    : "",
                  p.creatorPaymentDetails ?? "",
                  formatCycleRange(p.cycleStart, p.cycleEnd),
                  String(p.totalDue),
                  p.status,
                ]),
              ])
            }
          >
            <DownloadIcon className="mr-2 size-4" />
            Export CSV
          </Button>
        )}
      </header>

      {/* Revenu Whop NET entrant (rentabilité P2) — visible si le projet a un
          mapping Whop. Le net (après frais Whop) est le chiffre de pilotage. */}
      {/* Revenu et marge = `business.read`, un bloc DIFFÉRENT de celui de la
          page. Quelqu'un peut porter la paie sans le chiffre d'affaires. */}
      {droitsNav.has("business.read") && <WhopRevenueCard />}

      {/* Rentabilité (rentabilité P3) — revenu net vs coût créateurs → marge,
          RPM business, toggle warmup (recalcule les vues/RPM, pas le revenu). */}
      {droitsNav.has("business.read") && <ProfitabilityCard />}

      {payments === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-slate-500">
            Les paiements apparaîtront ici dès la première publication des
            créateurs.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ─── BANDEAU DU DÛ ───────────────────────────────────────────────
              La question de l'ouverture : combien je dois sortir, à combien de
              personnes, et depuis combien de temps ça traîne. Le reste (ce qui
              est déjà réglé) vit plus bas. */}
          {payableRows.length > 0 && (
            <div
              className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4"
              data-testid="due-banner"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Reste à payer
                </p>
                <p className="text-3xl font-semibold tabular-nums text-slate-900">
                  {formatMoney(payableTotal, payCurrency)}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  <span className="font-medium text-slate-900">
                    {groupesAvecDu.length}
                  </span>{" "}
                  créatrice{groupesAvecDu.length > 1 ? "s" : ""} ·{" "}
                  <span className="font-medium text-slate-900">
                    {cyclesDus}
                  </span>{" "}
                  cycle{cyclesDus > 1 ? "s" : ""}
                  {/* « depuis 0 jour » ne dit rien : le repère d'ancienneté
                      n'apparaît qu'à partir d'un jour entier. */}
                  {ageDuPlusVieux !== null && ageDuPlusVieux >= 1 && (
                    <>
                      {" "}
                      · le plus ancien ouvert depuis{" "}
                      <span className="font-medium text-slate-900">
                        {ageDuPlusVieux} jour{ageDuPlusVieux > 1 ? "s" : ""}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAll}
                  disabled={bulkBusy}
                  data-testid="select-all-due"
                >
                  {allSelected
                    ? "Tout désélectionner"
                    : `Tout ce qui est dû (${payableRows.length})`}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={selectedRows.length === 0 || bulkBusy}
                  data-testid="bulk-mark-paid"
                >
                  {bulkBusy && (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  )}
                  {selectedRows.length === 0
                    ? "Marquer payé"
                    : `Payer les ${selectedRows.length} sélectionnés · ${formatMoney(selectedTotal, payCurrency)}`}
                </Button>
              </div>
            </div>
          )}

          {/* ─── À PAYER — un bloc par créatrice ────────────────────────────
              Un virement se fait à une PERSONNE, pas à un cycle : ses cycles
              ouverts, sa méthode et son total tiennent dans le même bloc. */}
          {groupesAvecDu.length > 0 && (
            <section className="space-y-3" aria-label="Cycles à payer">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  À payer
                </h2>
                <p className="text-xs text-slate-400">
                  Trié par montant dû.
                </p>
              </div>
              {groupesAvecDu.map((g) => (
                <CreatorCard
                  key={g.creatorId}
                  group={g}
                  currency={payCurrency}
                  selected={selected}
                  onToggleCycle={toggleRow}
                  onToggleCreator={() => toggleCreator(g)}
                  onPayAll={() => payAll(g)}
                  selectionDisabled={bulkBusy}
                />
              ))}
            </section>
          )}

          {/* ─── LES ZÉROS ──────────────────────────────────────────────────
              Repliés, pas supprimés : une créatrice à 0 $ qui devrait être
              payée est une information — elle ne mérite juste pas douze lignes. */}
          {groupesAZero.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setZerosOuverts((v) => !v)}
                aria-expanded={zerosOuverts}
                className="flex w-full items-center gap-1.5 rounded-lg px-1 py-2 text-left text-sm text-slate-400 hover:text-slate-700"
                data-testid="zeros-fold"
              >
                <ChevronRightIcon
                  className={cn(
                    "size-4 transition-transform",
                    zerosOuverts && "rotate-90",
                  )}
                />
                {groupesAZero.length} créatrice
                {groupesAZero.length > 1 ? "s" : ""} à{" "}
                {formatMoney(0, payCurrency)} sur leur cycle en cours
                <span className="truncate text-slate-300">
                  — {groupesAZero.map((g) => g.creatorName).join(", ")}
                </span>
              </button>
              {zerosOuverts && (
                <div className="space-y-3">
                  {groupesAZero.map((g) => (
                    <CreatorCard
                      key={g.creatorId}
                      group={g}
                      currency={payCurrency}
                      selected={selected}
                      onToggleCycle={toggleRow}
                      onToggleCreator={() => toggleCreator(g)}
                      onPayAll={() => payAll(g)}
                      selectionDisabled={bulkBusy}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── RÉGLÉ ──────────────────────────────────────────────────────
              L'historique, hors du chemin. C'est ici que vit l'annulation. */}
          {reglees.length > 0 && (
            <section className="space-y-2" aria-label="Cycles réglés">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Réglé
                </h2>
                <p className="text-xs text-slate-400">
                  Une annulation par cycle, et une seule.
                </p>
              </div>
              <Card>
                <CardContent className="divide-y divide-slate-100 p-0">
                  {reglees.map((p) => (
                    <PaidRow key={p.key} p={p} currency={payCurrency} />
                  ))}
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}

      {/* Confirmation — c'est de l'argent : récap chiffré avant exécution. */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !bulkBusy && setConfirmOpen(o)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Marquer {selectedRows.length} cycle
              {selectedRows.length > 1 ? "s" : ""} comme payé
              {selectedRows.length > 1 ? "s" : ""} ?
            </DialogTitle>
            <DialogDescription>
              {selectedCreators} créateur{selectedCreators > 1 ? "s" : ""} ·
              total {formatMoney(selectedTotal, payCurrency)}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              Le montant de chaque cycle est <strong>gelé</strong> au moment du
              paiement (fixe, CPM et paliers bonus) : il ne sera plus recalculé
              ensuite.
            </p>
            {selectedUnmeasured > 0 && (
              <p
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
                data-testid="unmeasured-warning"
              >
                <strong>
                  {selectedUnmeasured} vidéo{selectedUnmeasured > 1 ? "s" : ""}{" "}
                  rémunérée{selectedUnmeasured > 1 ? "s" : ""} sans vue mesurée.
                </strong>{" "}
                Leur collecte a échoué ou n&apos;a pas encore eu lieu : elles
                comptent pour 0 vue dans le CPM. Le paiement reste possible —
                c&apos;est un signalement, pas un blocage.
              </p>
            )}
            <p className="text-xs text-slate-500">
              Les cycles déjà payés ne sont pas retouchés. Un cycle qui échoue
              n&apos;interrompt pas les autres et reste sélectionné.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={bulkBusy}
            >
              Annuler
            </Button>
            <Button
              onClick={runBulkPay}
              disabled={bulkBusy || selectedRows.length === 0}
              data-testid="bulk-mark-paid-confirm"
            >
              {bulkBusy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {bulkBusy
                ? `Traitement… ${bulkDone}/${bulkTotal}`
                : `Confirmer · ${formatMoney(selectedTotal, payCurrency)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * ACOMPTE — verser une partie d'un cycle encore ouvert.
 *
 * Le cycle ne se ferme pas et son montant continue de suivre les vues : la
 * modale le DIT, parce que c'est exactement ce qui surprend (« j'ai noté 100 $,
 * pourquoi le reste a bougé ? »). Le reste affiché est toujours « dû du jour
 * moins déjà versé ».
 */
function AdvanceButton({
  row,
  currency,
}: {
  row: Payment;
  currency?: string | null;
}) {
  const recordAdvance = useProjectMutation(api.payments.recordAdvance);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = Number(amount.replace(",", "."));
  const valide = Number.isFinite(parsed) && parsed > 0;
  const dejaVerse = row.advances.reduce((s, a) => s + a.amount, 0);

  async function submit() {
    setBusy(true);
    try {
      await recordAdvance({
        creatorId: row.creatorId,
        cycleIndex: row.cycleIndex,
        amount: parsed,
      });
      toast.success(`Acompte de ${formatMoney(parsed, currency)} enregistré.`);
      setOpen(false);
      setAmount("");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-xs text-slate-500 hover:text-slate-900"
        onClick={() => setOpen(true)}
        data-testid={`advance-${row.key}`}
      >
        Payer une partie…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payer une partie — {row.creatorName}</DialogTitle>
            <DialogDescription>
              Cycle du {formatCycleRange(row.cycleStart, row.cycleEnd)}. Le cycle
              reste ouvert : son montant continue de suivre les vues, donc le
              reste bougera encore.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="advance-amount" className="text-xs text-slate-500">
              Montant versé maintenant
            </label>
            <Input
              id="advance-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              autoFocus
            />
          </div>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <BreakdownLine
              label="Dû à cet instant"
              amount={row.totalDue}
              currency={currency}
            />
            <BreakdownLine
              label="Déjà versé"
              amount={dejaVerse}
              currency={currency}
            />
            <BreakdownLine
              label="Reste après ce versement"
              amount={Math.max(
                0,
                Math.round((row.remainingDue - (valide ? parsed : 0)) * 100) /
                  100,
              )}
              currency={currency}
            />
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={submit} disabled={busy || !valide}>
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Enregistrer le versement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * ANNULER un paiement posé par erreur — une fois, et une seule.
 *
 * La modale annonce l'e-mail de correction AVANT le clic : la créatrice a reçu
 * « tu as été payée », elle recevra « en fait non ». Ce n'est pas un détail
 * d'implémentation, c'est le geste que l'admin doit assumer.
 */
function RevertButton({
  row,
  currency,
}: {
  row: Payment;
  currency?: string | null;
}) {
  const revert = useProjectMutation(api.payments.revertCyclePayment);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!row.canRevert || row.paymentId === null) {
    return (
      <span className="text-xs text-slate-400">
        {row.paymentId !== null && row.status === "paid" ? "Payé" : "Payé"}
      </span>
    );
  }

  async function submit() {
    setBusy(true);
    try {
      await revert({ id: row.paymentId! });
      toast.success("Paiement annulé — le cycle redevient dû.");
      setOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-xs text-rose-600 hover:text-rose-700"
        onClick={() => setOpen(true)}
        data-testid={`revert-${row.key}`}
      >
        Annuler
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler le paiement — {row.creatorName}</DialogTitle>
            <DialogDescription>
              Cycle du {formatCycleRange(row.cycleStart, row.cycleEnd)}, marqué
              payé pour {formatMoney(row.totalDue, currency)}. Il redevient dû
              dans l&apos;état exact d&apos;avant le paiement.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border-l-4 border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            Un e-mail de correction part à {row.creatorName} : elle avait reçu
            l&apos;e-mail de paiement. Et c&apos;est la SEULE annulation
            possible sur ce cycle.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Retour
            </Button>
            <Button variant="destructive" onClick={submit} disabled={busy}>
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Annuler ce paiement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * UN BLOC PAR CRÉATRICE — son total dû, sa méthode de virement, et ses cycles
 * ouverts en dessous.
 *
 * C'est le groupement que l'écran plat n'avait pas : un virement se fait à une
 * PERSONNE. Ses trois cycles ouverts éparpillés dans une liste triée par date
 * obligeaient à additionner de tête avant d'ouvrir sa banque — et à faire trois
 * virements là où un seul suffit.
 */
function CreatorCard({
  group,
  currency,
  selected,
  onToggleCycle,
  onToggleCreator,
  onPayAll,
  selectionDisabled,
}: {
  group: CreatorGroup;
  currency?: string | null;
  selected: Set<string>;
  onToggleCycle: (key: string) => void;
  onToggleCreator: () => void;
  onPayAll: () => void;
  selectionDisabled: boolean;
}) {
  const payables = group.cycles.filter(isBulkPayable);
  const tousChoisis =
    payables.length > 0 && payables.every((c) => selected.has(c.key));

  return (
    <Card data-testid={`creator-card-${group.creatorId}`}>
      <CardContent className="p-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
          {payables.length > 0 && (
            <Checkbox
              checked={tousChoisis}
              onCheckedChange={onToggleCreator}
              disabled={selectionDisabled}
              aria-label={`Sélectionner les cycles dus de ${group.creatorName}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-900">
              {group.creatorName}
            </p>
            <p className="truncate text-xs text-slate-500">
              {group.paymentMethod
                ? (PAYMENT_METHOD_LABELS[group.paymentMethod] ??
                  group.paymentMethod)
                : "méthode non renseignée"}
              {group.paymentDetails ? ` · ${group.paymentDetails}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums text-slate-900">
              {formatMoney(group.remaining, currency)}
            </p>
            <p className="text-[11px] text-slate-400">
              {group.cycles.length} cycle
              {group.cycles.length > 1 ? "s" : ""} ouvert
              {group.cycles.length > 1 ? "s" : ""}
            </p>
          </div>
          {/* « Tout payer » n'apparaît qu'à partir de DEUX cycles dus : avec un
              seul, il ferait doublon avec le bouton de la ligne juste en
              dessous, pour exactement le même geste. */}
          {payables.length > 1 && (
            <Button
              size="sm"
              onClick={onPayAll}
              disabled={selectionDisabled}
              data-testid={`pay-all-${group.creatorId}`}
            >
              Tout payer
            </Button>
          )}
        </header>
        <div className="divide-y divide-slate-100">
          {group.cycles.map((p) => (
            <CycleRow
              key={p.key}
              p={p}
              currency={currency}
              selectable={isBulkPayable(p)}
              checked={selected.has(p.key)}
              onToggle={() => onToggleCycle(p.key)}
              selectionDisabled={selectionDisabled}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** UN CYCLE OUVERT dans le bloc d'une créatrice : ce qu'il reste, ce qui rend
 *  le montant incertain, et les deux gestes (acompte, solde). Le détail des
 *  lignes s'ouvre au clic — il ne sert qu'à vérifier, pas à décider. */
function CycleRow({
  p,
  currency,
  selectable,
  checked,
  onToggle,
  selectionDisabled,
}: {
  p: Payment;
  currency?: string | null;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  selectionDisabled: boolean;
}) {
  const markCyclePaid = useProjectMutation(api.payments.markCyclePaid);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const avances = p.advances.reduce((s, a) => s + a.amount, 0);
  const nonMesurees = p.pricingBreakdown?.unmeasuredPayablePosts ?? 0;

  async function onMarkPaid() {
    setBusy(true);
    try {
      await markCyclePaid({ creatorId: p.creatorId, cycleIndex: p.cycleIndex });
      toast.success("Cycle marqué payé.");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={`cycle-${p.key}`}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        {selectable ? (
          <Checkbox
            checked={checked}
            onCheckedChange={onToggle}
            disabled={selectionDisabled}
            aria-label={`Sélectionner le cycle du ${formatCycleRange(p.cycleStart, p.cycleEnd)}`}
          />
        ) : (
          <span className="size-4" />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="flex items-center gap-1.5 text-sm text-slate-800">
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 text-slate-300 transition-transform",
                open && "rotate-90",
              )}
            />
            {formatCycleRange(p.cycleStart, p.cycleEnd)}
          </p>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 pl-5">
            {avances > 0 && (
              <span
                className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
                title={p.advances
                  .map(
                    (a) =>
                      `${formatMoney(a.amount, currency)} le ${new Date(a.at).toLocaleDateString("fr-FR")}`,
                  )
                  .join(" · ")}
                data-testid={`advance-badge-${p.key}`}
              >
                acompte {formatMoney(avances, currency)} · sur{" "}
                {formatMoney(p.totalDue, currency)}
              </span>
            )}
            {nonMesurees > 0 && (
              // Repère AVANT la sélection : la modale dit le total, cette
              // pastille dit CHEZ QUI. Sans elle, l'avertissement serait vrai
              // mais inutile.
              <span
                className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900"
                title={`${nonMesurees} vidéo(s) rémunérée(s) sans vue mesurée — comptée(s) 0 vue dans le CPM`}
              >
                {nonMesurees} non mesurée{nonMesurees > 1 ? "s" : ""}
              </span>
            )}
            {/* TALENTS — ce que le cycle a produit, à côté de ce qu'il coûte.
                Le forfait est dû parce que le cycle a couru ; « 0 rush » est le
                cas qui compte, c'est celui où l'admin ne paiera pas. */}
            {p.rushCount !== null && (
              <span className="text-[11px] text-slate-400">
                {p.rushCount} rush{p.rushCount > 1 ? "es" : ""}
              </span>
            )}
          </span>
        </button>
        <p className="text-right font-medium tabular-nums text-slate-900">
          {formatMoney(p.remainingDue, currency)}
          {avances > 0 && (
            <span className="block text-[11px] font-normal text-slate-400">
              sur {formatMoney(p.totalDue, currency)}
            </span>
          )}
        </p>
        <div className="flex items-center justify-end gap-1.5">
          <AdvanceButton row={p} currency={currency} />
          <Button
            size="sm"
            variant="outline"
            onClick={onMarkPaid}
            disabled={busy}
            data-testid={`mark-paid-${p.key}`}
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {avances > 0 ? "Solder" : "Marquer payé"}
          </Button>
        </div>
      </div>
      {open && <CycleDetail p={p} currency={currency} />}
    </div>
  );
}

/** UN CYCLE RÉGLÉ : montant versé, date, et l'annulation (une fois). */
function PaidRow({ p, currency }: { p: Payment; currency?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`cycle-${p.key}`}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-slate-300 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-slate-800">
              {p.creatorName}
            </span>
            <span className="block truncate text-xs text-slate-500">
              {formatCycleRange(p.cycleStart, p.cycleEnd)}
              {p.paidAt !== null && (
                <> · payé le {new Date(p.paidAt).toLocaleDateString("fr-FR")}</>
              )}
            </span>
          </span>
        </button>
        <p className="text-right font-medium tabular-nums text-slate-900">
          {formatMoney(p.totalDue, currency)}
        </p>
        <RevertButton row={p} currency={currency} />
      </div>
      {open && <CycleDetail p={p} currency={currency} />}
    </div>
  );
}

/** Le DÉTAIL d'un cycle : ventilation du barème puis lignes de paie. Identique
 *  pour un cycle ouvert et un cycle réglé — c'est la même donnée. */
function CycleDetail({
  p,
  currency,
}: {
  p: Payment;
  currency?: string | null;
}) {
  return (
    <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 pl-12">
      {p.pricingBreakdown.total > 0 && (
        <ul className="space-y-1 text-sm">
          <BreakdownLine
            label="Fixe (vidéos publiées)"
            amount={p.pricingBreakdown.fixedTotal}
            currency={currency}
          />
          <BreakdownLine
            label="CPM (vues cumulées)"
            amount={p.pricingBreakdown.cpmTotal}
            currency={currency}
          />
          {p.pricingBreakdown.bonusTierCashTotal > 0 && (
            <BreakdownLine
              label="Bonus paliers (cash)"
              amount={p.pricingBreakdown.bonusTierCashTotal}
              currency={currency}
            />
          )}
        </ul>
      )}
      {p.lineItems.length > 0 && (
        <ul className="space-y-1">
          {p.lineItems.map((li, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="flex items-center gap-2 text-slate-600">
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase",
                    KIND_BADGE[li.kind] ?? KIND_BADGE.base,
                  )}
                >
                  {KIND_LABEL[li.kind] ?? "Base"}
                </span>
                {li.label}
              </span>
              <span className="tabular-nums text-slate-700">
                {formatMoney(li.amount, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.advances.length > 0 && (
        <ul className="space-y-1 border-t border-slate-200 pt-2">
          {p.advances.map((a, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 text-sm text-primary"
            >
              <span>
                Acompte versé le{" "}
                {new Date(a.at).toLocaleDateString("fr-FR")}
              </span>
              <span className="tabular-nums">
                − {formatMoney(a.amount, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.lineItems.length === 0 && p.pricingBreakdown.total <= 0 && (
        <p className="text-sm text-slate-400">Aucune ligne.</p>
      )}
    </div>
  );
}

/**
 * Garde d'écran : payments.manage. Le menu ne propose plus cette page à qui n'a pas le
 * bloc, mais son URL répond toujours — sans cette enveloppe, y arriver par un
 * favori déclenche les queries de la page, qui lèvent, et on lit une erreur
 * technique au lieu d'une phrase.
 *
 * ⚠️ Ce n'est PAS la barrière : le serveur refuse déjà chaque appel.
 */
export default function PaiementsPage() {
  return (
    <PermissionGate bloc="payments.manage">
      <PaiementsPageContenu />
    </PermissionGate>
  );
}
