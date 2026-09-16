"use client";

import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format-rate";
import { pctFromFraction } from "@/lib/percent";
import type { MarketDerived } from "@/lib/market-aggregate";
import {
  DECISION,
  type MarketDecision,
  type MarketVerdict,
} from "@/lib/market-decision";
import { VERDICT_UI, compactViews, returnLabel } from "./marketVerdictUi";

export type DecidedMarket = MarketDerived & { decision: MarketDecision };

/**
 * EN TÊTE DE L'ONGLET PAYS — le résumé, les alertes, puis la décision.
 *
 * Tout ce qui est plus bas (tableau, nuage, analyses) sert à VÉRIFIER ce bloc.
 * Les seuils de chaque colonne sont écrits sur la colonne : un verdict dont on
 * ne voit pas la règle se discute au lieu de se lire.
 */
export function MarketDecisionBoard({
  marches,
  devise,
  onOpen,
}: {
  marches: DecidedMarket[];
  devise: string | null;
  onOpen: (key: string) => void;
}) {
  const argent = (n: number | null) =>
    n === null ? "—" : formatMoney(n, devise ?? undefined);

  // ── Résumé : des SOMMES, divisées une fois ─────────────────────────────
  const vues = marches.reduce((s, m) => s + m.promoViews, 0);
  const coutsConnus = marches.every(
    (m) => m.promoCost === 0 || m.promoCostComparable !== null,
  );
  const cout = coutsConnus
    ? marches.reduce((s, m) => s + (m.promoCostComparable ?? 0), 0)
    : null;
  const valeur = marches.reduce((s, m) => s + (m.acquisitionValue?.amount ?? 0), 0);
  const revenu = marches.reduce((s, m) => s + m.revenueNet, 0);
  const pour1000 = (n: number | null) => (n === null || vues <= 0 ? null : (n / vues) * 1000);
  const retour = cout !== null && cout > 0 ? valeur / cout : null;

  const reel = marches.filter((m) => m.key !== "");
  const parVerdict = (v: MarketVerdict) =>
    reel
      .filter((m) => m.decision.verdict === v)
      .sort((a, b) => (b.acquisitionReturn ?? 0) - (a.acquisitionReturn ?? 0));

  // Le repère des alertes : le meilleur passage checkout → client mesuré.
  const repere = reel
    .filter((m) => m.decision.checkoutToClient !== null && m.decision.verdict !== "reparer")
    .sort((a, b) => (b.decision.checkoutToClient ?? 0) - (a.decision.checkoutToClient ?? 0))[0];

  const lanes: { verdict: MarketVerdict; rule: string; empty: string }[] = [
    {
      verdict: "accelerer",
      rule: `retour ≥ ×${DECISION.goReturn} · ≥ ${DECISION.goClients} clients`,
      empty: "Aucun marché ne passe la barre.",
    },
    {
      verdict: "reparer",
      rule: `moins de ${Math.round(DECISION.fixMaxCheckoutToClient * 100)} % des checkouts payent`,
      empty: "Aucun paiement qui casse.",
    },
    {
      verdict: "surveiller",
      rule: "rentable mais pas prouvé",
      empty: "Rien à surveiller.",
    },
    {
      verdict: "couper",
      rule: `retour < ×${String(DECISION.cutReturn).replace(".", ",")}`,
      empty: "Aucun marché à couper.",
    },
  ];
  const tropTot = parVerdict("trop_tot");

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-y-4 p-0 lg:grid-cols-4">
          <Tuile
            label="Coût / 1 000 vues"
            value={argent(pour1000(cout))}
            hint={`${argent(cout)} de créatrices · ${compactViews(vues)} vues promo`}
          />
          <Tuile
            label="RPM acquisition"
            value={argent(pour1000(valeur))}
            hint="valeur des clients gagnés, pour 1 000 vues"
          />
          <Tuile
            label="Retour"
            value={returnLabel(retour)}
            tone={retour === null ? undefined : retour >= 1 ? "good" : "bad"}
            hint="valeur à 30 j des clients ÷ coût promo"
          />
          <Tuile
            label="RPM encaissé"
            value={argent(pour1000(revenu))}
            hint="revenu net, renouvellements compris"
          />
        </CardContent>
      </Card>

      {parVerdict("reparer").map((m) => (
        <div
          key={m.key}
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center"
          role="status"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
            <AlertTriangleIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-semibold text-slate-900">
              {m.label} : {m.checkouts.toLocaleString("fr-FR")} checkouts,{" "}
              {m.trafficClients.toLocaleString("fr-FR")} clients.
            </p>
            <p className="text-xs text-amber-900">
              {pctFromFraction(m.decision.checkoutToClient)} des checkouts
              aboutissent
              {repere
                ? `, contre ${pctFromFraction(repere.decision.checkoutToClient)} en ${repere.label}`
                : ""}
              . L&apos;audience ouvre le checkout
              {m.decision.visitToCheckout !== null
                ? ` (${pctFromFraction(m.decision.visitToCheckout)} des visiteurs)`
                : ""}
              : c&apos;est le paiement qui casse, pas le marché.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpen(m.key)}>
            Voir le marché
          </Button>
        </div>
      ))}

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">Décision</h3>
          <p className="text-xs text-slate-500">
            Retour = valeur à 30 j des clients gagnés ÷ coût promo · pas de verdict
            sous {formatMoney(DECISION.minSpend, devise ?? undefined)} dépensés
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {lanes.map((lane) => {
            const ui = VERDICT_UI[lane.verdict];
            const items = parVerdict(lane.verdict);
            return (
              <section
                key={lane.verdict}
                aria-label={ui.label}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3"
              >
                <header className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className={`size-2 rounded-full ${ui.dot}`} />
                    {ui.label}
                  </h4>
                  <span className="text-[11px] text-slate-500">{lane.rule}</span>
                </header>
                {items.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-slate-400">{lane.empty}</p>
                ) : (
                  items.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => onOpen(m.key)}
                      className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-lg border border-transparent bg-slate-50 px-3 py-2 text-left hover:border-slate-200 focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {m.label}
                      </span>
                      <span className={`font-mono text-sm font-semibold tabular-nums ${ui.text}`}>
                        {returnLabel(m.acquisitionReturn)}
                        {m.acquisitionValue?.estimated ? (
                          <span className="ml-0.5 align-super text-[9px] font-normal text-slate-400">
                            est.
                          </span>
                        ) : null}
                      </span>
                      <span className="col-span-2 text-xs text-slate-500">
                        {m.clients.toLocaleString("fr-FR")} client
                        {m.clients > 1 ? "s" : ""} · 1 000 vues valent{" "}
                        {argent(m.rpmAcquisition)} et coûtent {argent(m.costPer1000)}
                      </span>
                    </button>
                  ))
                )}
              </section>
            );
          })}
        </div>
        {tropTot.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            Trop tôt pour juger :
            {tropTot.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => onOpen(m.key)}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-slate-200"
              >
                {m.label} · {argent(m.promoCostComparable)}
              </button>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Tuile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="flex flex-col gap-0.5 border-slate-100 px-4 py-3 even:border-l lg:border-l lg:first:border-l-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span
        className={`font-mono text-2xl font-semibold tabular-nums ${
          tone === "good"
            ? "text-emerald-600"
            : tone === "bad"
              ? "text-rose-600"
              : "text-slate-900"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-slate-400">{hint}</span>
    </div>
  );
}
