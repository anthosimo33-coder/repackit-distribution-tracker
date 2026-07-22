"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { WhopRevenueCard } from "@/components/whop/WhopRevenueCard";
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
 */

type Payment = FunctionReturnType<typeof api.payments.listPayments>[number];

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

function BreakdownLine({ label, amount }: { label: string; amount: number }) {
  return (
    <li className="flex items-center justify-between gap-4 text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums text-slate-700">{formatMoney(amount)}</span>
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

const csvEscape = (v: string) => `"${v.replace(/"/g, '""')}"`;

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  // BOM pour qu'Excel ouvre l'UTF-8 correctement.
  const blob = new Blob(["﻿" + content], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export default function PaiementsPage() {
  const payments = useProjectQuery(api.payments.listPayments, {});
  const rows = payments ?? [];
  const total = rows.reduce((s, p) => s + p.totalDue, 0);
  const unpaidTotal = rows
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + p.totalDue, 0);

  return (
    <div className="space-y-6">
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
                : `${rows.length} cycle${rows.length > 1 ? "s" : ""} · ${formatMoney(total)} dû (${formatMoney(unpaidTotal)} en attente)`}
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
                  "Total dû ($)",
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
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                  <PaymentRow key={p.key} p={p} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaymentRow({ p }: { p: Payment }) {
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
          {formatMoney(p.totalDue)}
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
          <TableCell />
          <TableCell colSpan={6} className="space-y-2 py-2">
            {p.pricingBreakdown.total > 0 && (
              <ul className="space-y-1 text-sm">
                <BreakdownLine
                  label="Fixe (vidéos publiées)"
                  amount={p.pricingBreakdown.fixedTotal}
                />
                <BreakdownLine
                  label="CPM (vues cumulées)"
                  amount={p.pricingBreakdown.cpmTotal}
                />
                {p.pricingBreakdown.bonusTierCashTotal > 0 && (
                  <BreakdownLine
                    label="Bonus paliers (cash)"
                    amount={p.pricingBreakdown.bonusTierCashTotal}
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
                      {formatMoney(li.amount)}
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
