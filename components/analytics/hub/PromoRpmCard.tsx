"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import { computePromoRpm } from "@/lib/analytics-hub";
import { effectiveFxRate } from "@/lib/currency";
import {
  toDisplayAmount,
  convertedValue,
  conversionNote,
  rateNote,
  type CurrencyContext,
} from "@/lib/currency-display";
import { cn } from "@/lib/utils";
import { HubCardHeader } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import type { AttributionData, RevenueData, ViewCountersData } from "./types";

/**
 * RPM PROMO — le chiffre qui dit si le moteur UGC gagne de l'argent : ce que mille
 * vues promo RAPPORTENT, ce qu'elles COÛTENT, et l'écart entre les deux (la marge
 * par millier de vues). Dénominateur commun aux trois : les vues PROMO cumulées
 * (hors warmup), affichées sur la carte — elles ne se déduisaient jusqu'ici que du
 * ratio arrondi de « Vues promo → abonné ».
 *
 * PÉRIMÈTRE UNIQUE des deux côtés : le coût est la paie des PUBLICATIONS PROMO
 * (fixe + CPM), jamais le coût complet du moteur. Le warmup n'est pas rémunéré —
 * sauf l'exception historique portée par le champ `remunere`, dont les vues
 * sortent du dénominateur ET la paie du numérateur (promoVideoCost, côté serveur).
 * Compter le warmup au numérateur reviendrait à facturer un coût qu'on ne paie
 * pas. La carte Rentabilité des Paiements, elle, mesure autre chose (le coût
 * COMPLET du moteur, warmup inclus) et reste inchangée.
 *
 * DEUX DEVISES (règle du produit) : le revenu Whop est en euros, la paie créatrices
 * en dollars. Le coût est donc CONVERTI au taux du projet pour que l'écart existe,
 * et le taux utilisé est écrit sur la carte. Sans taux renseigné : chaque RPM reste
 * dans SA devise et l'écart affiche un tiret plutôt qu'une soustraction inventée.
 */

function RpmMetric({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums text-slate-900",
          valueClass,
        )}
      >
        {value}
      </div>
      <div className="text-[11px] leading-relaxed text-slate-400">{hint}</div>
    </div>
  );
}

export function PromoRpmCard({
  revenue,
  attribution,
  viewCounters,
}: {
  revenue: RevenueData | undefined;
  attribution: AttributionData | undefined;
  viewCounters: ViewCountersData | undefined;
}) {
  // Revenu net CUMULÉ (toutes périodes) — même base que la tuile « Revenu net
  // encaissé » juste au-dessus. Whop non configuré ⇒ null, jamais 0.
  // A5 — même somme cross-périodes que la tuile « Revenu net encaissé », donc
  // même trou et même garde : bi-devise ⇒ null, jamais un total mélangé.
  const revenueNet =
    revenue?.configured && !revenue.mixedCurrency
      ? Math.round(revenue.periods.reduce((s, p) => s + p.net, 0) * 100) / 100
      : null;
  const currency = revenue?.currency ?? null; // revenu (€)
  const payCurrency = attribution?.payCurrency ?? null; // paie créatrices ($)
  const fx = effectiveFxRate(payCurrency, currency, attribution?.fxRateToRevenue);
  // Même passage obligé que les cartes d'éco unitaire : un seul module formate
  // un montant de paie sur tout le hub (cf ConvertedAmount).
  const fxCtx: CurrencyContext = {
    payCurrency,
    revenueCurrency: currency,
    fxRateToRevenue: attribution?.fxRateToRevenue,
  };

  const rpm = computePromoRpm({
    revenueNet,
    // Paie des PUBLICATIONS PROMO (fixe + CPM), et rien d'autre : le warmup n'est
    // pas rémunéré, sauf l'exception historique traitée par le champ `remunere`,
    // dont les vues sortent du dénominateur — sa paie ne doit donc pas entrer au
    // numérateur (elle en est retirée par promoVideoCost, côté serveur). Le
    // périmètre est le même des deux côtés : les publications promo.
    creatorCost: attribution?.costs.promo ?? null,
    promoViews: viewCounters?.promo ?? null,
    fxRateToRevenue: fx,
  });

  const marginPositive = rpm.margin !== null && rpm.margin >= 0;
  // Coût affiché dans la devise du REVENU dès qu'un taux existe (c'est ce qui rend
  // l'écart lisible à l'écran : revenu − coût = écart). Sans taux, il reste dans sa
  // devise de paie et l'écart n'est pas calculé.
  const costAmount = toDisplayAmount(rpm.cost, fxCtx);
  const costValue = convertedValue(costAmount);
  const costHint = [
    conversionNote(costAmount),
    "fixe + CPM des publications promo, hors bonus de paliers",
  ]
    .filter((x) => x !== "")
    .join(" · ");

  const rateLabel =
    rateNote(fxCtx) !== ""
      ? rateNote(fxCtx)
      : "aucun taux de change réglé sur le projet : écart non calculé";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <HubCardHeader
          title="RPM promo"
          subtitle="Ce que mille vues promo rapportent, ce qu'elles coûtent, et l'écart entre les deux."
          info={EXPLAIN.rpmPromo}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Un tiret reste NEUTRE : la couleur porte un sens (argent gagné,
              marge négative) et ne doit pas colorer une valeur absente. */}
          <RpmMetric
            label="RPM revenu"
            value={rpm.revenue === null ? "—" : formatMoney(rpm.revenue, currency)}
            hint="revenu net Whop cumulé, pour 1 000 vues promo"
            valueClass={rpm.revenue === null ? "text-slate-400" : "text-emerald-700"}
          />
          <RpmMetric
            label="RPM coût"
            value={costValue}
            hint={costHint}
            valueClass={rpm.cost === null ? "text-slate-400" : undefined}
          />
          <RpmMetric
            label="Écart"
            value={rpm.margin === null ? "—" : formatMoney(rpm.margin, currency)}
            hint="marge par millier de vues promo"
            valueClass={
              rpm.margin === null
                ? "text-slate-400"
                : marginPositive
                  ? "text-emerald-700"
                  : "text-rose-600"
            }
          />
        </div>
        <p className="text-xs text-slate-400">
          {rpm.promoViews === 0
            ? "Aucune vue promo cumulée : les trois valeurs restent à un tiret plutôt qu'à un RPM indéfini."
            : `${formatNumber(rpm.promoViews)} vues promo cumulées, hors warmup`}
          {" · "}
          {rateLabel}
        </p>
        {/* Le périmètre, écrit : c'est ce qui rend l'écart lisible (numérateur et
            dénominateur portent sur les mêmes publications). */}
        <p className="text-xs text-slate-400">
          Le RPM coût ne porte que sur les publications promo : le warmup est exclu
          des deux côtés, parce qu&apos;il n&apos;est pas rémunéré — hors exception
          historique, traitée par le champ « rémunéré », dont la paie est retirée du
          numérateur puisque ses vues le sont du dénominateur.
        </p>
      </CardContent>
    </Card>
  );
}
