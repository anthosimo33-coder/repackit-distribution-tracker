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
import { HubCardHeader, ColLabel, dash } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
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
import type {
  MarketRow,
  MarketTrendPoint,
  PlanCountryCell,
} from "@/convex/marketPnl";
import {
  countryTrafficRows,
  shareGap,
  MIN_COUNTRY_SAMPLE,
  type CountrySteps,
} from "@/lib/country-traffic";
import { pctFromFraction } from "@/lib/percent";
import {
  aggregateMarket,
  type MarketDerived,
  type MarketFacts,
} from "@/lib/market-aggregate";

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
  planCells: PlanCountryCell[];
  trend: MarketTrendPoint[];
  collection: {
    lastAt: number | null;
    fresh: number;
    total: number;
    failing: number;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ── LES CELLULES QUI ONT UNE RÈGLE ──────────────────────────────────────────
 * Chacune porte une distinction que `dash()` seul ne saurait pas rendre : un
 * zéro qui est un fait contre une valeur inconnue, un effectif trop maigre pour
 * qu'un taux se lise, un « jamais » qui ne veut pas dire jamais.
 */

/** Variation contre la période d'avant. Rien avant ⇒ rien d'affiché. */
function Variation({ value }: { value: number | null }) {
  // Sous 3 %, on n'affiche rien plutôt qu'un « +1 % » qui invite à conclure.
  if (value === null || Math.abs(value) < 0.03) return null;
  const monte = value > 0;
  return (
    <span
      className={`ml-1 text-[10px] ${monte ? "text-emerald-600" : "text-rose-600"}`}
      title={`Contre la période précédente de même durée`}
    >
      {monte ? "▲" : "▼"}
      {Math.abs(Math.round(value * 100))}%
    </span>
  );
}

/**
 * Coût d'acquisition. `0` n'est PAS un tiret : il dit qu'aucune créatrice ne
 * vise ce marché, ce qui est une information et non une absence de mesure.
 */
function CoutParClient({
  value,
  revenueCurrency,
}: {
  value: number | null;
  revenueCurrency: string | null;
}) {
  if (value === null) return <>—</>;
  if (value === 0) return <span className="text-slate-400">aucun</span>;
  return <>{formatMoney(value, revenueCurrency ?? undefined)}</>;
}

/**
 * Valeur de cohorte : le montant, et TOUJOURS l'effectif sur lequel il porte.
 * Sous le seuil, l'effectif reste visible : « — 4 » dit qu'on a quatre clients
 * et pas assez pour conclure, là où un tiret nu se lirait « aucune donnée ».
 */
function Valeur({
  point,
  revenueCurrency,
}: {
  point: { value: number | null; mature: number } | undefined;
  revenueCurrency: string | null;
}) {
  if (!point || point.mature === 0) return <>—</>;
  return (
    <>
      {point.value === null ? (
        <span className="text-slate-400">—</span>
      ) : (
        formatMoney(point.value, revenueCurrency ?? undefined)
      )}{" "}
      <span className="text-[10px] text-slate-400">{point.mature}</span>
    </>
  );
}

/** Survie : trois barres (30, 60, 90 j) et le taux à 90 jours. */
function Survie({
  steps,
}: {
  steps: { day: number; rate: number | null; mature: number }[];
}) {
  const connus = steps.filter((s) => s.rate !== null);
  if (connus.length === 0) return <>—</>;
  const dernier = [...connus].pop()!;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className="inline-flex h-3.5 items-end gap-px">
        {steps.map((s) => (
          <span
            key={s.day}
            title={`${s.day} jours : ${
              s.rate === null ? `trop peu de recul (${s.mature})` : pctFromFraction(s.rate)
            }`}
            className="block w-1 rounded-[1px] bg-slate-300"
            style={{ height: `${Math.max(2, (s.rate ?? 0) * 14)}px` }}
          />
        ))}
      </span>
      <span className="text-[11px] text-slate-500">
        {pctFromFraction(dernier.rate ?? 0)}
      </span>
    </span>
  );
}

/** Le jour du remboursement, ou ce qui l'empêche de se lire. */
function Remboursement({
  value,
}: {
  value: { day: number | null; state: "gratuit" | "ok" | "jamais" | "inconnu" };
}) {
  if (value.state === "gratuit")
    return <span className="text-emerald-600">immédiat</span>;
  if (value.state === "jamais")
    return (
      <span className="text-rose-600" title="Pas dans les 90 jours mesurés">
        jamais
      </span>
    );
  if (value.state === "inconnu" || value.day === null)
    return <span className="text-slate-400">—</span>;
  return <span className="text-emerald-600">J+{value.day}</span>;
}

/** Retour sur investissement : la couleur tranche à 1,00. */
function Retour({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  const classe =
    value >= 1 ? "text-emerald-600" : value >= 0.6 ? "text-amber-600" : "text-rose-600";
  return <span className={`font-medium ${classe}`}>{value.toFixed(2)}</span>;
}

/**
 * DU SERVEUR À L'AGRÉGATION — le pont, et les deux populations qu'il respecte.
 *
 * `MarketRow` porte l'argent (pays de FACTURATION) ; `CountrySteps` porte le
 * trafic (pays de CONNEXION). Ils sont posés dans la même structure parce que
 * l'écran les montre côte à côte, mais AUCUN calcul ne les divise l'un par
 * l'autre : la conversion se dérive des visiteurs et des clients PostHog
 * seulement, et toutes les colonnes d'argent des seuls paiements Whop.
 *
 * Le coût est converti ICI, une fois : `lib/market-aggregate` reçoit un montant
 * déjà comparable au revenu, ou `null` quand aucun taux n'est réglé. Sans ce
 * `null`, un ratio euros/dollars sortirait un nombre sans unité.
 */
function factsOf(
  r: MarketRow,
  ctx: CurrencyContext,
  trafic: Map<string, CountrySteps>,
  plans: PlanCountryCell[],
): MarketFacts {
  const converti = toDisplayAmount(r.cost, ctx);
  const t = r.country === null ? undefined : trafic.get(r.country);
  return {
    country: r.country,
    creatorIds: r.creatorIds,
    videos: r.videos,
    cost: r.cost,
    costComparable:
      converti !== null && converti.rate !== null ? converti.value : null,
    clients: r.clients,
    payments: r.paid,
    revenueNet: r.revenueNet,
    previousClients: r.previousClients,
    previousRevenueNet: r.previousRevenueNet,
    cohortClients: r.cohortClients,
    curve: r.curve,
    survival: r.survival,
    visitors: t?.visitors ?? 0,
    trafficClients: t?.clients ?? 0,
    plans: plans
      .filter((c) => c.country === r.country)
      .map((c) => ({
        planId: c.planId,
        label: c.planLabel,
        price: c.price,
        clients: c.clients,
      })),
  };
}

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

  /**
   * LES MARCHÉS DÉRIVÉS — un par pays pour l'instant.
   *
   * `aggregateMarket` prend une LISTE de pays : ici elle n'en reçoit qu'un, et
   * c'est déjà la bonne forme pour les marchés composés qui viendront s'y
   * brancher sans toucher au rendu. Un pays seul et un marché de cinq pays
   * passent par la même dérivation, donc par les mêmes règles de seuil.
   */
  const marches: MarketDerived[] = useMemo(() => {
    const trafic = new Map(stepsOf(traffic).map((t) => [t.country, t]));
    const cells = pnl?.planCells ?? [];
    return (pnl?.rows ?? [])
      .map((r) =>
        aggregateMarket([factsOf(r, ctx, trafic, cells)], {
          key: r.country ?? "",
          label: r.country === null ? "Aucun pays défini" : isoCountryLabel(r.country),
          composed: false,
        }),
      )
      .sort((a, b) => {
        // Le RETOUR d'abord : c'est la question posée. Un marché sans dépense
        // n'en a pas et passe après, trié sur son revenu.
        if (a.retour === null && b.retour === null) return b.revenueNet - a.revenueNet;
        if (a.retour === null) return 1;
        if (b.retour === null) return -1;
        return b.retour - a.retour;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pnl, traffic]);

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


  /**
   * La série, agrégée TOUS MARCHÉS : la question du mois est « est-ce que ça
   * s'améliore », pas « où ». Le détail par pays existe déjà au-dessus, et
   * vingt courbes côte à côte ne se lisent pas.
   *
   * L'écart n'est calculé que si le coût a pu être converti — sinon on
   * soustrairait des dollars à des euros.
   */
  const mois = (() => {
    const parMois = new Map<string, { cost: number; revenueNet: number }>();
    for (const p of pnl.trend) {
      const d = parMois.get(p.month) ?? { cost: 0, revenueNet: 0 };
      d.cost = round2(d.cost + p.cost);
      d.revenueNet = round2(d.revenueNet + p.revenueNet);
      parMois.set(p.month, d);
    }
    return [...parMois.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => {
        const converti = toDisplayAmount(d.cost, ctx);
        return {
          month,
          ...d,
          ecart:
            converti !== null && converti.rate !== null
              ? round2(d.revenueNet - converti.value)
              : null,
        };
      });
  })();
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
            title="Le retour, marché par marché"
            subtitle="Ce qu'un client rapporte face à ce que le marché coûte. Trié par retour sur investissement."
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marché</TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Clients" info={EXPLAIN.marcheClients} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Coût / client" info={EXPLAIN.marcheCoutClient} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Panier" info={EXPLAIN.marchePanier} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Cycles" info={EXPLAIN.marcheCycles} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Valeur 30 j" info={EXPLAIN.marcheValeur30} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Valeur 90 j" info={EXPLAIN.marcheValeur90} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Survie" info={EXPLAIN.marcheSurvie} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Remboursé" info={EXPLAIN.marcheRemboursement} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Coût" info={EXPLAIN.marcheCout} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Revenu net" info={EXPLAIN.marcheRevenuNet} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Retour" info={EXPLAIN.marcheRetour} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marches.map((m) => (
                  <TableRow key={m.key || "(hors marché)"}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      <MarketLabel code={m.countries[0] ?? null} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {m.clients > 0 ? formatNumber(m.clients) : "—"}
                      <Variation value={m.deltaClients} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <CoutParClient
                        value={m.cac}
                        revenueCurrency={pnl.revenueCurrency}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {dash(m.basket, (n) =>
                        formatMoney(n, pnl.revenueCurrency ?? undefined),
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {dash(m.cycles, (n) => n.toFixed(1))}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <Valeur
                        point={m.value.find((v) => v.day === 30)}
                        revenueCurrency={pnl.revenueCurrency}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <Valeur
                        point={m.value.find((v) => v.day === 90)}
                        revenueCurrency={pnl.revenueCurrency}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <Survie steps={m.survival} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <Remboursement value={m.payback} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {m.cost > 0 ? argent(m.cost) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {m.revenueNet > 0
                        ? formatMoney(m.revenueNet, pnl.revenueCurrency ?? undefined)
                        : "—"}
                      <Variation value={m.deltaRevenue} />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <Retour value={m.retour} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-slate-400">
            <strong>Deux horloges sur la même ligne.</strong> Le coût, le revenu
            et les clients suivent la période choisie en haut ; la valeur à 30 et
            90 jours et la survie portent sur tous les clients du marché, parce
            qu&apos;elles décrivent le marché et non la fenêtre. Le{" "}
            <strong>coût</strong> vient du marché visé par le compte de la
            créatrice, le <strong>revenu</strong> de l&apos;adresse de facturation
            du client : deux notions de pays, mises face à face parce que
            c&apos;est la décision qu&apos;on prend, jamais divisées l&apos;une par
            l&apos;autre.
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

      {/* ── QUEL PLAN PASSE, ET OÙ ──────────────────────────────────────────
          Entièrement côté Whop : plan et pays y sont complets. Le « taux de
          réussite » est le seul taux mesurable sans croiser deux sources — il
          compare des tentatives de paiement à des encaissements. */}
      {pnl.planCells.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Quel plan passe, et où"
              subtitle="Paiements encaissés et part des tentatives qui aboutissent. Du moins cher au plus cher."
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Pays</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">Encaissés</TableHead>
                    <TableHead className="text-right">Réussite</TableHead>
                    <TableHead className="text-right">Revenu net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pnl.planCells.map((c) => {
                    const reussite =
                      c.attempts > 0 ? c.paid / c.attempts : null;
                    return (
                      <TableRow key={`${c.planId}|${c.country ?? ""}`}>
                        <TableCell className="text-xs text-slate-700">
                          <span className="font-medium">
                            {formatMoney(
                              c.price,
                              pnl.revenueCurrency ?? undefined,
                            )}
                          </span>
                          {/* Le slug vient de l'agrégat A/B ; Whop n'expose
                              aucun libellé. Absent ⇒ l'identifiant, jamais un
                              nom inventé. */}
                          <span className="ml-2 text-slate-400">
                            {c.planLabel ?? c.planId}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-medium text-slate-700">
                          <MarketLabel code={c.country} />
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(c.clients)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(c.paid)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-xs font-medium tabular-nums ${
                            reussite !== null && reussite < 0.6
                              ? "text-amber-700"
                              : ""
                          }`}
                        >
                          {pctFromFraction(reussite)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatMoney(c.net, pnl.revenueCurrency ?? undefined)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-slate-400">
              Le plan qu&apos;une personne peut acheter dépend de son bras de
              test A/B : une répartition par pays mélange donc la préférence et
              le tirage. Le taux de réussite, lui, se lit sans cette réserve —
              il porte sur des gens qui ont déjà choisi.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ── UN MARCHÉ DANS LE TEMPS ─────────────────────────────────────────
          Deux colonnes côte à côte, JAMAIS un ratio mensuel : le retour arrive
          après la dépense (une vidéo d'août encaisse en septembre) et le CPM
          d'une vidéo récente n'a pas fini de courir. */}
      {mois.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Un marché dans le temps"
              subtitle="Coût des vidéos publiées le mois, contre revenu encaissé le mois. Tous marchés confondus."
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mois</TableHead>
                    <TableHead className="text-right">Coût</TableHead>
                    <TableHead className="text-right">Revenu net</TableHead>
                    <TableHead className="text-right">Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mois.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        {m.month}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {argent(m.cost)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatMoney(
                          m.revenueNet,
                          pnl.revenueCurrency ?? undefined,
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right text-xs font-medium tabular-nums ${
                          m.ecart === null
                            ? ""
                            : m.ecart < 0
                              ? "text-rose-600"
                              : "text-emerald-600"
                        }`}
                      >
                        {dash(m.ecart, (n) =>
                          formatMoney(n, pnl.revenueCurrency ?? undefined),
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-slate-400">
              L&apos;écart d&apos;un mois n&apos;est pas sa rentabilité : une
              vidéo publiée en août encaisse encore en septembre, et son CPM
              continue de courir tant que le relevé lui ajoute des vues. Le mois
              en cours est un plancher, jamais un solde.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}