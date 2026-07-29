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
import { formatMoney } from "@/lib/format-rate";
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
};
const KIND_BADGE: Record<string, string> = {
  base: "bg-slate-200 text-slate-600",
  bonus: "bg-indigo-50 text-indigo-600",
  fixed: "bg-emerald-50 text-emerald-600",
  cpm: "bg-sky-50 text-sky-600",
  bonus_tier: "bg-amber-50 text-amber-600",
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

export default function PaiementsPage() {
  // Devise de la PAIE créatrices (dollars, projects.payCurrency) — appliquée à
  // TOUS les montants de cet écran (cumul, en attente, cycles, lignes).
  const payCurrency = useProject().project.payCurrency;
  const payments = useProjectQuery(api.payments.listPayments, {});
  const rows = payments ?? [];
  const total = rows.reduce((s, p) => s + p.totalDue, 0);
  const unpaidTotal = rows
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + p.totalDue, 0);

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
  const payableTotal = payableRows.reduce((s, p) => s + p.totalDue, 0);
  const selectedTotal = selectedRows.reduce((s, p) => s + p.totalDue, 0);
  const selectedCreators = new Set(selectedRows.map((p) => p.creatorId)).size;
  const allSelected =
    payableRows.length > 0 && selectedRows.length === payableRows.length;

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
                : `${rows.length} cycle${rows.length > 1 ? "s" : ""} · ${formatMoney(total, payCurrency)} dû (${formatMoney(unpaidTotal, payCurrency)} en attente)`}
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
                  "Total dû (€)",
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
      <WhopRevenueCard />

      {/* Rentabilité (rentabilité P3) — revenu net vs coût créateurs → marge,
          RPM business, toggle warmup (recalcule les vues/RPM, pas le revenu). */}
      <ProfitabilityCard />

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
          {/* Barre de paiement en masse — visible dès qu'au moins un cycle est
              dû. « Tout ce qui est dû » sélectionne tous les cycles payables. */}
          {payableRows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-sm text-slate-600">
                {selectedRows.length === 0 ? (
                  <>
                    {payableRows.length} cycle
                    {payableRows.length > 1 ? "s" : ""} dû
                    {payableRows.length > 1 ? "s" : ""} ·{" "}
                    <span className="font-medium text-slate-900">
                      {formatMoney(payableTotal, payCurrency)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-slate-900">
                      {selectedRows.length}
                    </span>{" "}
                    cycle{selectedRows.length > 1 ? "s" : ""} sélectionné
                    {selectedRows.length > 1 ? "s" : ""} ·{" "}
                    <span className="font-medium text-slate-900">
                      {formatMoney(selectedTotal, payCurrency)}
                    </span>
                  </>
                )}
              </p>
              <div className="flex items-center gap-2">
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
                  Marquer payé ({selectedRows.length})
                </Button>
              </div>
            </div>
          )}

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      {payableRows.length > 0 && (
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleAll}
                          disabled={bulkBusy}
                          aria-label="Sélectionner tous les cycles dus"
                        />
                      )}
                    </TableHead>
                    <TableHead className="w-8" />
                    <TableHead>Créateur</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Méthode</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Total dû</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <PaymentRow
                      key={p.key}
                      p={p}
                      currency={payCurrency}
                      selectable={isBulkPayable(p)}
                      checked={selected.has(p.key)}
                      onToggle={() => toggleRow(p.key)}
                      selectionDisabled={bulkBusy}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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

function PaymentRow({
  p,
  currency,
  selectable,
  checked,
  onToggle,
  selectionDisabled,
}: {
  p: Payment;
  /** Devise de la PAIE créatrices (dollars) — montant du cycle + lignes. */
  currency?: string | null;
  /** false pour un cycle déjà payé ou une row orpheline (cf isBulkPayable). */
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  selectionDisabled: boolean;
}) {
  const markCyclePaid = useProjectMutation(api.payments.markCyclePaid);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const badge = STATUS_BADGE[p.status] ?? STATUS_BADGE.accruing;

  async function onMarkPaid() {
    setBusy(true);
    try {
      await markCyclePaid({ creatorId: p.creatorId, cycleIndex: p.cycleIndex });
      toast.success(`${p.creatorName} — cycle marqué payé.`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Paiement impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        data-testid={`payment-${p.key}`}
      >
        <TableCell onClick={(e) => e.stopPropagation()}>
          {selectable && (
            <Checkbox
              checked={checked}
              onCheckedChange={onToggle}
              disabled={selectionDisabled}
              aria-label={`Sélectionner le cycle de ${p.creatorName}`}
              data-testid={`select-${p.key}`}
            />
          )}
        </TableCell>
        <TableCell>
          <ChevronRightIcon
            className={cn(
              "size-4 text-slate-400 transition-transform",
              open && "rotate-90",
            )}
          />
        </TableCell>
        <TableCell className="font-medium text-slate-900">
          {p.creatorName}
        </TableCell>
        <TableCell className="text-sm text-slate-600">
          {formatCycleRange(p.cycleStart, p.cycleEnd)}
        </TableCell>
        <TableCell className="text-sm text-slate-600">
          {p.creatorPaymentMethod
            ? (PAYMENT_METHOD_LABELS[p.creatorPaymentMethod] ??
              p.creatorPaymentMethod)
            : "—"}
        </TableCell>
        <TableCell>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums text-slate-900">
          {formatMoney(p.totalDue, currency)}
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          {p.status === "paid" ? (
            <span className="text-xs text-slate-400">Payé</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onMarkPaid}
              disabled={busy}
              data-testid={`mark-paid-${p.key}`}
            >
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Marquer payé
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-slate-50/60">
          {/* 2 cellules vides = colonnes sélection + chevron (8 au total). */}
          <TableCell />
          <TableCell />
          <TableCell colSpan={6} className="space-y-2 py-2">
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
            {p.lineItems.length === 0 && p.pricingBreakdown.total <= 0 && (
              <p className="text-sm text-slate-400">Aucune ligne.</p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
