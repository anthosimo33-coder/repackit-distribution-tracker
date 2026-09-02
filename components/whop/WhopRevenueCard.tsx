"use client";

import { useState } from "react";

import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MixedCurrencyNotice } from "@/components/MixedCurrencyNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format-rate";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  InfoIcon,
  Loader2Icon,
  RefreshCwIcon,
  WalletIcon,
} from "lucide-react";

/**
 * "2026-07" → "juillet 2026" (fr-FR). La clé vient du serveur, déjà découpée en
 * mois EUROPE/PARIS (convex/dateFr `monthKeyParis`) : ici on ne fait que rendre
 * une clé lisible, l'UTC de `Date.UTC`/`timeZone` ne sert qu'à neutraliser le
 * fuseau du navigateur sur un 1er du mois — il ne redécoupe rien.
 */
function formatMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Revenu Whop NET (après frais Whop) du projet — carte affichée en tête des
 * Paiements (rentabilité P2). Le NET est le chiffre de pilotage, clairement
 * libellé « net (après frais Whop) » ; brut + frais + remboursements accessibles.
 * Rendue UNIQUEMENT si le projet a un mapping Whop (getWhopRevenue.configured).
 */
export function WhopRevenueCard() {
  const data = useProjectQuery(api.whopSync.getWhopRevenue, {});
  const requestSync = useProjectMutation(api.whopSync.requestWhopSync);
  const [syncing, setSyncing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (data === undefined) return <Skeleton className="h-40 w-full" />;
  // Projet sans mapping Whop → on n'affiche rien (pas de bruit sur les autres projets).
  if (!data.configured) return null;

  const current = data.months.find(
    (m) => m.period === data.currentPeriod,
  )?.summary;
  const net = current?.net ?? 0;
  const gross = current?.gross ?? 0;
  const fees = current?.fees ?? 0;
  const refunded = current?.refunded ?? 0;
  const count = current?.paymentCount ?? 0;
  // Revenu Whop : la devise vient de la donnée (jamais un défaut). Mois multi-devise
  // → currency null → montants sans symbole (jamais mélanger).
  const currency = current?.currency ?? null;
  // A5 — le drapeau du mois courant et celui du projet entier : un mois peut
  // être mono-devise dans un projet qui, lui, ne l'est pas.
  const mixedCurrency = current?.mixedCurrency ?? data.total.mixedCurrency;
  const mixedPresent = data.total.mixedCurrencyPresent;
  const history = data.months
    .filter((m) => m.period !== data.currentPeriod)
    .slice(0, 6);

  async function onSync() {
    setSyncing(true);
    try {
      const r = await requestSync({});
      toast.success(
        r.scheduled
          ? "Synchronisation Whop lancée — les montants se mettent à jour."
          : "Whop n'est pas configuré pour ce projet.",
      );
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la synchronisation Whop."));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardContent className="space-y-4 p-5">
        <MixedCurrencyNotice
          mixed={mixedCurrency}
          present={mixedPresent}
          currencies={data.total.currenciesPresent}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
            <WalletIcon className="size-4" />
            Revenu Whop — {formatMonth(data.currentPeriod)}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="mr-2 size-4" />
            )}
            Synchroniser
          </Button>
        </div>

        <div>
          <div className="text-3xl font-semibold tracking-tight text-slate-900">
            {formatMoney(net, currency)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <InfoIcon className="size-3.5" />
            Net — après frais Whop
            {count > 0 && ` · ${count} paiement${count > 1 ? "s" : ""}`}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span>
            Brut&nbsp;:{" "}
            <span className="font-medium text-slate-700">
              {formatMoney(gross, currency)}
            </span>
          </span>
          <span>
            Frais Whop&nbsp;:{" "}
            <span className="font-medium text-slate-700">
              −{formatMoney(fees, currency)}
            </span>
          </span>
          {refunded > 0 && (
            <span>
              Remboursements&nbsp;:{" "}
              <span className="font-medium text-slate-700">
                −{formatMoney(refunded, currency)}
              </span>
            </span>
          )}
        </div>

        {count === 0 && (
          <p className="text-xs text-slate-400">
            Aucun paiement Whop importé ce mois-ci. L&apos;ingestion tourne chaque
            heure.
          </p>
        )}

        {history.length > 0 && (
          <div className="border-t border-emerald-200/70 pt-3">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              {showHistory ? "Masquer" : "Voir"} l&apos;historique ({history.length}{" "}
              mois)
            </button>
            {showHistory && (
              <ul className="mt-2 space-y-1">
                {history.map((m) => (
                  <li
                    key={m.period}
                    className="flex items-center justify-between text-xs text-slate-600"
                  >
                    <span>{formatMonth(m.period)}</span>
                    <span className="tabular-nums">
                      <span className="font-medium text-slate-800">
                        {formatMoney(m.summary.net, m.summary.currency)}
                      </span>
                      <span className="text-slate-400">
                        {" "}
                        net · brut {formatMoney(m.summary.gross, m.summary.currency)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
