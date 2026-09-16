"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HubCardHeader, dash, HUB_TABLE_MOBILE } from "./HubPrimitives";
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
import { MarketComposer } from "./MarketComposer";
import { MarketQuadrant } from "./MarketQuadrant";
import { MarketPayback } from "./MarketPayback";
import { MarketValueCurve } from "./MarketValueCurve";
import { MarketDetailSheet } from "./MarketDetailSheet";
import { partitionMarches } from "@/lib/market-groups";
import type { MarketGroup } from "@/convex/marketGroups";
import {
  aggregateMarket,
  type MarketFacts,
} from "@/lib/market-aggregate";
import { decideMarket, type MarketVerdict } from "@/lib/market-decision";
import { MarketDecisionBoard, type DecidedMarket } from "./MarketDecisionBoard";
import { MarketRoiTable } from "./MarketRoiTable";
import { MarketRpmPlot } from "./MarketRpmPlot";

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
  const promoConverti = toDisplayAmount(r.promoCost, ctx);
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
    checkouts: t?.checkouts ?? 0,
    promoCost: r.promoCost,
    promoCostComparable:
      promoConverti !== null && promoConverti.rate !== null
        ? promoConverti.value
        : null,
    promoViews: r.promoViews,
    creatorsDetail: r.creatorsDetail,
    plans: plans
      .filter((c) => c.country === r.country)
      .map((c) => ({
        planId: c.planId,
        label: c.planLabel,
        price: c.price,
        clients: c.clients,
        localPrice: c.localPrice,
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

/** Ordre des lignes : ce qu'il faut faire d'abord. */
const ORDRE_VERDICT: MarketVerdict[] = [
  "accelerer",
  "reparer",
  "surveiller",
  "couper",
  "trop_tot",
  "sans_depense",
  "inconnu",
];

export function PaysTab({
  pnl,
  traffic,
  groups,
  error,
}: {
  pnl: MarketPnl | undefined;
  /** Funnel par pays attribué PAR PERSONNE (cf QUERIES.countryPersons). */
  traffic?: FunnelSegments;
  /** Les marchés composés du projet. `undefined` tant que la query charge. */
  groups?: MarketGroup[];
  /** Message d'échec de lecture — un tiret muet se lirait « pas de données ». */
  error?: string | null;
}) {
  /**
   * PAR PAYS ou PAR MARCHÉ. La maille vit dans l'écran et non en base : c'est
   * une façon de regarder, pas une décision d'équipe. Les marchés composés, eux,
   * sont partagés — c'est la distinction entre ce qu'on compose et ce qu'on
   * consulte.
   */
  const [maille, setMaille] = useState<"pays" | "marche">("marche");
  /**
   * LE MARCHÉ OUVERT, partagé par les trois vues. Une seule sélection pour le
   * quadrant, le remboursement, la courbe et le tableau : cliquer une bulle
   * souligne la même ligne ailleurs, et ouvre le même tiroir.
   */
  const [ouvert, setOuvert] = useState<string | null>(null);
  /** Ligne DÉPLIÉE du tableau de décision (créatrices, entonnoir, plans). */
  const [deplie, setDeplie] = useState<string | null>(null);
  /** Analyse détaillée (valeur, survie, trafic, plans, mois) : repliée par défaut. */
  const [analyse, setAnalyse] = useState(false);
  const tableau = useRef<HTMLDivElement>(null);
  const ouvrirLigne = (key: string) => {
    setDeplie(key);
    tableau.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };
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
   * LES MARCHÉS DÉRIVÉS — un par pays, ou un par marché composé.
   *
   * La PARTITION (`lib/market-groups`) dit quels pays vont ensemble ;
   * l'AGRÉGATION (`lib/market-aggregate`) somme puis divise une fois. Les deux
   * sont séparées exprès : on peut tester la partition sans fabriquer de
   * chiffres, et l'agrégation sans fabriquer de marchés.
   *
   * Un pays seul et un marché de cinq pays passent par la MÊME dérivation, donc
   * par les mêmes seuils d'effectif. C'est ce qui garantit qu'une valeur affichée
   * pour « Balkans » obéit aux mêmes règles que celle affichée pour la France.
   */
  const marches: DecidedMarket[] = useMemo(() => {
    const trafic = new Map(stepsOf(traffic).map((t) => [t.country, t]));
    const cells = pnl?.planCells ?? [];
    const parPays = new Map(
      (pnl?.rows ?? []).map((r) => [r.country ?? "", factsOf(r, ctx, trafic, cells)]),
    );
    const codes = (pnl?.rows ?? [])
      .map((r) => r.country)
      .filter((c): c is string => c !== null);

    // Par pays : la partition n'est pas consultée du tout. Passer une liste vide
    // de marchés rendrait le même résultat, mais le dire explicitement évite de
    // se demander plus tard si la bascule a un effet de bord.
    const groupes =
      maille === "pays"
        ? codes.map((c) => ({ key: c, label: c, pays: [c], composed: false }))
        : partitionMarches(
            codes,
            (groups ?? []).map((g) => ({
              id: g._id as string,
              nom: g.name,
              pays: g.countries,
            })),
          );

    const derives = groupes
      // Un marché dont tous les pays ont disparu des données n'a rien à montrer
      // ici. Il reste modifiable dans le composeur, qui, lui, le garde visible.
      .filter((g) => g.pays.length > 0)
      .map((g) =>
        aggregateMarket(
          g.pays.map((c) => parPays.get(c)!).filter(Boolean),
          {
            key: g.key,
            label: g.composed ? g.label : isoCountryLabel(g.label),
            composed: g.composed,
          },
        ),
      );

    // La ligne « hors marché » (coût sans pays cible) n'est PAS un marché : elle
    // ne se compose avec rien et garde sa place, comme avant.
    const horsMarche = parPays.get("");
    if (horsMarche) {
      derives.push(
        aggregateMarket([horsMarche], {
          key: "",
          label: "Aucun pays défini",
          composed: false,
        }),
      );
    }

    // Trié par VERDICT (ce qu'il faut faire), puis par retour d'acquisition. La
    // ligne hors marché ferme toujours la liste.
    return derives
      .map((m) => ({ ...m, decision: decideMarket(m) }))
      .sort((a, b) => {
        if (a.key === "") return 1;
        if (b.key === "") return -1;
        const va = ORDRE_VERDICT.indexOf(a.decision.verdict);
        const vb = ORDRE_VERDICT.indexOf(b.decision.verdict);
        if (va !== vb) return va - vb;
        return (b.acquisitionReturn ?? -1) - (a.acquisitionReturn ?? -1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pnl, traffic, groups, maille]);

  /**
   * Les pays PRÉSENTS dans les données, pour le composeur. On ne propose pas un
   * pays dont aucune ligne ne parle : composer « Slovénie » alors qu'elle n'a ni
   * coût ni client fabriquerait un marché qui ne s'affiche jamais.
   */
  const paysConnus = useMemo(
    () =>
      (pnl?.rows ?? [])
        .map((r) => r.country)
        .filter((c): c is string => c !== null)
        .sort((a, b) => isoCountryLabel(a).localeCompare(isoCountryLabel(b), "fr")),
    [pnl],
  );

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

      <MarketDecisionBoard
        marches={marches}
        devise={pnl.revenueCurrency}
        onOpen={ouvrirLigne}
      />

      <div ref={tableau} className="scroll-mt-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Marché par marché"
              subtitle="Clique un marché : ses créatrices, son entonnoir et les plans vendus."
            />
            <MarketComposer
              groups={groups ?? []}
              countries={paysConnus}
              maille={maille}
              onMaille={setMaille}
            />
            <MarketRoiTable
              marches={marches}
              devise={pnl.revenueCurrency}
              ctx={ctx}
              ouvert={deplie}
              onToggle={(k) => setDeplie((d) => (d === k ? null : k))}
              onDetail={setOuvert}
            />
            <p className="text-xs text-slate-400">
              Vues et coûts sur les posts <strong>promo</strong> uniquement, montants
              convertis en euros au taux du projet. Le <strong>coût</strong> suit le
              marché visé par le compte de la créatrice, le <strong>revenu</strong>{" "}
              le pays de facturation du client : les marchés composés rapprochent les
              deux. La valeur à 30 jours porte sur tous les clients du marché, pas
              seulement ceux de la période.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Ce que coûtent 1 000 vues, ce qu'elles valent"
            subtitle="Chaque bulle est un marché. Clique pour ouvrir sa ligne."
            info={EXPLAIN.marcheRpmAcquisition}
          />
          <MarketRpmPlot
            marches={marches}
            devise={pnl.revenueCurrency}
            onSelect={ouvrirLigne}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setAnalyse((a) => !a)}
          aria-expanded={analyse}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-300"
        >
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold text-slate-900">
              Analyse détaillée
            </span>
            <span className="block text-xs text-slate-500">
              Marge, valeur d&apos;un client dans le temps, remboursement, trafic par
              pays, plans vendus, évolution mensuelle.
            </span>
          </span>
          <ChevronDownIcon
            className={`size-4 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${
              analyse ? "rotate-180" : ""
            }`}
          />
        </button>
        {analyse ? (
          <div className="space-y-4">
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

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Ce qu'un client coûte, ce qu'il rapporte"
              subtitle="Chaque bulle est un marché, sa taille ses clients. Clique pour ouvrir son détail."
              info={EXPLAIN.marcheQuadrant}
            />
            <MarketQuadrant
              marches={marches}
              devise={pnl.revenueCurrency}
              selection={ouvert}
              onSelect={setOuvert}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Remboursé en combien de temps"
              subtitle="Jours avant que la valeur d'un client rattrape son coût d'acquisition."
              info={EXPLAIN.marcheRemboursement}
            />
            <MarketPayback
              marches={marches}
              selection={ouvert}
              onSelect={setOuvert}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="La valeur d'un client, jour après jour"
            subtitle="Trait plein : ce qu'il a rapporté. Pointillé : ce qu'il a coûté à acquérir."
            info={EXPLAIN.marcheCourbe}
          />
          <MarketValueCurve
            marches={marches}
            devise={pnl.revenueCurrency}
            selection={ouvert}
            onSelect={setOuvert}
          />
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
              <Table className={HUB_TABLE_MOBILE}>
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
              <Table className={HUB_TABLE_MOBILE}>
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
              <Table className={HUB_TABLE_MOBILE}>
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
        ) : null}
      </div>
      <MarketDetailSheet
        marche={marches.find((m) => m.key === ouvert) ?? null}
        ctx={ctx}
        devise={pnl.revenueCurrency}
        onClose={() => setOuvert(null)}
      />
    </div>
  );
}