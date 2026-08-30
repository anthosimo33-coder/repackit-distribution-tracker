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
import { formatNumber } from "@/lib/format";
import { formatMoney, formatViews } from "@/lib/format-rate";
import {
  buildCoherenceChecks,
  parisDayKey,
  parisShortDate,
} from "@/lib/analytics-hub";
import {
  KpiTile,
  HubCardHeader,
  HubNotice,
  WebhookFixNotice,
  disputeDeadlineLabel,
  dash,
  pct,
} from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import { PromoRpmCard } from "./PromoRpmCard";
import {
  toDisplayAmount,
  convertedValue,
  conversionNote,
  rateNote,
  type CurrencyContext,
} from "@/lib/currency-display";
import { PayCurrencyWarning } from "@/components/PayCurrencyWarning";
import { MixedCurrencyNotice } from "@/components/MixedCurrencyNotice";
import type { TrendPoint } from "./HubTrendChart";
import type {
  ProductAnalyticsData,
  RevenueData,
  ReliabilityData,
  AttributionData,
  ViewCountersData,
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

/** Assemble un hint en sautant les morceaux vides — jamais un « · » orphelin. */
function joinHint(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(" · ");
}

function stepCount(steps: { key: string; count: number }[], key: string): number | null {
  const s = steps.find((x) => x.key === key);
  return s ? s.count : null;
}

// Jour Europe/Paris (`parisDayKey`) et étiquette (`parisShortDate`) : SOURCE
// UNIQUE partagée avec la courbe (HubTrendChart). La série PostHog est bucketisée
// Paris et le net Whop joint par jour Paris — voir lib/analytics-hub.

export function OverviewTab({
  analytics,
  revenue,
  reliability,
  attribution,
  viewCounters,
  periodDays,
  now,
}: {
  analytics: ProductAnalyticsData;
  revenue: RevenueData | undefined;
  reliability: ReliabilityData | undefined;
  attribution: AttributionData | undefined;
  viewCounters: ViewCountersData | undefined;
  periodDays: number;
  now: number;
}) {
  // Fenêtre : les N derniers jours de la série quotidienne.
  const daily = useMemo(() => {
    const all = [...analytics.overview.daily].sort((a, b) => a.ts - b.ts);
    return all.slice(Math.max(0, all.length - periodDays));
  }, [analytics.overview.daily, periodDays]);

  const visitorsPts: TrendPoint[] = daily.map((d) => ({ ts: d.ts, value: d.visitors }));
  const signupsPts: TrendPoint[] = daily.map((d) => ({ ts: d.ts, value: d.signups }));

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
    return buildCoherenceChecks({
      sequentialSteps: c.sequentialSteps.map((s) => ({ key: s.key, label: s.key, count: s.count })),
      reachSteps: c.reachSteps.map((s) => ({ key: s.key, label: s.key, count: s.count })),
      currencyCount: c.currencyCount,
      dashboardClients: c.dashboardClients,
      // Whop dans les DEUX unités : `whopClients` (personnes) est ce que le
      // contrôle compare à PostHog, `whopMembers` (abonnements) n'est que le
      // contexte affiché. Les intervertir avait suspendu « Clients payants » en
      // permanence sur un écart qui n'existait pas.
      whopMembers: c.whopMembers,
      whopClients: c.whopClients,
      whopClientsTotal: c.whopClientsTotal,
      whopMembersTotal: c.whopMembersTotal,
      // Le dénominateur RÉEL des trois cartes — la variable qu'elles utilisent,
      // pas la source dont elle est tirée (sinon le contrôle se vérifie lui-même).
      unitCostDenominator: clients,
      whopExcludedPre: c.whopExcludedPre,
      whopExcludedAfter: c.whopExcludedAfter,
      dailyClientsSum: c.dailyClientsSum,
      dailySignupsSum: c.dailySignupsSum,
      // Contrôle CROISÉ PAR JOUR : PostHog subs vs Whop clients payants. Les deux
      // séries comptent des PREMIERS paiements (subs filtre `is_renewal`), donc
      // aucune tolérance « renouvellements » n'est passée au contrôle.
      dailySubs: c.dailySubs,
      dailyPaidClients: c.dailyPaidClients,
      todayParis: c.todayParis,
      // Montant dû : total affiché vs somme de ses parts (fixe + CPM + paliers).
      // Décomposition de l'écart sur la fenêtre : le contrôle alerte sur ce
      // qui reste INEXPLIQUÉ, pas sur l'écart brut.
      windowReconciliation: c.windowReconciliation ?? undefined,
      payDue: c.payDue,
    });
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
  const paidClientsPts: TrendPoint[] = daily.map((d) => ({
    ts: d.ts,
    value: clientsByDay.get(parisDayKey(d.ts)) ?? 0,
  }));
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
  const clientEcart =
    coh && coh.dashboardClients !== null && coh.whopClients !== null
      ? Math.abs(coh.dashboardClients - coh.whopClients)
      : null;
  const dup = reliability?.membershipDuplicates;
  const dupGap =
    dup && dup.memberships > dup.users ? dup.memberships - dup.users : 0;
  const clientsHint =
    coh?.whopClientsTotal == null || clientEcart === null
      ? "personnes distinctes, ancré sur le paiement Whop"
      : clientEcart === 0
        ? "aligné avec le dashboard"
        : `écart de ${clientEcart} avec le dashboard${
            dupGap > 0
              ? ` · ${dup!.memberships} abonnements pour ${dup!.users} personnes`
              : ""
          }${
            coh.whopExcludedPre > 0
              ? ` · ${coh.whopExcludedPre} antérieur(s) à l'instrumentation`
              : ""
          }${
            coh.whopClientsUnresolved > 0
              ? ` · ${coh.whopClientsUnresolved} abonnement(s) sans personne résolue (comptés à part)`
              : ""
          }`;
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
  const canDivide = clients !== null && clients > 0 && !dashboardWhopViolation;
  const perClient = (n: number | null | undefined): number | null =>
    n != null && canDivide ? Math.round((n / (clients as number)) * 100) / 100 : null;
  // Carte 1 — coût d'acquisition : (fixe + CPM promo + PART du bonus) / clients. Le
  // bonus débloqué est une dépense réelle, réparti au prorata des vues promo (part
  // affichée sous la carte). Tiret seulement si un coût par vidéo manque (legacy).
  const c = attribution?.costs;
  const promoPlusBonus =
    c && c.promo !== null && c.promoBonus !== null ? c.promo + c.promoBonus : null;
  const acquisitionCost = toDisplayAmount(perClient(promoPlusBonus), fxCtx);
  // Bonus inclus EN ENTIER : un palier ne se gagne que sur des vues promo, donc
  // tout bonus débloqué est un coût promo (plus de prorata, cf getAttribution).
  const acquisitionBonus = toDisplayAmount(c?.promoBonus, fxCtx);
  // Carte 2 — coût complet du moteur : toute la paie (warmup + 100 % du bonus cash
  // + les récompenses en NATURE déjà dues) / clients. Une récompense en nature sans
  // coût réel renseigné est ABSENTE du total : on le dit, plutôt que de présenter
  // un coût incomplet comme entier.
  const fullEngineCost = toDisplayAmount(perClient(attribution?.costs.total), fxCtx);
  const natureDue = toDisplayAmount(attribution?.costs.natureDue ?? 0, fxCtx);
  const natureMissing = attribution?.costs.natureDueMissingCost ?? 0;

  const seq = analytics.funnels.sequential.segments[0]?.steps ?? [];
  const checkoutN = stepCount(seq, "checkout_started");
  const paidN = stepCount(seq, "subscription_completed");
  const completion =
    checkoutN !== null && checkoutN > 0 && paidN !== null
      ? Math.round((paidN / checkoutN) * 1000) / 10
      : null;

  // A5 — la garde du serveur est posée PAR PÉRIODE ; cette somme la traverse.
  // Deux mois encaissés dans deux devises passent chacun la garde puis sont
  // additionnés ici. `revenue.mixedCurrency` est global (calculé sur TOUS les
  // paiements) : s'y adosser referme le trou. null ⇒ la tuile affiche « — ».
  const totalNet =
    revenue?.configured && !revenue.mixedCurrency
      ? Math.round(revenue.periods.reduce((s, p) => s + p.net, 0) * 100) / 100
      : null;
  // Vues promo par client : MÊME référence que les coûts unitaires (clients
  // acquis, personnes, Whop fait foi) — c'était le compteur PostHog, une
  // quatrième définition de « client » sur le même écran.
  const totalClients = coh?.whopClientsTotal ?? null;
  const viewsPerClient =
    viewCounters && totalClients !== null && totalClients > 0
      ? Math.round(viewCounters.promo / totalClients)
      : null;
  // Carte 3 — revenu net (€) par client. Dénominateur = clients au net SÉCURISÉ,
  // PAS tous les clients acquis : le numérateur (totalNet) exclut les litiges en
  // cours, donc les compter au dénominateur tirerait la moyenne vers le bas sans
  // que rien ne le dise. Mesuré en prod : 6,52 € au lieu de 6,92 €.
  // Le coût d'acquisition, lui, garde les clients ACQUIS (la dépense a bien été
  // engagée pour eux) — les deux cartes affichent donc leur dénominateur.
  const securedClients = coh?.whopSecuredClients ?? null;
  const atRiskClients =
    clients !== null && securedClients !== null ? clients - securedClients : 0;
  const revenuePerClient =
    totalNet != null && securedClients !== null && securedClients > 0
      ? Math.round((totalNet / securedClients) * 100) / 100
      : null;

  // Table « Détail par jour » : net Whop joint par jour Europe/Paris, plus récent d'abord.
  const netByDay = useMemo(
    () => new Map((revenue?.dailyNet ?? []).map((d) => [d.day, d.net])),
    [revenue],
  );
  const dailyRows = useMemo(() => [...daily].reverse(), [daily]);

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
        currencies={revenue?.currenciesPresent}
      />

      {/* Éco unitaire — les TROIS montants dans la devise du revenu. Les deux
          coûts sont convertis depuis la paie ; leur provenance est écrite. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label="Coût d'acquisition"
          value={convertedValue(acquisitionCost)}
          delta={null}
          hint={joinHint([
            acquisitionBonus !== null && acquisitionBonus.sourceValue > 0
              ? `dont ${convertedValue(acquisitionBonus)} de bonus de paliers, débloqué sur des vues promo`
              : "publications promo",
            clients !== null ? `÷ ${formatNumber(clients)} clients acquis` : null,
            conversionNote(acquisitionCost),
          ])}
          info={EXPLAIN.coutAcquisition}
        />
        <KpiTile
          label="Coût complet du moteur"
          value={convertedValue(fullEngineCost)}
          delta={null}
          hint={joinHint([
            natureMissing > 0
              ? `warmup inclus · sous-estimé : ${formatNumber(natureMissing)} récompense(s) en nature sans coût réel`
              : natureDue !== null && natureDue.sourceValue > 0
                ? `warmup + ${convertedValue(natureDue)} de récompenses en nature dues`
                : "warmup inclus",
            clients !== null ? `÷ ${formatNumber(clients)} clients acquis` : null,
            conversionNote(fullEngineCost),
          ])}
          info={EXPLAIN.coutComplet}
        />
        <KpiTile
          label="Revenu net par client"
          value={revenuePerClient === null ? "—" : formatMoney(revenuePerClient, currency)}
          delta={null}
          hint={
            securedClients === null
              ? "monte au renouvellement (une seule acquisition)"
              : `÷ ${formatNumber(securedClients)} clients au net sécurisé${
                  atRiskClients > 0
                    ? ` · ${formatNumber(atRiskClients)} hors ratio (argent en litige)`
                    : ""
                }`
          }
          info={EXPLAIN.revenuParClient}
        />
      </div>

      {/* Le taux, écrit UNE fois pour les trois cartes : sans lui, un lecteur ne
          peut pas savoir que deux d'entre elles sont converties depuis la paie. */}
      {rateNote(fxCtx) !== "" ? (
        <p className="-mt-2 text-xs text-slate-400">{rateNote(fxCtx)}</p>
      ) : null}

      {/* RPM promo — revenu, coût et écart pour 1 000 vues promo. Placée avec
          l'éco unitaire : c'est le même bloc « ce que rapporte / ce que coûte ». */}
      <PromoRpmCard
        revenue={revenue}
        attribution={attribution}
        viewCounters={viewCounters}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dashboardWhopViolation ? (
          <Card className="sm:col-span-2">
            <CardContent className="flex h-full items-center p-4">
              <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
                <strong>Clients payants — chiffres suspendus.</strong> L&apos;écart
                dashboard/Whop dépasse À LA FOIS 5 % ET 5 clients. Un chiffre faux est
                pire qu&apos;un chiffre absent : on affiche le contrôle, pas le nombre.
              </HubNotice>
            </CardContent>
          </Card>
        ) : (
          <>
            <KpiTile
              label="Clients payants"
              value={dash(coh?.whopClientsTotal ?? null)}
              delta={null}
              points={paidClientsPts}
              hint={clientsHint}
              info={EXPLAIN.clientsPayants}
            />
            <KpiTile
              label="Revenu net encaissé"
              value={totalNet === null ? "—" : formatMoney(totalNet, currency)}
              delta={null}
              hint={
                revenue?.feeRate != null
                  ? `frais ${formatNumber(Math.round(revenue.feeRate * 1000) / 10)} % · cumulé`
                  : "cumulé · ancré sur le paiement"
              }
              info={EXPLAIN.revenuNet}
            />
          </>
        )}
        <KpiTile
          label="Vues promo → abonné"
          value={viewsPerClient === null ? "—" : `1 / ${formatViews(viewsPerClient)}`}
          delta={null}
          hint="métrique de pilotage · vues à la publication"
          info={EXPLAIN.vuesPromoClient}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label="Complétion checkout"
          value={pct(completion)}
          delta={null}
          hint={
            checkoutN !== null && paidN !== null
              ? `${formatNumber(paidN)} / ${formatNumber(checkoutN)} checkouts`
              : "—"
          }
          info={EXPLAIN.completionCheckout}
        />
        <KpiTile
          label="Visiteurs (période)"
          value={dash(daily.reduce((s, d) => s + d.visitors, 0))}
          delta={null}
          points={visitorsPts}
          hint="ancré sur l'événement"
          info={EXPLAIN.visiteurs}
        />
        <KpiTile
          label="Inscrits (période)"
          value={dash(daily.reduce((s, d) => s + d.signups, 0))}
          delta={null}
          points={signupsPts}
          hint="ancré sur l'inscription"
          info={EXPLAIN.inscrits}
        />
      </div>

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
                    return (
                      <TableRow key={d.ts}>
                        <TableCell className="text-xs tabular-nums text-slate-600">
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
                            // Écart = un paiement compté dans les DEUX colonnes.
                            const ecart =
                              pay !== undefined && nouveaux + ren !== pay
                                ? nouveaux + ren - pay
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
                                    title={`${formatNumber(nouveaux)} nouveau(x) + ${formatNumber(ren)} renouvellement(s) = ${formatNumber(nouveaux + ren)}, pour ${formatNumber(pay as number)} paiement(s) composant le revenu net. Écart de ${formatNumber(Math.abs(ecart))} : un paiement est compté dans les deux colonnes (renouvellement qui est aussi le premier encaissement de son abonnement).`}
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
