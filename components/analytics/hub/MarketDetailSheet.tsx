"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import { pctFromFraction } from "@/lib/percent";
import { isoCountryLabel } from "@/lib/country-name";
import { countryFlag } from "@/lib/countries";
import { convertedValue, toDisplayAmount, type CurrencyContext } from "@/lib/currency-display";
import type { MarketDerived } from "@/lib/market-aggregate";

/** Un ratio en français — « 1,71 », comme les montants de la même carte. */
const ratioFr = (n: number, d = 2) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * LE DÉTAIL D'UN MARCHÉ — tout ce que les onze colonnes ne peuvent pas tenir.
 *
 * Ouvert au clic d'une bulle, d'une barre ou d'une ligne. Il répond à la
 * question suivante : « celui-là, pourquoi ? » — la rétention explique une
 * valeur qui décroche, le mix de plans explique un panier bas, les créatrices
 * expliquent un coût.
 *
 * ⚠️ DEUX POPULATIONS DANS LE MÊME PANNEAU, et il le dit en toutes lettres.
 * Visiteurs et conversion viennent du pays de CONNEXION ; tout le reste, du pays
 * de FACTURATION. Le panneau les met côte à côte parce que c'est la même
 * décision, jamais parce que ce sont les mêmes gens — et aucune ligne ne divise
 * l'une par l'autre.
 */
export function MarketDetailSheet({
  marche,
  ctx,
  devise,
  onClose,
}: {
  marche: MarketDerived | null;
  ctx: CurrencyContext;
  devise: string | null;
  onClose: () => void;
}) {
  const argent = (n: number) => formatMoney(n, devise ?? undefined);
  const cout = (n: number) => convertedValue(toDisplayAmount(n, ctx));

  return (
    <Sheet open={marche !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
        data-testid="market-detail-sheet"
      >
        {marche === null ? null : (
          <>
            <SheetHeader className="border-b border-slate-100 p-4">
              <SheetTitle className="break-words">{marche.label}</SheetTitle>
              <SheetDescription>
                {marche.composed
                  ? marche.countries
                      .filter((c): c is string => c !== null)
                      .map((c) => `${countryFlag(c)} ${isoCountryLabel(c)}`)
                      .join(" + ")
                  : "Pays seul"}
              </SheetDescription>
            </SheetHeader>

            <Section titre="Ce qu'il rend">
              <Paires
                items={[
                  ["Revenu net", argent(marche.revenueNet)],
                  ["Coût créatrices", marche.cost === 0 ? "aucun" : cout(marche.cost)],
                  ["Retour", marche.retour === null ? "—" : ratioFr(marche.retour)],
                  [
                    "Remboursé",
                    marche.payback.state === "gratuit"
                      ? "immédiat"
                      : marche.payback.state === "jamais"
                        ? "jamais"
                        : marche.payback.day === null
                          ? "—"
                          : `J+${marche.payback.day}`,
                  ],
                ]}
              />
            </Section>

            <Section titre="Ses clients">
              <Paires
                items={[
                  ["Clients acquis", formatNumber(marche.clients)],
                  [
                    "Coût par client",
                    marche.cac === null
                      ? "—"
                      : marche.cac === 0
                        ? "aucun"
                        : argent(marche.cac),
                  ],
                  ["Panier moyen", marche.basket === null ? "—" : argent(marche.basket)],
                  ["Cycles par client", marche.cycles === null ? "—" : ratioFr(marche.cycles, 1)],
                  ...marche.value
                    .filter((v) => v.day === 30 || v.day === 90)
                    .map(
                      (v) =>
                        [
                          `Valeur à ${v.day} j`,
                          v.value === null
                            ? `— (${v.mature} mûrs)`
                            : `${argent(v.value)} · ${v.mature}`,
                        ] as [string, string],
                    ),
                ]}
              />
            </Section>

            <Section titre="Combien restent abonnés">
              <div className="flex items-end gap-4">
                {marche.survival.map((s) => (
                  <div key={s.day} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-16 w-full items-end overflow-hidden rounded bg-slate-100">
                      <div
                        className="w-full rounded bg-slate-700"
                        style={{ height: `${Math.max(3, (s.rate ?? 0) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs tabular-nums text-slate-700">
                      {s.rate === null ? "—" : pctFromFraction(s.rate)}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">J+{s.day}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Une résiliation ne compte que le jour où l&apos;accès s&apos;arrête
                vraiment, pas le jour où elle est demandée.
              </p>
            </Section>

            <Section titre="Ce qu'ils achètent">
              {marche.plans.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Aucun paiement encaissé sur ce marché.
                </p>
              ) : (
                <div className="space-y-2">
                  {marche.plans.map((p) => (
                    <div
                      key={p.planId}
                      className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2"
                    >
                      <span className="font-mono text-[11px] text-slate-600">
                        {argent(p.price)}
                      </span>
                      <span className="h-2 overflow-hidden rounded bg-slate-100">
                        <span
                          className="block h-full rounded bg-slate-700"
                          style={{ width: `${(p.share * 100).toFixed(0)}%` }}
                        />
                      </span>
                      <span className="text-right font-mono text-[11px] text-slate-500">
                        {pctFromFraction(p.share)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section titre="Ce qu'on y met" dernier>
              <Paires
                items={[
                  ["Créatrices qui le visent", marche.creators === 0 ? "aucune" : formatNumber(marche.creators)],
                  ["Vidéos publiées", formatNumber(marche.videos)],
                  ["Visiteurs", formatNumber(marche.visitors)],
                  [
                    "Conversion",
                    marche.conversion === null
                      ? "trop peu"
                      : pctFromFraction(marche.conversion),
                  ],
                ]}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Visiteurs et conversion viennent du pays de <strong>connexion</strong> ;
                tout le reste de ce panneau, du pays de <strong>facturation</strong>.
                Deux populations, jamais divisées l&apos;une par l&apos;autre.
              </p>
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  titre,
  dernier,
  children,
}: {
  titre: string;
  dernier?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={dernier ? "p-4" : "border-b border-slate-100 p-4"}>
      <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {titre}
      </h3>
      {children}
    </section>
  );
}

function Paires({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-slate-500">{k}</dt>
          <dd className="truncate font-mono text-sm tabular-nums text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
