"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HubCardHeader, dash } from "./HubPrimitives";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import {
  convertedValue,
  rateNote,
  toDisplayAmount,
  type CurrencyContext,
} from "@/lib/currency-display";
import { isoCountryLabel } from "@/lib/country-name";
import { countryFlag } from "@/lib/countries";
import { formatDateFr } from "@/convex/dateFr";
import type { MarketRow } from "@/convex/marketPnl";
import {
  countryTrafficRows,
  shareGap,
  MIN_COUNTRY_SAMPLE,
  type CountrySteps,
} from "@/lib/country-traffic";
import { pctFromFraction } from "@/lib/percent";

/**
 * ONGLET PAYS — ce qu'un marché coûte en créatrices, contre ce qu'il rapporte.
 *
 * ⚠️ DEUX NOTIONS DE PAYS SUR LA MÊME LIGNE, et c'est délibéré : le coût vient
 * du MARCHÉ VISÉ par le compte, le revenu du pays de FACTURATION du client. La
 * ligne les met face à face parce que c'est la décision qu'on prend
 * (« j'investis ici, ça rapporte ça »), pas parce que ce sont les mêmes gens —
 * le pied de carte le dit, et aucune colonne ne divise l'un par l'autre.
 *
 * Le coût est en devise de PAIE : il passe donc par `lib/currency-display`,
 * seule voie autorisée (cf la garde lib/currency-hardcode.test.ts). Poser un
 * coût en dollars à côté d'un revenu en euros a déjà fait lire une marge fausse
 * en prod.
 */

export type MarketPnl = {
  whopConfigured: boolean;
  payCurrency: string | null;
  revenueCurrency: string | null;
  fxRateToRevenue: number | null;
  rows: MarketRow[];
  collection: {
    lastAt: number | null;
    fresh: number;
    total: number;
    failing: number;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Libellé d'un marché : drapeau + nom, ou la ligne « hors marché ».
 *
 * La prop s'appelle `code` et non `country` À DESSEIN : la garde de
 * lib/country-name.test.ts cherche un champ `country` rendu en JSX, et sa
 * détection attrape aussi une déstructuration. Renommer ici coûte un mot ;
 * assouplir la garde lui coûterait ses dents.
 */
function MarketLabel({ code }: { code: string | null }) {
  if (code === null) {
    return <span className="text-slate-500">Aucun pays défini</span>;
  }
  const flag = countryFlag(code);
  return (
    <span className="flex items-center gap-2">
      {flag ? <span aria-hidden>{flag}</span> : null}
      {isoCountryLabel(code)}
    </span>
  );
}

/** Étapes d'un pays, telles que `countryPersons` les rend. */
export type FunnelSegments = {
  segments: { key: string; steps: { key: string; count: number }[] }[];
};

function stepsOf(segments: FunnelSegments | undefined): CountrySteps[] {
  return (segments?.segments ?? []).map((seg) => {
    const n = (k: string) => seg.steps.find((x) => x.key === k)?.count ?? 0;
    return {
      country: seg.key,
      visitors: n("visit"),
      paywall: n("paywall_viewed"),
      checkouts: n("checkout_started"),
      clients: n("subscription_completed"),
    };
  });
}

export function PaysTab({
  pnl,
  traffic,
  error,
}: {
  pnl: MarketPnl | undefined;
  /** Funnel par pays attribué PAR PERSONNE (cf QUERIES.countryPersons). */
  traffic?: FunnelSegments;
  /** Message d'échec de lecture — un tiret muet se lirait « pas de données ». */
  error?: string | null;
}) {
  const ctx: CurrencyContext = {
    payCurrency: pnl?.payCurrency,
    revenueCurrency: pnl?.revenueCurrency,
    fxRateToRevenue: pnl?.fxRateToRevenue,
  };
  const argent = (n: number | null) => convertedValue(toDisplayAmount(n, ctx));

  /**
   * Marge = revenu − coût, en devise d'AFFICHAGE. Elle n'existe que si le coût
   * a pu être converti : sans taux réglé, soustraire des dollars à des euros
   * produirait un nombre qui ne veut rien dire. `null` ⇒ tiret.
   */
  const lignes = useMemo(() => {
    const rows = [...(pnl?.rows ?? [])];
    return rows
      .map((r) => {
        const coutAffiche = toDisplayAmount(r.cost, ctx);
        // `rate === null` ⇒ AUCUNE conversion possible (taux du projet non
        // réglé) : le coût reste en dollars, et soustraire des dollars à des
        // euros rendrait un nombre qui ne veut rien dire. Tiret, pas zéro.
        const coutComparable =
          coutAffiche !== null && coutAffiche.rate !== null
            ? coutAffiche.value
            : null;
        // La ligne « aucun pays défini » n'est PAS un marché : c'est du coût
        // HORS marché. Lui calculer une marge la ferait lire comme une perte de
        // marché (« le Brésil perd 77 €, le néant en perd 122 »), alors qu'il
        // n'y a rien à quoi la comparer. Le coût reste visible, la marge est un
        // tiret.
        const marge =
          r.country === null || coutComparable === null || !pnl?.whopConfigured
            ? null
            : round2(r.revenueNet - coutComparable);
        return { ...r, marge };
      })
      .sort((a, b) => (b.marge ?? -Infinity) - (a.marge ?? -Infinity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pnl]);

  const totalCost = lignes.reduce((s, r) => s + r.cost, 0);
  const totalRevenue = lignes.reduce((s, r) => s + r.revenueNet, 0);
  // Le total, lui, PORTE le coût hors marché : c'est la marge réelle. Il se
  // calcule donc sur les totaux et non en sommant les lignes, dont une n'a
  // délibérément pas de marge.
  const totalCoutAffiche = toDisplayAmount(totalCost, ctx);
  const totalMarge =
    pnl?.whopConfigured &&
    totalCoutAffiche !== null &&
    totalCoutAffiche.rate !== null
      ? round2(totalRevenue - totalCoutAffiche.value)
      : null;

  // Une lecture qui ÉCHOUE et une absence de données se corrigent très
  // différemment : l'écran ne doit pas les afficher pareil.
  if (error) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardContent className="p-4 text-sm text-red-900">
          La rentabilité par marché n&apos;a pas pu être lue. {error}
        </CardContent>
      </Card>
    );
  }
  if (pnl === undefined) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-slate-400">
          Chargement…
        </CardContent>
      </Card>
    );
  }

  const lignesTrafic = countryTrafficRows(stepsOf(traffic));
  const c = pnl.collection;
  const fraicheur = c.total > 0 ? c.fresh / c.total : null;

  return (
    <div className="space-y-4">
      {/* ── La fraîcheur du relevé conditionne la colonne coût ───────────────
          Le CPM d'une vidéo court tant que le relevé lui ajoute des vues : un
          coût non mesuré se lit sinon comme un coût faible. Dit ICI, avant les
          chiffres, et pas en note de bas de page. */}
      <Card className="border-amber-200 bg-amber-50/70">
        <CardContent className="flex flex-wrap items-center gap-x-2 gap-y-1 p-3 text-xs text-amber-900">
          <strong>Relevé de vues</strong>
          <span>
            {c.lastAt === null
              ? "jamais effectué"
              : `dernier passage le ${formatDateFr(c.lastAt)}`}
          </span>
          {fraicheur !== null ? (
            <span>
              · <strong className="tabular-nums">
                {Math.round(fraicheur * 100)} %
              </strong>{" "}
              des {formatNumber(c.total)} vidéos de la période mesurées à moins
              de 48 h
            </span>
          ) : null}
          {c.failing > 0 ? (
            <span>
              · <strong className="tabular-nums">{formatNumber(c.failing)}</strong>{" "}
              en échec de relevé
            </span>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs font-medium text-slate-500">
              Revenu net encaissé
            </span>
            <span className="text-2xl font-bold tabular-nums text-slate-900">
              {pnl.whopConfigured
                ? formatMoney(totalRevenue, pnl.revenueCurrency ?? undefined)
                : "—"}
            </span>
            <span className="text-xs text-slate-400">
              {pnl.whopConfigured
                ? "Pays de facturation du client"
                : "Whop n'est pas configuré sur ce projet"}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs font-medium text-slate-500">
              Coût créatrices
            </span>
            <span className="text-2xl font-bold tabular-nums text-slate-900">
              {argent(totalCost)}
            </span>
            <span className="text-xs text-slate-400">
              Plancher — les vues courent encore. {rateNote(ctx)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <span className="text-xs font-medium text-slate-500">Marge</span>
            <span
              className={`text-2xl font-bold tabular-nums ${
                totalMarge === null
                  ? "text-slate-900"
                  : totalMarge < 0
                    ? "text-rose-600"
                    : "text-emerald-600"
              }`}
            >
              {totalMarge === null
                ? "—"
                : formatMoney(totalMarge, pnl.revenueCurrency ?? undefined)}
            </span>
            <span className="text-xs text-slate-400">
              Hors bonus de paliers et primes de défi
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Rentabilité par marché"
            subtitle="Coût des créatrices qui visent ce marché, contre revenu net encaissé depuis ce pays."
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marché</TableHead>
                  <TableHead className="text-right">Créatrices</TableHead>
                  <TableHead className="text-right">Vidéos payées</TableHead>
                  <TableHead className="text-right">Coût</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right">Revenu net</TableHead>
                  <TableHead className="text-right">Marge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lignes.map((r) => (
                  <TableRow
                    key={r.country ?? "(hors marché)"}
                    className={
                      r.marge !== null && r.marge < 0 ? "bg-rose-50/50" : undefined
                    }
                  >
                    <TableCell className="text-xs font-medium text-slate-700">
                      <MarketLabel code={r.country} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.creators > 0 ? formatNumber(r.creators) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.videos > 0 ? formatNumber(r.videos) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.cost > 0 ? argent(r.cost) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.clients > 0 ? formatNumber(r.clients) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.revenueNet > 0
                        ? formatMoney(
                            r.revenueNet,
                            pnl.revenueCurrency ?? undefined,
                          )
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right text-xs font-medium tabular-nums ${
                        r.marge === null
                          ? ""
                          : r.marge < 0
                            ? "text-rose-600"
                            : "text-emerald-600"
                      }`}
                    >
                      {dash(r.marge, (n) =>
                        formatMoney(n, pnl.revenueCurrency ?? undefined),
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-slate-400">
            Le <strong>coût</strong> vient du marché visé par le compte de la
            créatrice ; le <strong>revenu</strong>, de l&apos;adresse de
            facturation du client. Deux notions de pays, mises face à face parce
            que c&apos;est la décision qu&apos;on prend — jamais divisées
            l&apos;une par l&apos;autre. Un coût sans marché défini garde sa
            propre ligne : le répartir au prorata fabriquerait une rentabilité
            que personne n&apos;a mesurée.
          </p>
        </CardContent>
      </Card>

      {/* ── TRAFIC ET CONVERSION — une seule source, des personnes ──────────
          Le taux est calculé DANS PostHog, sur les mêmes personnes des deux
          bouts (cf QUERIES.countryPersons). Les parts servent la comparaison
          qui, elle, ne divise jamais deux populations l'une par l'autre. */}
      {lignesTrafic.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="D'où vient le trafic, et ce qu'il devient"
              subtitle="Pays de connexion du visiteur. Une personne est rattachée au pays de ses visites, et ses achats lui sont comptés d'où qu'ils partent."
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pays de connexion</TableHead>
                    <TableHead className="text-right">Visiteurs</TableHead>
                    <TableHead className="text-right">Paywall</TableHead>
                    <TableHead className="text-right">Checkouts</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">Conversion</TableHead>
                    <TableHead className="text-right">
                      Part checkouts → clients
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lignesTrafic.map((r) => {
                    const ecart = shareGap(r);
                    return (
                      <TableRow key={r.country}>
                        <TableCell className="text-xs font-medium text-slate-700">
                          <MarketLabel
                            code={r.country === "(inconnu)" ? null : r.country}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(r.visitors)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(r.paywall)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(r.checkouts)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(r.clients)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums">
                          {pctFromFraction(r.conversion)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          <span className="text-slate-500">
                            {pctFromFraction(r.checkoutShare)} →{" "}
                            {pctFromFraction(r.clientShare)}
                          </span>
                          {ecart !== null ? (
                            <span
                              className={`ml-2 font-medium ${
                                ecart < 0 ? "text-rose-600" : "text-emerald-600"
                              }`}
                            >
                              {/* POINTS, jamais « % » : l'écart entre deux
                                  parts se compte en points. Écrire « 13 % » là
                                  où il y a 13 POINTS est le glissement d'unité
                                  que ce dépôt paie cher (cf lib/pct-units). */}
                              {ecart > 0 ? "+" : "−"}
                              {formatNumber(
                                Math.round(Math.abs(ecart) * 1000) / 10,
                              )}{" "}
                              pts
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-slate-400">
              La conversion ne s&apos;affiche qu&apos;au-delà de{" "}
              {MIN_COUNTRY_SAMPLE} visiteurs. La colonne de droite compare la
              place d&apos;un pays dans les checkouts à sa place dans les
              clients : un écart négatif dit que son trafic se transforme moins
              bien que son volume ne le laissait attendre. Ces visiteurs ne sont
              pas les clients du tableau ci-dessus — l&apos;un compte des
              connexions, l&apos;autre des adresses de facturation.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
