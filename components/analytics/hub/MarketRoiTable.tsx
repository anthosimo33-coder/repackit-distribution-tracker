"use client";

import { Fragment } from "react";
import { ChevronRightIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format-rate";
import { pctFromFraction } from "@/lib/percent";
import { DECISION } from "@/lib/market-decision";
import {
  toDisplayAmount,
  type CurrencyContext,
} from "@/lib/currency-display";
import { ColLabel } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import type { DecidedMarket } from "./MarketDecisionBoard";
import { VERDICT_UI, compactViews, returnLabel } from "./marketVerdictUi";

/**
 * LE TABLEAU DE DÉCISION — une ligne par marché, dix colonnes qui servent à
 * trancher. Ce qui décrit le marché sans servir la décision de la semaine
 * (panier, cycles, survie, remboursement) vit dans le détail, pas ici.
 *
 * Une ligne se DÉPLIE sur place : créatrices, entonnoir, plans vendus. Le
 * tiroir existant (valeur, survie) reste à un clic, pour ne pas le recopier.
 */
export function MarketRoiTable({
  marches,
  devise,
  ctx,
  ouvert,
  onToggle,
  onDetail,
}: {
  marches: DecidedMarket[];
  devise: string | null;
  ctx: CurrencyContext;
  ouvert: string | null;
  onToggle: (key: string) => void;
  onDetail: (key: string) => void;
}) {
  const argent = (n: number | null) =>
    n === null ? "—" : formatMoney(n, devise ?? undefined);

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-white">Marché</TableHead>
            <TableHead className="text-right">Créatrices</TableHead>
            <TableHead className="text-right">
              <ColLabel label="Vues promo" info={EXPLAIN.marcheVuesPromo} />
            </TableHead>
            <TableHead className="text-right">
              <ColLabel label="Coût / 1 000 vues" info={EXPLAIN.marcheCout1000} />
            </TableHead>
            <TableHead className="text-right text-primary">
              <ColLabel label="RPM acquisition" info={EXPLAIN.marcheRpmAcquisition} />
            </TableHead>
            <TableHead className="text-right">
              <ColLabel label="RPM encaissé" info={EXPLAIN.marcheRpmEncaisse} />
            </TableHead>
            <TableHead className="text-right">
              <ColLabel label="Retour" info={EXPLAIN.marcheRetourAcquisition} />
            </TableHead>
            <TableHead className="text-right">
              <ColLabel label="Nouveaux clients" info={EXPLAIN.marcheClients} />
            </TableHead>
            <TableHead className="text-right">
              <ColLabel label="Où ça casse" info={EXPLAIN.marcheOuCaCasse} />
            </TableHead>
            <TableHead className="text-right">Verdict</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {marches.map((m) => {
            const ui = VERDICT_UI[m.decision.verdict];
            const estOuvert = ouvert === m.key;
            const casse =
              m.decision.checkoutToClient !== null &&
              m.decision.checkoutToClient < DECISION.fixMaxCheckoutToClient;
            return (
              <Fragment key={m.key || "(hors marché)"}>
                <TableRow
                  onClick={() => onToggle(m.key)}
                  aria-expanded={estOuvert}
                  className="group cursor-pointer"
                >
                  <TableCell className="sticky left-0 z-10 bg-white group-hover:bg-slate-50">
                    <span className="flex items-center gap-2">
                      <ChevronRightIcon
                        className={`size-4 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${
                          estOuvert ? "rotate-90" : ""
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-800">
                          {m.label}
                        </span>
                        {m.composed ? (
                          <span className="block font-mono text-[10px] text-slate-400">
                            {m.countries.filter((c) => c !== null).join(" ")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {m.creators > 0 ? m.creators : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {m.promoViews > 0 ? compactViews(m.promoViews) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {argent(m.costPer1000)}
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-900">
                    {argent(m.rpmAcquisition)}
                    {m.acquisitionValue?.estimated && m.rpmAcquisition !== null ? (
                      <span
                        className="ml-0.5 align-super text-[9px] font-normal text-slate-400"
                        title="Valeur à 30 j pas encore mûre : estimée sur le panier moyen"
                      >
                        est.
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {argent(m.rpmCollected)}
                  </TableCell>
                  <TableCell className={`text-right text-xs font-semibold tabular-nums ${ui.text}`}>
                    {returnLabel(m.acquisitionReturn)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {m.clients > 0 ? m.clients.toLocaleString("fr-FR") : "—"}
                    <Variation value={m.deltaClients} />
                  </TableCell>
                  <TableCell className="text-right text-[11px] tabular-nums">
                    {m.decision.visitToCheckout === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="inline-grid grid-cols-[auto_auto] gap-x-2 text-left">
                        <span className="text-slate-400">→ checkout</span>
                        <span className="text-right">
                          {pctFromFraction(m.decision.visitToCheckout)}
                        </span>
                        <span className="text-slate-400">→ client</span>
                        <span
                          className={`text-right ${casse ? "font-semibold text-rose-600" : ""}`}
                        >
                          {pctFromFraction(m.decision.checkoutToClient)}
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ui.pill}`}
                    >
                      {m.key === "" ? "Hors marché" : ui.label}
                    </span>
                  </TableCell>
                </TableRow>
                {estOuvert ? (
                  <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                    <TableCell colSpan={10} className="whitespace-normal p-0">
                      <MarketRowDetail
                        m={m}
                        ctx={ctx}
                        argent={argent}
                        onDetail={() => onDetail(m.key)}
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Variation({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.03) return null;
  const monte = value > 0;
  return (
    <span
      className={`ml-1 text-[10px] ${monte ? "text-emerald-600" : "text-rose-600"}`}
      title="Contre la période précédente de même durée"
    >
      {monte ? "▲" : "▼"}
      {Math.abs(Math.round(value * 100))}%
    </span>
  );
}

function MarketRowDetail({
  m,
  ctx,
  argent,
  onDetail,
}: {
  m: DecidedMarket;
  ctx: CurrencyContext;
  argent: (n: number | null) => string;
  onDetail: () => void;
}) {
  // Coût / 1 000 vues d'une créatrice, converti comme celui du marché.
  const coutPour1000 = (cost: number, views: number) => {
    const c = toDisplayAmount(cost, ctx);
    if (c === null || c.rate === null || views <= 0) return null;
    return (c.value / views) * 1000;
  };
  const etapes = [
    { label: "Visiteurs", n: m.visitors, taux: null as number | null },
    { label: "Checkout", n: m.checkouts, taux: m.decision.visitToCheckout },
    { label: "Client", n: m.trafficClients, taux: m.decision.checkoutToClient },
  ];
  const maxEtape = Math.max(1, m.visitors);

  return (
    <div className="grid gap-6 px-4 py-4 sm:pl-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Créatrices · {m.creatorsDetail.length}
        </h4>
        {m.creatorsDetail.length === 0 ? (
          <p className="text-xs text-slate-400">Aucune vidéo promo sur la période.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1 font-medium">Créatrice</th>
                <th className="py-1 text-right font-medium">Vidéos</th>
                <th className="py-1 text-right font-medium">Vues promo</th>
                <th className="py-1 text-right font-medium">Part</th>
                <th className="py-1 text-right font-medium">Coût / 1 000 vues</th>
              </tr>
            </thead>
            <tbody>
              {m.creatorsDetail.map((c) => {
                const cp = coutPour1000(c.promoCost, c.promoViews);
                // « Cher » = plus du double du marché : à réaffecter en premier.
                const cher =
                  cp !== null && m.costPer1000 !== null && cp > 2 * m.costPer1000;
                const part = m.promoViews > 0 ? c.promoViews / m.promoViews : 0;
                return (
                  <tr key={c.creatorId} className="border-t border-slate-200/70">
                    <td className="py-1.5 pr-2 text-slate-700">{c.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.videos}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {compactViews(c.promoViews)}
                    </td>
                    <td className="py-1.5 text-right">
                      <span className="inline-flex items-center gap-2">
                        <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-200 sm:inline-block">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.round(part * 100)}%` }}
                          />
                        </span>
                        <span className="tabular-nums">{Math.round(part * 100)} %</span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {argent(cp)}
                      {cher ? (
                        <span className="ml-1.5 rounded bg-rose-50 px-1.5 py-px text-[10px] text-rose-700">
                          cher
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-slate-400">
          Pas de revenu par créatrice : un client n&apos;est pas rattaché à la
          vidéo qui l&apos;a amené. « cher » = plus du double du coût / 1 000 vues
          du marché.
        </p>
      </div>

      <div className="min-w-0 space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Entonnoir
        </h4>
        {m.visitors === 0 ? (
          <p className="text-xs text-slate-400">Aucun visiteur mesuré.</p>
        ) : (
          <div className="space-y-2">
            {etapes.map((e) => {
              const faible =
                e.label === "Client" &&
                e.taux !== null &&
                e.taux < DECISION.fixMaxCheckoutToClient;
              return (
                <div
                  key={e.label}
                  className="grid grid-cols-[72px_1fr_auto] items-center gap-2 text-xs"
                >
                  <span className="text-slate-600">{e.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, (e.n / maxEtape) * 100)}%` }}
                    />
                  </span>
                  <span
                    className={`min-w-[84px] text-right font-mono text-[11px] tabular-nums ${
                      faible ? "font-semibold text-rose-600" : "text-slate-500"
                    }`}
                  >
                    {e.n.toLocaleString("fr-FR")}
                    {e.taux === null ? "" : ` · ${pctFromFraction(e.taux)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-slate-400">
          Pays de connexion (PostHog) : ces clients ne sont pas ceux de Whop.
        </p>
      </div>

      <div className="min-w-0 space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Plans vendus
        </h4>
        {m.plans.filter((p) => p.clients > 0).length === 0 ? (
          <p className="text-xs text-slate-400">Aucun nouveau client sur la période.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {m.plans
              .filter((p) => p.clients > 0)
              .map((p) => (
                <li key={p.planId} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-700">
                      {p.label ?? p.planId}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {p.localPrice
                        ? `${p.localPrice.amount.toLocaleString("fr-FR")} ${p.localPrice.currency} ≈ ${argent(p.price)}`
                        : argent(p.price)}
                    </span>
                  </span>
                  <span className="tabular-nums text-slate-700">{p.clients}</span>
                </li>
              ))}
          </ul>
        )}
        <Button variant="outline" size="sm" onClick={onDetail}>
          Valeur, survie, remboursement
        </Button>
      </div>
    </div>
  );
}
