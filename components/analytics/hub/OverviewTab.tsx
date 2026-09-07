"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { coherenceInputsFrom } from "@/lib/coherence-inputs";
import {
  buildCoherenceChecks,
  parisDayKey,
  parisShortDate,
  computeDelta,
} from "@/lib/analytics-hub";
import {
  ColLabel,
  DeltaBadge,
  HubCardHeader,
  HubNotice,
  WebhookFixNotice,
  disputeDeadlineLabel,
  dash,
} from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import { PromoRpmCard } from "./PromoRpmCard";
import { buildDayDetail } from "@/lib/day-detail";
import {
  previousWindow,
  rowsInWindow,
  sumInWindow,
  type AnalyticsWindow,
  type DataRange,
} from "@/lib/analytics-window";
import { windowCosts } from "@/lib/attribution-window";
import {
  toDisplayAmount,
  convertedValue,
  conversionNote,
  rateNote,
  type CurrencyContext,
} from "@/lib/currency-display";
import { PayCurrencyWarning } from "@/components/PayCurrencyWarning";
import { MixedCurrencyNotice } from "@/components/MixedCurrencyNotice";
import { HubTrendChart, type TrendPoint } from "./HubTrendChart";
import type {
  ProductAnalyticsData,
  RevenueData,
  ReliabilityData,
  AttributionData,
  ViewCountersData,
  DayDetailData,
} from "./types";

/**
 * Onglet VUE D'ENSEMBLE — les KPI de pilotage, un bandeau d'alerte tiré des
 * contrôles de cohérence, et le garde-fou C2 : si l'écart dashboard/Whop dépasse
 * 5 %, un bandeau REMPLACE les chiffres (un chiffre faux est pire qu'absent).
 *
 * Les KPI de conversion (visiteurs / inscrits / clients) suivent la période
 * choisie (série quotidienne PostHog, ancrée sur la date d'événement) et portent
 * une courbe LISIBLE (survol daté). La table « Détail par jour » donne la lecture
 * du matin : une ligne par jour, les chiffres clés côte à côte.
 */

/**
 * Le diviseur, avec son UNITÉ.
 *
 * « ÷ 154 clients acquis » ne dit pas si 154 compte des personnes ou des
 * abonnements — et les deux nombres se croisent : le 29/08 la prod portait 154
 * abonnements pour 145 personnes, le 30/08 164 abonnements pour 154 personnes.
 * Le même « 154 » désignait donc deux choses à un jour d'intervalle, ce qui a
 * suffi à faire lire un correctif comme non déployé. Le nombre d'abonnements
 * n'est rappelé que lorsqu'il DIFFÈRE — sinon il n'y a rien à distinguer.
 */
function denominateurLabel(clients: number, memberships: number | null | undefined): string {
  return memberships != null && memberships !== clients
    ? `${formatNumber(clients)} clients acquis (personnes ; ${formatNumber(memberships)} abonnements)`
    : `${formatNumber(clients)} clients acquis`;
}

/** Assemble un hint en sautant les morceaux vides — jamais un « · » orphelin. */
function joinHint(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(" · ");
}


// Jour Europe/Paris (`parisDayKey`) et étiquette (`parisShortDate`) : SOURCE
// UNIQUE partagée avec la courbe (HubTrendChart). La série PostHog est bucketisée
// Paris et le net Whop joint par jour Paris — voir lib/analytics-hub.

/** Une cellule de l'équation unitaire — même gabarit d'une cellule à l'autre. */
function UnitCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 basis-36 flex-col gap-0.5 p-4",
        accent && "bg-primary/5",
      )}
    >
      <span className="text-xs text-slate-500">{label}</span>
      <span
        className={cn(
          "text-xl font-semibold tabular-nums tracking-tight",
          accent ? "text-primary" : "text-slate-900",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** L'opérateur entre deux cellules : il porte le sens de lecture de la ligne. */
function UnitOp({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-2 text-sm text-slate-400">
      {children}
    </div>
  );
}

export function OverviewTab({
  analytics,
  revenue,
  reliability,
  attribution,
  viewCounters,
  dayDetail,
  window,
  dataRange,
  now,
}: {
  analytics: ProductAnalyticsData;
  revenue: RevenueData | undefined;
  reliability: ReliabilityData | undefined;
  attribution: AttributionData | undefined;
  viewCounters: ViewCountersData | undefined;
  dayDetail: DayDetailData | undefined;
  /** Fenêtre d'analyse (jours Paris, bornes incluses). null = aucune donnée. */
  window: AnalyticsWindow | null;
  /** Étendue réelle des données — sert à savoir si la fenêtre vaut le cumul. */
  dataRange: DataRange | null;
  now: number;
}) {
  // La série quotidienne, restreinte à la fenêtre. Toutes les tuiles en dérivent :
  // c'est la seule définition de « la période » sur cet écran.
  const daily = useMemo(() => {
    const all = [...analytics.overview.daily].sort((a, b) => a.ts - b.ts);
    return rowsInWindow(all, window, (d) => parisDayKey(d.ts));
  }, [analytics.overview.daily, window]);

  // Fenêtre couvrant TOUT : « sur la période » et « cumulé » sont alors le même
  // chiffre, on n'affiche pas deux fois la même chose.

  // Complétion sur la fenêtre : la série quotidienne porte checkouts ET subs, donc
  // le taux se recalcule sans passer par le funnel (qui, lui, n'est pas daté).
  const checkoutsWin = daily.reduce((t, d) => t + d.checkouts, 0);
  const subsWin = daily.reduce((t, d) => t + d.subs, 0);


  // Deux devises : le REVENU Whop (€, currency de la donnée) et la PAIE créatrices
  // ($, payCurrency). Jamais l'une pour l'autre — ici on les affiche CÔTE À CÔTE,
  // chacune dans sa devise, sans les soustraire (pas de marge combinée sur ces cartes).
  const currency = revenue?.currency ?? undefined; // revenu (€)
  const payCurrency = attribution?.payCurrency ?? undefined; // coût créateurs ($)
  // UNE SEULE devise d'affichage sur tout l'écran : celle du REVENU. Les coûts
  // créatrices sont en dollars dans la donnée et passent tous par ConvertedAmount.
  // Ils sortaient jusqu'ici en dollars, posés à côté d'un revenu par client en
  // euros comme s'ils étaient comparables — 10,62 $ face à 11,10 €, soit 9,13 €
  // convertis : l'erreur se lisait dans le MAUVAIS SENS.
  const fxCtx: CurrencyContext = {
    payCurrency,
    revenueCurrency: currency,
    fxRateToRevenue: attribution?.fxRateToRevenue,
  };

  // Écart client comparable (base du garde-fou) + libellé discret toujours visible.
  const coh = reliability?.coherence;

  // ── LE dénominateur, défini UNE fois, avant les contrôles ──────────────────
  // Clients acquis en PERSONNES (Whop fait foi). C'était `whopMembersTotal`, un
  // compte d'ABONNEMENTS : l'écran affichait trois effectifs de clients (144,
  // 153, 154) et divisait par celui que rien ne recoupait. Une re-souscription
  // du même humain n'est pas une acquisition de plus — elle ne doit pas alléger
  // un coût par client.
  //
  // Il est déclaré ici pour être PASSÉ aux contrôles : le module compare le
  // diviseur réellement utilisé à la référence. Le rebrancher un jour sur
  // `whopMembersTotal` rallumerait le contrôle au lieu de passer inaperçu.
  const clients = coh?.whopClientsTotal ?? null;

  // Garde-fou C2 : écart dashboard vs Whop.
  const checks = useMemo(() => {
    const c = reliability?.coherence;
    if (!c) return [];
    return buildCoherenceChecks(coherenceInputsFrom(c, { unitCostDenominator: clients }));
  }, [reliability, clients]);

  // « Clients payants »/jour = SOURCE WHOP (dailyPaidClients), pas PostHog subs :
  // aligné sur le revenu et le gros chiffre (Whop fait foi), sans décalage de cache.
  // La courbe et la colonne réutilisent la grille de jours PostHog (parisDay) pour
  // l'axe temporel, mais la VALEUR affichée vient de Whop.
  const clientsByDay = useMemo(
    () =>
      new Map(
        (coh?.dailyPaidClients ?? []).map((d) => [d.day, d.clients] as const),
      ),
    [coh],
  );
  // RENOUVELLEMENTS/jour (Whop, billing_reason=subscription_cycle). Colonne jumelle :
  // `dailyPaidClients` ne compte que les PREMIERS paiements, donc une journée faite
  // uniquement de renouvellements y affiche 0 à côté d'un revenu non nul.
  const membershipsByDay = useMemo(
    () =>
      new Map(
        (coh?.dailyNewMemberships ?? []).map((d) => [d.day, d.memberships] as const),
      ),
    [coh],
  );
  const renewalsByDay = useMemo(
    () =>
      new Map(
        (coh?.dailyRenewals ?? []).map((d) => [d.day, d.renewals] as const),
      ),
    [coh],
  );
  // Contrôle de LIGNE : « nouveaux clients + renouvellements » doit égaler le
  // nombre de paiements composant le net. Un écart = un paiement compté deux fois
  // — cas réel : un renouvellement qui est AUSSI le premier encaissement de son
  // abonnement (paiement initial remboursé). Sans ce contrôle, la ligne se lit
  // comme une incohérence de montant alors que c'est un doublon d'effectif.
  const payCountByDay = useMemo(
    () =>
      new Map(
        (coh?.dailyPaymentCount ?? []).map((d) => [d.day, d.payments] as const),
      ),
    [coh],
  );
  // Tentatives de paiement ÉCHOUÉES par jour (Whop) → colonne « Échecs ». Un échec
  // n'est PAS un client (0 au net) mais doit être visible à côté des réussites.
  const failedByDay = useMemo(
    () =>
      new Map(
        (coh?.dailyFailedPayments ?? []).map((d) => [d.day, d.count] as const),
      ),
    [coh],
  );

  // Litiges (chargebacks) EN COURS — argent À RISQUE, déjà retiré du net. Bandeau
  // ROUGE d'accueil : c'est ce qui compte le plus (frais de litige > abonnement).
  // Le détail (délai par litige, remboursements) vit dans « Offres & tests ».
  const openDisputes = revenue?.disputes ?? [];
  const disputedTotal = revenue?.disputedTotal ?? 0;
  const soonestDispute =
    openDisputes.length > 0
      ? disputeDeadlineLabel(openDisputes[0].dueAt, now)
      : null;

  // Écart dashboard/Whop, en PERSONNES des deux côtés. Il se comparait jusqu'ici
  // aux ABONNEMENTS Whop : PostHog compte des `person_id`, Whop des memberships,
  // et une personne à deux abonnements pesait 1 d'un côté et 2 de l'autre. Relevé
  // du 2026-08-29 : 144 personnes PostHog contre 153 abonnements → « écart 9 »,
  // au-delà des deux seuils, « Clients payants » suspendu — pour un écart réel
  // NUL (153 abonnements = 144 personnes). Ce n'était pas une dérive à
  // surveiller, c'était une unité ; l'écart ne pouvait que croître avec le volume.
  const dashboardWhopViolation = checks.some(
    (c) => c.key === "dashboard_vs_whop" && c.status === "violation",
  );
  const violations = checks.filter((c) => c.status === "violation");

  // ── Éco unitaire : trois montants, TOUS dans la devise du revenu ───────────
  // Global, PLUS de restriction aux jours solo (elle n'était utile qu'à
  // l'attribution PAR créatrice) : le coût total / clients n'a pas besoin
  // d'attribuer chaque client à une créatrice.
  //
  // Le dénominateur (`clients`) est défini plus haut : les contrôles le reçoivent.
  // On ne divise PAS pendant que le garde-fou suspend ce même nombre : la
  // carte « Clients payants » affichait « chiffres suspendus » deux lignes plus
  // bas pendant que celles-ci imprimaient « ÷ 154 clients acquis ». Un nombre
  // suspendu et utilisé comme diviseur dans le même écran.

  // ── Fenêtrage ─────────────────────────────────────────────────────────────
  // UNE fonction, appelée pour la fenêtre COURANTE et pour la PRÉCÉDENTE. C'est
  // ce qui garantit qu'un delta compare deux choses calculées à l'identique — le
  // badge « stable » affiché sur neuf tuiles ne comparait, lui, rien du tout.
  //
  // Le dénominateur `clients` est en PERSONNES (cf convex/whopClients) : Σ des
  // jours = whopClientsTotal par construction, donc « ÷ N clients » garde la MÊME
  // unité que le cumul.
  const aggregatesFor = (w: AnalyticsWindow | null) => {
    const clients = sumInWindow(
      coh?.dailyPaidClients ?? [],
      w,
      (d) => d.day,
      (d) => d.clients,
    );
    const net =
      revenue?.configured && !revenue.mixedCurrency
        ? sumInWindow(revenue.dailyNet, w, (d) => d.day, (d) => d.net)
        : null;
    // Les coûts viennent du POINT UNIQUE (lib/attribution-window) : les autres
    // onglets lisent le même calcul, donc deux écrans ne peuvent pas afficher
    // deux coûts pour la même période.
    const {
      promo: promoCost,
      full: fullCost,
      bonus,
      promoViews,
    } = windowCosts(attribution?.rows ?? [], attribution?.costs.promoBonusByDay ?? [], w);
    // Coût TOTAL en devise du REVENU : c'est le seul terme soustractible du net.
    const costAll =
      fullCost !== null && bonus !== null
        ? toDisplayAmount(fullCost + bonus, fxCtx)
        : null;
    const marge =
      net !== null && costAll !== null
        ? Math.round((net - costAll.value) * 100) / 100
        : null;
    const canDivide = clients !== null && clients > 0 && !dashboardWhopViolation;
    const per = (n: number | null): number | null =>
      n !== null && canDivide
        ? Math.round((n / (clients as number)) * 100) / 100
        : null;
    return {
      clients,
      net,
      costAll,
      marge,
      promoViews,
      canDivide,
      acquisition: toDisplayAmount(
        promoCost !== null && bonus !== null ? per(promoCost + bonus) : null,
        fxCtx,
      ),
      // Le coût complet fenêtré n'inclut PAS les récompenses en nature : dues
      // sans date d'exigibilité exploitable. Le cumul, lui, les porte.
      fullEngine: toDisplayAmount(
        fullCost !== null && bonus !== null ? per(fullCost + bonus) : null,
        fxCtx,
      ),
      revenuePer: net !== null && canDivide ? per(net) : null,
      viewsPer:
        canDivide && promoViews > 0
          ? Math.round(promoViews / (clients as number))
          : null,
    };
  };
  const cur = aggregatesFor(window);
  const prev = aggregatesFor(previousWindow(window, dataRange));
  /** Delta seulement si les DEUX termes existent — sinon rien, jamais « stable ». */
  const deltaOf = (a: number | null, b: number | null) =>
    a !== null && b !== null && b !== 0 ? computeDelta(a, b) : null;

  // L'équation du rang 2. `margePerClient` se calcule sur les MÊMES termes que
  // ceux affichés, jamais sur la marge globale divisée : sinon la ligne ne se
  // vérifierait pas de tête.
  const margePerClient =
    cur.revenuePer !== null && cur.acquisition !== null
      ? Math.round((cur.revenuePer - cur.acquisition.value) * 100) / 100
      : null;
  const roas =
    cur.revenuePer !== null && cur.acquisition !== null && cur.acquisition.value > 0
      ? Math.round((cur.revenuePer / cur.acquisition.value) * 10) / 10
      : null;

  // L'entonnoir : chaque étape porte son taux de passage depuis la précédente,
  // et une barre à l'échelle des VISITEURS (pas de barre normalisée par étape,
  // qui masquerait l'effondrement réel).
  const visiteurs = daily.reduce((t, d) => t + d.visitors, 0);
  const inscrits = daily.reduce((t, d) => t + d.signups, 0);
  const rate = (a: number, b: number) =>
    b > 0 ? Math.round((a / b) * 1000) / 10 : null;
  // Les explications suivent le NOMBRE, pas la tuile qui le portait : « Clients
  // payants » a perdu sa carte, son « i » vit désormais sur l'étape finale de
  // l'entonnoir. Sans ça, la refonte aurait supprimé une explication utile —
  // c'est exactement ce que la CI a attrapé.
  const funnelSteps = [
    {
      key: "visiteurs",
      label: "Visiteurs",
      value: visiteurs,
      rate: null as number | null,
      info: EXPLAIN.visiteurs as React.ReactNode,
    },
    {
      key: "inscrits",
      label: "Inscrits",
      value: inscrits,
      rate: rate(inscrits, visiteurs),
      info: EXPLAIN.inscrits as React.ReactNode,
    },
    {
      key: "checkouts",
      label: "Checkouts",
      value: checkoutsWin,
      rate: rate(checkoutsWin, inscrits),
      info: EXPLAIN.completionCheckout as React.ReactNode,
    },
    {
      key: "clients",
      label: "Clients payants",
      value: subsWin,
      rate: rate(subsWin, checkoutsWin),
      info: EXPLAIN.clientsPayants as React.ReactNode,
    },
  ].map((st) => ({
    ...st,
    width: visiteurs > 0 ? Math.max(1.2, (st.value / visiteurs) * 100) : 0,
  }));

  // Carte 1 — coût d'acquisition : (fixe + CPM promo + PART du bonus) / clients. Le
  // bonus débloqué est une dépense réelle, réparti au prorata des vues promo (part
  // affichée sous la carte). Tiret seulement si un coût par vidéo manque (legacy).
  const c = attribution?.costs;
  // Bonus inclus EN ENTIER : un palier ne se gagne que sur des vues promo, donc
  // tout bonus débloqué est un coût promo (plus de prorata, cf getAttribution).
  // `promoBonus` porte AUSSI les primes de défi ; le libellé les nomme séparément
  // quand il y en a, sinon « bonus de paliers » désignerait une dépense qui n'en
  // est pas une.
  const acquisitionBonus = toDisplayAmount(c?.promoBonus, fxCtx);
  const challengePrizes = toDisplayAmount(c?.challengeTotal ?? 0, fxCtx);
  const hasChallenge =
    challengePrizes !== null && challengePrizes.sourceValue > 0;
  const hasTiers =
    acquisitionBonus !== null &&
    challengePrizes !== null &&
    acquisitionBonus.sourceValue - challengePrizes.sourceValue > 0;
  // Carte 2 — coût complet du moteur : toute la paie (warmup + 100 % du bonus cash
  // + les récompenses en NATURE déjà dues) / clients. Une récompense en nature sans
  // coût réel renseigné est ABSENTE du total : on le dit, plutôt que de présenter
  // un coût incomplet comme entier.
  const natureDue = toDisplayAmount(attribution?.costs.natureDue ?? 0, fxCtx);
  const natureMissing = attribution?.costs.natureDueMissingCost ?? 0;


  // A5 — la garde du serveur est posée PAR PÉRIODE ; cette somme la traverse.
  // Deux mois encaissés dans deux devises passent chacun la garde puis sont
  // additionnés ici. `revenue.mixedCurrency` est global (calculé sur TOUS les
  // paiements) : s'y adosser referme le trou. null ⇒ la tuile affiche « — ».
  // Vues promo par client : MÊME référence que les coûts unitaires (clients
  // acquis, personnes, Whop fait foi) — c'était le compteur PostHog, une
  // quatrième définition de « client » sur le même écran.
  // Carte 3 — revenu net (€) par client. Dénominateur = clients au net SÉCURISÉ,
  // PAS tous les clients acquis : le numérateur (totalNet) exclut les litiges en
  // cours, donc les compter au dénominateur tirerait la moyenne vers le bas sans
  // que rien ne le dise. Mesuré en prod : 6,52 € au lieu de 6,92 €.
  // Le coût d'acquisition, lui, garde les clients ACQUIS (la dépense a bien été
  // engagée pour eux) — les deux cartes affichent donc leur dénominateur.
  const securedClients = coh?.whopSecuredClients ?? null;
  const atRiskClients =
    clients !== null && securedClients !== null ? clients - securedClients : 0;

  // Net Whop joint par jour Europe/Paris — sert au tableau « Détail par jour »
  // ET à la courbe du rang 1. Une seule courbe sur l'écran, sur le REVENU :
  // c'est la trajectoire qui décide. Les sparklines de visiteurs et d'inscrits
  // vivaient sur des tuiles que le rang 3 remplace ; leur tendance se lit
  // désormais dans le tableau.
  const netByDay = useMemo(
    () => new Map((revenue?.dailyNet ?? []).map((d) => [d.day, d.net])),
    [revenue],
  );
  const netPts: TrendPoint[] = daily.map((d) => ({
    ts: d.ts,
    value: netByDay.get(parisDayKey(d.ts)) ?? 0,
  }));
  const dailyRows = useMemo(() => [...daily].reverse(), [daily]);
  /** Jour déplié — un seul à la fois : deux décompositions ouvertes côte à côte
   *  se comparent mal, les sous-lignes n'étant pas alignées verticalement. */
  const [ouvert, setOuvert] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <WebhookFixNotice now={now} />

      {/* Litiges bancaires EN COURS — l'alerte la plus urgente de l'écran. */}
      {openDisputes.length > 0 ? (
        <HubNotice className="border-red-300 bg-red-50 text-red-900">
          <strong>
            {openDisputes.length} litige{openDisputes.length > 1 ? "s" : ""} bancaire
            {openDisputes.length > 1 ? "s" : ""} en cours
            {disputedTotal > 0
              ? ` — ${formatMoney(disputedTotal, currency)} à risque`
              : ""}
            {soonestDispute ? ` · ${soonestDispute.label}` : ""}.
          </strong>{" "}
          Les frais de litige dépassent souvent l&apos;abonnement et une accumulation
          met en péril le compte marchand. Déjà retiré du revenu net ; détail (délai
          par litige, remboursements) dans l&apos;onglet Offres &amp; tests.
        </HubNotice>
      ) : null}

      {/* Contrôles en écart — la RAISON est écrite dans le bandeau, pas seulement
          le nom du contrôle : une alerte dont on doit aller chercher la cause
          ailleurs finit par ne plus être lue. Les écarts à cause CONNUE (les
          renouvellements comptés comme des conversions) ne sont plus des
          violations et ne passent donc plus par ici — voir buildCoherenceChecks. */}
      {violations.length > 0 ? (
        <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
          <strong>
            {violations.length} contrôle{violations.length > 1 ? "s" : ""} de
            cohérence en écart.
          </strong>
          <ul className="mt-1 space-y-0.5">
            {violations.map((v) => (
              <li key={v.key}>
                <span className="font-medium">{v.label}</span>
                {v.detail ? ` — ${v.detail}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1">Détail complet dans l&apos;onglet Fiabilité.</p>
        </HubNotice>
      ) : null}

      {attribution ? (
        <PayCurrencyWarning payCurrency={attribution.payCurrency} />
      ) : null}

      {/* A5 — le drapeau existait côté serveur sans aucun lecteur : un projet
          bi-devise affichait « 0,00 » sans dire pourquoi. Indépendant de
          `attribution` : il porte sur le REVENU, pas sur la paie. */}
      <MixedCurrencyNotice
        mixed={revenue?.mixedCurrency}
        present={revenue?.mixedCurrencyPresent}
        converted={revenue?.convertedFrom != null}
        convertedFrom={revenue?.convertedFrom}
        fxRate={revenue?.fxRate}
        currency={revenue?.currency}
        currencies={revenue?.currenciesPresent}
      />

      {/* ── RANG 1 · Le verdict ────────────────────────────────────────────
          Un seul chiffre domine. Revenu et coût le flanquent en plus petit :
          ils l'EXPLIQUENT, ils ne le concurrencent pas. Avant, dix tuiles de
          poids identique — donc aucune ne se lisait en premier. */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex flex-col gap-1 p-5 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <ColLabel label="Marge nette" info={EXPLAIN.margeNette} />
              <DeltaBadge delta={deltaOf(cur.marge, prev.marge)} />
            </div>
            <div
              className={cn(
                "text-4xl font-semibold tabular-nums tracking-tight lg:text-5xl",
                (cur.marge ?? 0) < 0 ? "text-red-700" : "text-emerald-700",
              )}
            >
              {cur.marge === null ? "—" : formatMoney(cur.marge, currency)}
            </div>
            <p className="text-xs text-slate-400">
              revenu net encaissé − coût créateurs converti
            </p>
          </div>
          <div className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              Revenu net
              <DeltaBadge delta={deltaOf(cur.net, prev.net)} />
            </div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
              {cur.net === null ? "—" : formatMoney(cur.net, currency)}
            </div>
            <p className="text-xs text-slate-400">
              {revenue?.feeRate != null
                ? `après frais Whop · ${formatNumber(Math.round(revenue.feeRate * 1000) / 10)} %`
                : "après frais Whop"}
            </p>
            {netPts.length > 1 ? (
              <HubTrendChart
                points={netPts}
                height={44}
                maxTicks={2}
                ariaLabel="Revenu net par jour"
                formatValue={(n: number) => formatMoney(n, currency)}
                className="mt-1"
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              Coût créateurs
              {/* Un coût qui MONTE n'est pas une bonne nouvelle : on inverse le
                  sens de lecture plutôt que de peindre une hausse en vert. */}
              <DeltaBadge
                delta={deltaOf(cur.costAll?.value ?? null, prev.costAll?.value ?? null)}
                invert
              />
            </div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
              {cur.costAll === null ? "—" : formatMoney(cur.costAll.value, cur.costAll.currency)}
            </div>
            <p className="text-xs text-slate-400">fixe + CPM + bonus + défis</p>
          </div>
        </div>
      </Card>

      {/* Le garde-fou reste AU-DESSUS de l'équation : sans lui, les tirets du
          rang 2 s'afficheraient sans que rien n'en donne la raison. */}
      {dashboardWhopViolation ? (
        <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
          <strong>Chiffres par client suspendus.</strong> L&apos;écart
          dashboard/Whop dépasse À LA FOIS 5 % ET 5 clients. Un chiffre faux est
          pire qu&apos;un chiffre absent : on affiche le contrôle, pas le nombre.
        </HubNotice>
      ) : null}

      {/* ── RANG 2 · L'unitaire, écrit comme une équation ───────────────────
          La soustraction est déjà dans la tête du lecteur ; l'écran la fait.
          Le dénominateur est écrit UNE fois sous le bloc — il est le même pour
          les quatre cellules, et il occupait trois sous-titres de trois lignes. */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-stretch divide-x divide-slate-100">
          <UnitCell
            label="Revenu par client"
            value={cur.revenuePer === null ? "—" : formatMoney(cur.revenuePer, currency)}
          />
          <UnitOp>−</UnitOp>
          <UnitCell label="Coût d'acquisition" value={convertedValue(cur.acquisition)} />
          <UnitOp>=</UnitOp>
          <UnitCell
            label="Marge par client"
            value={margePerClient === null ? "—" : formatMoney(margePerClient, currency)}
            accent
          />
          <UnitOp>soit</UnitOp>
          <UnitCell
            label="Retour sur acquisition"
            value={roas === null ? "—" : `${formatNumber(roas)}×`}
          />
        </div>
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          {joinHint([
            cur.clients !== null
              ? `tous ÷ ${denominateurLabel(cur.clients, coh?.whopMembersTotal)}`
              : null,
            acquisitionBonus !== null && acquisitionBonus.sourceValue > 0
              ? `dont ${convertedValue(acquisitionBonus)} de ${
                  hasChallenge && hasTiers
                    ? "bonus de paliers et de primes de défi"
                    : hasChallenge
                      ? "primes de défi"
                      : "bonus de paliers"
                }`
              : null,
            cur.fullEngine !== null
              ? `coût complet du moteur, warmup inclus : ${convertedValue(cur.fullEngine)}/client`
              : null,
            natureDue !== null && natureDue.sourceValue > 0
              ? `+ ${convertedValue(natureDue)} de récompenses en nature dues (dans le coût complet, cumulé)`
              : null,
            natureMissing > 0
              ? `sous-estimé : ${formatNumber(natureMissing)} récompense(s) en nature sans coût réel`
              : null,
            // Le numérateur du revenu par client EXCLUT les litiges en cours ; le
            // dénominateur fenêtré, lui, compte tous les clients acquis. L'écart
            // tire la moyenne vers le bas — on le DIT plutôt que de le taire.
            atRiskClients > 0
              ? `${formatNumber(atRiskClients)} client(s) en litige : leur revenu est hors du numérateur`
              : null,
            conversionNote(cur.acquisition),
            rateNote(fxCtx) !== "" ? rateNote(fxCtx) : null,
          ])}
        </p>
      </Card>

      {/* ── RANG 3 · L'entonnoir ────────────────────────────────────────────
          Visiteurs → inscrits → checkouts → clients est un ENCHAÎNEMENT : les
          taux de passage disent en un coup d'œil où ça fuit. « Complétion
          checkout » était isolée de ses propres termes, sur une autre ligne. */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <HubCardHeader
              title="Du visiteur au client"
              subtitle=""
              info={EXPLAIN.completionCheckout}
            />
            <p className="text-xs text-slate-500">
              {joinHint([
                cur.viewsPer !== null
                  ? `1 client pour ${formatViews(cur.viewsPer)} vues promo`
                  : null,
                "RPM détaillé plus bas",
              ])}
            </p>
          </div>
          <div className="flex items-end gap-1 overflow-x-auto pb-1">
            {funnelSteps.map((st, i) => (
              <Fragment key={st.key}>
                {i > 0 ? (
                  <span className="shrink-0 pb-6 font-mono text-[11px] text-slate-400">
                    {st.rate === null ? "—" : `${formatNumber(st.rate)} %`} →
                  </span>
                ) : null}
                <div className="flex min-w-[6.5rem] flex-1 flex-col gap-1.5">
                  <span className="text-base font-semibold tabular-nums text-slate-900">
                    {dash(st.value)}
                  </span>
                  <span
                    className={cn(
                      "h-1.5 rounded-sm",
                      st.key === "clients" ? "bg-emerald-600" : "bg-primary/80",
                    )}
                    style={{ width: `${st.width}%` }}
                  />
                  <span className="text-xs text-slate-500">
                    <ColLabel label={st.label} info={st.info} />
                  </span>
                </div>
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* RPM promo — revenu, coût et écart pour 1 000 vues promo. */}
      <PromoRpmCard
        revenue={revenue}
        attribution={attribution}
        viewCounters={viewCounters}
      />

      {/* Détail par jour — la lecture du matin. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Détail par jour"
            subtitle="Une ligne par jour, du plus récent au plus ancien. Le pic du 27/07 saute aux yeux ici."
            info={EXPLAIN.detailParJour}
          />
          {dailyRows.length === 0 ? (
            <p className="text-sm text-slate-400">
              — en attente de la synchro PostHog.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jour</TableHead>
                    <TableHead className="text-right">Visiteurs</TableHead>
                    <TableHead className="text-right">Inscriptions</TableHead>
                    <TableHead className="text-right">Checkouts ouverts</TableHead>
                    <TableHead className="text-right">Nouveaux clients</TableHead>
                    <TableHead className="text-right">Renouvellements</TableHead>
                    <TableHead className="text-right">Échecs</TableHead>
                    <TableHead className="text-right">Revenu net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyRows.map((d) => {
                    const net = netByDay.get(parisDayKey(d.ts));
                    const failed = failedByDay.get(parisDayKey(d.ts)) ?? 0;
                    const jour = parisDayKey(d.ts);
                    const estOuvert = ouvert === jour;
                    return (
                      <Fragment key={d.ts}>
                      <TableRow
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setOuvert(estOuvert ? null : jour)}
                      >
                        <TableCell className="text-xs tabular-nums text-slate-600">
                          <span className="mr-1 inline-block w-3 text-slate-300">
                            {estOuvert ? "▾" : "▸"}
                          </span>
                          {parisShortDate(d.ts)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(d.visitors)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(d.signups)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(d.checkouts)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(clientsByDay.get(parisDayKey(d.ts)) ?? 0)}
                        </TableCell>
                        {/* Renouvellements : un jour peut n'avoir AUCUN nouveau client
                            et rapporter quand même — sans cette colonne, « 0 » se lit
                            comme une journée morte alors que le revenu est là. */}
                        <TableCell className="text-right text-xs tabular-nums">
                          {(() => {
                            const k = parisDayKey(d.ts);
                            const ren = renewalsByDay.get(k) ?? 0;
                            const nouveaux = clientsByDay.get(k) ?? 0;
                            const pay = payCountByDay.get(k);
                            // Le contrôle se fait en ABONNEMENTS, pas en personnes :
                            // `pay` compte des PAIEMENTS, et la colonne affichée
                            // compte des personnes depuis que le dénominateur du hub
                            // a été replié (une personne à deux abonnements le même
                            // jour = 1 client, 2 paiements). Comparer les deux
                            // faisait sonner l'alerte sur 14 jours sur 39 pour un
                            // écart d'UNITÉ, pas pour une incohérence.
                            const abos = membershipsByDay.get(k) ?? nouveaux;
                            const ecart =
                              pay !== undefined && abos + ren !== pay
                                ? abos + ren - pay
                                : 0;
                            return (
                              <>
                                {ren > 0 ? (
                                  <span className="font-medium text-emerald-700">
                                    {formatNumber(ren)}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">0</span>
                                )}
                                {ecart !== 0 ? (
                                  <span
                                    className="ml-1 cursor-help font-medium text-amber-700"
                                    title={`${formatNumber(abos)} nouvel(s) abonnement(s) + ${formatNumber(ren)} renouvellement(s) = ${formatNumber(abos + ren)}, pour ${formatNumber(pay as number)} paiement(s) composant le revenu net. Écart de ${formatNumber(Math.abs(ecart))} : un paiement est compté dans les deux colonnes (renouvellement qui est aussi le premier encaissement de son abonnement).${abos !== nouveaux ? ` La colonne affiche ${formatNumber(nouveaux)} client(s) : ${formatNumber(abos - nouveaux)} abonnement(s) de plus que de personnes ce jour-là.` : ""}`}
                                  >
                                    ⚠
                                  </span>
                                ) : null}
                              </>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {failed > 0 ? (
                            <span className="font-medium text-red-600">
                              {formatNumber(failed)}
                            </span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums font-medium">
                          {net === undefined ? "—" : formatMoney(net, currency)}
                        </TableCell>
                      </TableRow>
                      {estOuvert ? (
                        <DayDetailRows
                          jour={jour}
                          detail={dayDetail}
                          currency={currency}
                          visitorsThrough={parisShortDate(d.ts)}
                        />
                      ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Une cellule de sous-ligne : « — » quand la valeur n'est pas mesurable. */
function SubCell({ value, format }: { value: number | null; format?: (n: number) => string }) {
  return (
    <TableCell className="text-right text-xs tabular-nums text-slate-500">
      {value === null ? (
        <span className="text-slate-300">—</span>
      ) : (
        (format ?? formatNumber)(value)
      )}
    </TableCell>
  );
}

/**
 * Les sous-lignes d'une journée dépliée — mêmes colonnes que le tableau, pour
 * qu'un chiffre se lise dans la verticale de son en-tête.
 *
 * Le groupe PAYS ne remplit que le trafic, et la mention le dit UNE FOIS, en
 * toutes lettres : le pays vient de PostHog et ne couvre que les étapes émises
 * côté navigateur, Whop ne porte aucun pays donc l'argent n'est pas ventilable
 * par pays. Les cellules concernées affichent un TIRET et jamais un zéro — un
 * zéro se lirait « ce pays ne convertit pas » là où il veut dire « on ne mesure
 * pas », et l'œil retient le chiffre plutôt que la note.
 */
function DayDetailRows({
  jour,
  detail,
  currency,
  visitorsThrough,
}: {
  jour: string;
  detail: DayDetailData | undefined;
  currency: string | undefined;
  visitorsThrough: string;
}) {
  if (detail === undefined) {
    return (
      <TableRow className="bg-slate-50/60">
        <TableCell colSpan={8} className="py-3 text-xs text-slate-400">
          — chargement du détail…
        </TableCell>
      </TableRow>
    );
  }
  const d = buildDayDetail({ day: jour, ...detail });
  if (d.isEmpty) {
    return (
      <TableRow className="bg-slate-50/60">
        <TableCell colSpan={8} className="py-3 text-xs text-slate-400">
          Aucune décomposition pour cette journée.
        </TableCell>
      </TableRow>
    );
  }
  const money = (n: number) => formatMoney(n, currency);
  const groupe = (titre: string) => (
    <TableRow className="bg-slate-50/60">
      <TableCell
        colSpan={8}
        className="pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-slate-400"
      >
        {titre}
      </TableCell>
    </TableRow>
  );
  const ligne = (r: ReturnType<typeof buildDayDetail>["countries"][number], k: string) => (
    <TableRow key={k} className="bg-slate-50/60">
      {/* `r.label` est DÉJÀ humanisé pour les groupes pays (cf lib/day-detail) :
          le rendu ne décide plus de traduire ou non. Il le décidait en reniflant
          un préfixe de clé React, ce qui est devenu faux le jour où la requête
          est passée du nom anglais au code ISO. */}
      <TableCell className="py-1.5 pl-8 text-xs text-slate-600">{r.label}</TableCell>
      <SubCell value={r.visitors} />
      <SubCell value={r.signups} />
      <SubCell value={r.checkouts} />
      <SubCell value={r.clients} />
      <SubCell value={r.renewals} />
      <SubCell value={r.failures} />
      <SubCell value={r.net} format={money} />
    </TableRow>
  );
  return (
    <>
      {d.countries.length > 0 ? (
        <>
          {groupe("Par pays de connexion — trafic")}
          {d.countries.map((r) => ligne(r, `c:${r.label}`))}
        </>
      ) : null}
      {d.billingCountries.length > 0 ? (
        <>
          {groupe("Par pays de facturation — ventes")}
          {d.billingCountries.map((r) => ligne(r, `b:${r.label}`))}
        </>
      ) : null}
      {d.countries.length > 0 || d.billingCountries.length > 0 ? (
        <TableRow className="bg-slate-50/60">
          <TableCell colSpan={8} className="pb-2 pl-8 text-xs text-slate-400">
            Deux pays, deux sources, deux populations — d&apos;où deux groupes et
            non des colonnes de plus. Le <strong>pays de connexion</strong> vient
            de l&apos;adresse IP (PostHog) et ne couvre que le trafic : les étapes
            émises côté serveur en sont exclues, faute d&apos;IP visiteur. Le{" "}
            <strong>pays de facturation</strong> vient de l&apos;adresse que Whop
            collecte pour la TVA et ne couvre que l&apos;argent. Les deux lignes
            « France » ne désignent pas les mêmes personnes : leurs chiffres ne se
            divisent pas entre eux.
          </TableCell>
        </TableRow>
      ) : null}
      {d.refs.length > 0 ? (
        <>
          {groupe("Par ref")}
          {d.refs.map((r) => ligne(r, `r:${r.label}`))}
        </>
      ) : null}
      {d.revenue.length > 0 ? (
        <>
          {groupe("Revenu")}
          {d.revenue.map((r) => (
            <TableRow key={`v:${r.label}`} className="bg-slate-50/60">
              <TableCell className="py-1.5 pl-8 text-xs text-slate-600">
                {r.label}
              </TableCell>
              <TableCell colSpan={6} />
              <TableCell
                className={`text-right text-xs tabular-nums ${
                  r.net < 0 ? "text-rose-600" : "text-slate-500"
                }`}
              >
                {money(r.net)}
              </TableCell>
            </TableRow>
          ))}
        </>
      ) : null}
      <TableRow className="bg-slate-50/60">
        <TableCell colSpan={8} className="pb-3 pl-8 text-xs text-slate-400">
          Visiteurs et inscriptions : relevé PostHog du {visitorsThrough} · ventes
          et revenu : Whop, synchronisé toutes les heures.
        </TableCell>
      </TableRow>
    </>
  );
}
