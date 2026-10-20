import { v } from "convex/values";
import {
  permissionQuery,
  type ProjectQueryCtx,
} from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  computeLivePricingBreakdown,
  loadCreatorPayrollSources,
  loadProjectPublications,
  newViewsCache,
  assignmentPublishedAt,
  type AssignmentViewsCache,
} from "./pricing";
import { monthKeyParis, parisMonthEndMs } from "./dateFr";
import { loadSettledResolvers } from "./settledCyclesRead";
import { netInReference } from "./marketMoney";
import {
  assembleRevenueAndCosts,
  lotSlice,
  videosFacturables,
  type ProfitabilityBase,
  type ProfitabilityCosts,
  type ProfitabilityCreatorsPart,
  type ProfitabilityRevenue,
} from "./profitabilityMath";
import { parisDayKey, type VideoFacturable } from "./viewsDaily";
import { projectFx, summarizeWhopRevenue } from "./whopRevenue";
import { collectProjectWhopPayments } from "./whopPaymentsAccess";
import type { PayFxProject } from "./payCurrency";

/**
 * Rentabilité par PROJET (rentabilité P3) — met en face le REVENU Whop net
 * (prompt 2) et le COÛT créateurs (moteur de paie, prompt 1 : posts warmup déjà
 * exclus du coût) → MARGE, + les vues ventilées (monétisées / warmup) pour le RPM.
 *
 * Périmètre = CALENDAIRE (mois EUROPE/PARIS, `monthKeyParis`) pour un face-à-face
 * cohérent avec le revenu Whop (mensuel), que Whop découpe en heure locale.
 * Les TROIS colonnes (revenu, coût, vues) partagent cette clé : sans ça, une
 * vidéo publiée le 1er à 00:03 Paris met ses vues dans un mois et son coût dans
 * l'autre. Le coût passe toujours par le MÊME moteur que les Paiements ; c'est la
 * clé de mois qui lui est injectée, pas son calcul.
 *
 * Le COÛT réutilise le MÊME moteur que les Paiements (computeLivePricingBreakdown
 * → computeMonthlyPayout) — mêmes montants par vidéo, seule la fenêtre est le mois
 * calendaire (≠ cycle J+30 de la page Paiements). AUCUN recalcul divergent.
 *
 * Les VUES du dénominateur sont celles qu'on a réellement PAYÉES, au sens plein :
 * retenues à J+30 ET bornées au plafond de 150 $/vidéo. Les deux viennent de
 * `billedViews`, que le moteur produit déjà — aucune lecture supplémentaire. Les
 * deux colonnes d'une même ligne décrivent donc le même ensemble de vues, sinon
 * la marge et le RPM ne parlent pas de la même chose, et une vidéo virale déjà
 * plafonnée fait chuter le RPM sans coûter un centime.
 *
 * Les vues TOTALES (toggle activé) sont, elles, les vues SUIVIES brutes.
 *
 * Le calcul marge/RPM + le TOGGLE vivent côté client (lib/profitability) : ici on
 * ne renvoie que des nombres bruts (revenu/coût constants + vues ventilées).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Coût créateurs d'UN créateur, ventilé par mois de publication (EUROPE/PARIS,
 * cf en-tête de fichier — `monthKeyParis` est injecté dans le moteur). Réutilise
 * computeLivePricingBreakdown (fixe + CPM + bonus paliers cash), appelé UNIQUEMENT
 * sur les mois où le créateur a de l'activité (mois de publi d'un assignment
 * pricing OU mois d'attribution d'un bonus cash) → borne les lectures.
 * `legacyAssignmentIds` vide : les projets Whop sont en pricing v2 (aucune
 * lineItem legacy base/bonus à exclure — le coût = fixe/CPM/bonus, cf brief).
 */
async function creatorCostByMonth(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  /**
   * Publications du projet préchargées + mémoire de la query. Le moteur faisait
   * sinon un `db.get` PAR POST et PAR MOIS ; c'est le budget d'opérations
   * système qui saute en premier sur ce projet (cf AssignmentViewsCache). Le
   * gel, lui, reste hors cache : sa valeur dépend de l'instant du règlement.
   */
  viewsCache: AssignmentViewsCache,
  /**
   * Le projet, pour RAMENER le coût dans sa devise de paie : une créatrice
   * payée en euros coûte des euros, que la marge compare ensuite au revenu.
   * Une seule devise par carte (cf convex/payCurrency) — celle du projet.
   */
  toReference: PayFxProject,
  /**
   * Ses assignations du projet, quand l'appelant les a déjà lues (une lecture
   * `by_project` pour toutes les créatrices au lieu d'une par créatrice).
   */
  knownAssignments?: Doc<"assignments">[],
): Promise<{
  months: Map<string, { cost: number; billedViews: number; settled: boolean }>;
  /**
   * Vues facturées de CHAQUE vidéo, prises dans le même appel que le total de
   * son mois (dû, ou engagé pour le mois en cours). Une vidéo n'appartient qu'au
   * mois de sa publication : aucune clé ne se répète.
   */
  billedByAssignment: Map<string, number>;
  /** Ses assignations du projet, déjà lues — de quoi rattacher ses vidéos à leurs posts. */
  projectAssignments: Doc<"assignments">[];
}> {
  const ofProject =
    knownAssignments ??
    (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((a) => a.projectId === projectId);
  // Une seule lecture des sources de la créatrice pour TOUS ses mois : le
  // moteur les relisait sinon à chaque tour de boucle (cf CreatorPayrollSources).
  // Ses assignations et ses paliers y sont : les relire ici doublait la lecture
  // (912 assignations, 1,4 Mo de plus sur Snytch le 2026-10-20).
  const sources = await loadCreatorPayrollSources(
    ctx,
    projectId,
    creatorId,
    ofProject,
  );
  const assignments = ofProject.filter(
    (a) =>
      a.pricingSnapshot !== undefined &&
      (a.status === "published" || a.status === "paid"),
  );
  const activeMonths = new Set<string>();
  for (const a of assignments) {
    activeMonths.add(monthKeyParis(assignmentPublishedAt(a)));
  }
  // Un bonus cash peut être attribué à un mois SANS nouvelle publication (rollover).
  // ⚠️ `attributionPeriod` est une chaîne PERSISTÉE, dérivée en UTC à l'accrual, et
  // aucun timestamp ne l'accompagne : elle ne peut pas être re-clée en Paris. Un
  // bonus attribué dans les 2 h qui précèdent minuit UTC reste donc rangé sous son
  // mois UTC. Résidu assumé — le corriger voudrait dire réécrire des périodes de
  // paie déjà émises, ce qu'on ne fait pas pour un libellé d'écran.
  for (const u of sources.bonusUnlocks) {
    if (u.rewardType === "cash") activeMonths.add(u.attributionPeriod);
  }

  // ─── CE QUI EST DÉJÀ PAYÉ NE BOUGE PLUS ──────────────────────────────────
  // Le moteur recalculait une vidéo même après le règlement de son cycle : son
  // CPM et ses vues facturées continuaient de grossir dans le mois de sa
  // publication, alors que la row `payments` est gelée et qu'une assignation ne
  // peut pas repasser dans un cycle suivant (cf convex/settledCycles). Le mois
  // affichait donc un coût que personne ne devait, et un RPM qui baissait tout
  // seul. Deux lectures de plus par créatrice, jamais par mois.
  const { settledViewsOf, settledVideoBonusOf } = await loadSettledResolvers(
    ctx,
    projectId,
    creatorId,
    await ctx.db.get(creatorId),
  );
  const out = new Map<
    string,
    { cost: number; billedViews: number; settled: boolean }
  >();
  const billedByAssignment = new Map<string, number>();
  // Une prime de DÉFI aussi peut tomber sur un mois sans publication : même
  // règle que les paliers ci-dessus, sinon elle sortait de la marge.
  for (const w of sources.challengeWins) {
    if (w.cancelledAt === undefined && w.reward.type === "cash") {
      activeMonths.add(w.attributionPeriod);
    }
  }
  // Le mois EN COURS n'est pas fini : ce qu'il coûte n'est pas encore ce qu'on
  // doit. Cf `engage` plus bas.
  const moisCourant = monthKeyParis(Date.now());
  for (const month of activeMonths) {
    const bd = await computeLivePricingBreakdown(
      ctx,
      projectId,
      creatorId,
      month,
      new Set(),
      monthKeyParis,
      viewsCache,
      sources,
      // Borne du seuil de vues : la fin du mois PARIS, la même que celle qui
      // range les publications dans ce mois.
      parisMonthEndMs(month),
      // Vidéo d'un cycle déjà réglé ⇒ l'assiette qu'on a payée, et le bonus
      // par vidéo qu'on lui a versé (cf convex/settledCyclesRead).
      settledViewsOf,
      settledVideoBonusOf,
      toReference,
    );
    // Les vues FACTURÉES viennent du MÊME appel que le coût : c'est la seule
    // façon que le dénominateur du RPM et son numérateur décrivent le même
    // ensemble. Un mois à coût nul peut porter des vues (barème à taux nul) et
    // l'inverse (bonus de palier sans publication) — d'où les deux conditions.
    // ─── MOIS EN COURS : le coût ENGAGÉ ────────────────────────────────────
    // Un barème conditionné dont le seuil n'est pas encore franchi doit à ce
    // jour ZÉRO. Le compter à zéro dans la marge ferait paraître le mois
    // excellent jusqu'à la seconde où le seuil tombe — et un RPM qui saute d'un
    // facteur deux à la clôture n'est pas un indicateur, c'est un piège.
    // Tant que le mois court on suppose donc qu'on paiera ; à la clôture, le DÛ
    // reprend la main (les deux valeurs sont égales dès qu'aucun seuil ne
    // bloque, c'est-à-dire partout ailleurs).
    const enCours = month === moisCourant;
    // L'engagé ne porte que fixe + CPM : les paliers débloqués et les primes de
    // défi du mois sont DÉJÀ dus, sans condition à attendre. Les oublier sortait
    // 200 $ de bonus de la marge de septembre 2026 (prod du 2026-09-19), alors
    // que la Vue d'ensemble les comptait.
    // Le bonus PAR VIDÉO est dans le même cas : dû dès que la vidéo franchit
    // son seuil, sans condition de mois.
    const cost = enCours
      ? round2(
          bd.engage.total + bd.bonusTierCashTotal + bd.challengeTotal + bd.videoBonusTotal,
        )
      : bd.total;
    const parVideo = enCours ? bd.engage.perAssignment : bd.perAssignment;
    for (const a of parVideo) {
      billedByAssignment.set(a.assignmentId, a.billedViews);
    }
    const billedViews = parVideo.reduce((sum, a) => sum + a.billedViews, 0);
    if (cost > 0 || billedViews > 0) {
      // Un mois EN COURS n'est jamais annoncé figé : son coût est l'ENGAGÉ, qui
      // suit encore les vidéos ouvertes, et des vidéos vont s'y ajouter.
      out.set(month, {
        cost,
        billedViews,
        settled: !enCours && bd.allSettled === true,
      });
    }
  }
  return { months: out, billedByAssignment, projectAssignments: ofProject };
}

/**
 * Rentabilité du projet : revenu net + coût créateurs par mois (+ total), et vues
 * ventilées monétisées/warmup (total). Le client dérive marge = revenu − coût
 * (INVARIANT) et RPM = revenu / (vues / 1000) où les vues dépendent du toggle
 * warmup (lib/profitability). `configured` = false → pas de mapping Whop (l'UI
 * masque la rentabilité). Ne lit QUE le projet courant.
 */
export const getProjectProfitability = permissionQuery("business.read")({
  args: {},
  handler: (ctx) => getProjectProfitabilityCore(ctx),
});

/** Période LIBRE (jours de Paris inclus) — outil MCP `rentabilite` avec du/au. */
type PeriodeLibre = { du: string; au: string };

/** Réponse d'un projet sans Whop : l'UI masque la carte, l'outil le dit. */
function nonConfiguree(project: Doc<"projects"> | null) {
  return {
    configured: false as const,
    currency: null as string | null,
    mixedCurrency: false,
    mixedCurrencyPresent: false,
    currenciesPresent: [] as string[],
    payCurrency: (project?.payCurrency ?? null) as string | null,
    fxRateToRevenue: (project?.fxRateToRevenue ?? null) as number | null,
    currentPeriod: monthKeyParis(Date.now()),
    total: {
      revenueNet: 0,
      creatorCost: 0,
      paidViews: 0,
      unpaidViews: 0,
    },
    months: [] as Array<{
      period: string;
      revenueNet: number;
      mixedCurrency: boolean;
      creatorCost: number;
      paidViews: number;
      unpaidViews: number;
      settled: boolean;
    }>,
  };
}

/**
 * ─── POURQUOI TROIS MORCEAUX ────────────────────────────────────────────────
 * Le calcul tenait en UNE query : revenu, puis le moteur de paie de chaque
 * créatrice, puis l'assemblage. Sur Snytch il a franchi la limite d'exécution
 * d'une query (1 s) : le 2026-10-19, `rentabilite` sur une période échouait à
 * chaque appel (« Function execution timed out »), et le détail mensuel passait
 * à 990 ms. Le moteur de paie, créatrice par créatrice, en est l'essentiel.
 *
 * D'où : `profitabilityBase` (tout ce qui ne parcourt pas les créatrices),
 * `profitabilityCreatorsPart` (le coût d'un LOT de créatrices) et
 * `assembleProfitability` (pur, sans lecture). L'outil MCP, qui tourne dans une
 * action, appelle la base puis un lot de créatrices par query, et assemble.
 *
 * La CARTE a suivi le 2026-10-20 : en une query, elle lisait 7,5 Mo et passait
 * 0,92 à 1,00 s dans son code — 2 appels sur 4 échouaient, et la page Paiements
 * entière avec. Elle
 * lit désormais le REVENU (`getProfitabilityRevenue`, Whop seul) et le COÛT en
 * lots de créatrices (`getProfitabilityCosts`, publications + moteur de paie),
 * qu'elle assemble avec `assembleRevenueAndCosts`. Même code, même résultat —
 * seul le découpage en transactions diffère.
 */

type ProjectPubs = Awaited<ReturnType<typeof loadProjectPublications>>;

/** Le revenu Whop du projet — aucune lecture de vidéo ni de créatrice. */
async function loadRevenue(
  ctx: ProjectQueryCtx,
  project: Doc<"projects">,
  periodeLibre: PeriodeLibre | undefined,
): Promise<ProfitabilityRevenue> {
  // ─── Revenu Whop net par mois (paidAt) — CONSTANT vis-à-vis du toggle ──────
  // A4 — abonnements internes exclus via le point de passage unique. Ce site
  // ne filtrait pas : la MARGE affichée intégrait le revenu du compte de test.
  const { payments: whopRows } = await collectProjectWhopPayments(
    ctx,
    ctx.projectId,
    project.slug ?? "",
  );
  const revByMonth = new Map<string, Doc<"whopPayments">[]>();
  for (const r of whopRows) {
    const m = monthKeyParis(r.paidAt);
    const arr = revByMonth.get(m);
    if (arr) arr.push(r);
    else revByMonth.set(m, [r]);
  }
  // Le drapeau A5 est conservé PAR MOIS : la marge et le RPM sont recalculés
  // mois par mois côté client, un mois bi-devise doit donc pouvoir s'abstenir
  // seul, sans effacer les mois voisins qui sont parfaitement calculables.
  // Même taux que l'écran Paiements : sans lui, un mois bi-devise sortait un
  // revenu nul, donc une marge égale à l'opposé du coût créateurs.
  const fx = projectFx(project);
  const revenueByMonth: ProfitabilityBase["revenueByMonth"] = [];
  for (const [m, list] of revByMonth) {
    const s = summarizeWhopRevenue(list, fx);
    revenueByMonth.push({ period: m, revenueNet: s.net, mixedCurrency: s.mixedCurrency });
  }
  const totalRevenue = summarizeWhopRevenue(whopRows, fx);

  // ─── Période LIBRE : le revenu des jours demandés ─────────────────────────
  let periode: ProfitabilityBase["periode"];
  if (periodeLibre !== undefined) {
    const { du, au } = periodeLibre;
    const lignesDuJour = new Map<string, Doc<"whopPayments">[]>();
    for (const r of whopRows) {
      const j = parisDayKey(r.paidAt);
      if (j < du || j > au) continue;
      const arr = lignesDuJour.get(j);
      if (arr) arr.push(r);
      else lignesDuJour.set(j, [r]);
    }
    // Sommé paiement par paiement dans la devise du revenu, avec le référentiel
    // de TOUT l'historique : `summarizeWhopRevenue` sur un jour qui n'a vu que
    // des ventes en dollars les rendrait en dollars, lues comme des euros (cf
    // convex/marketMoney).
    const revenueByDay = [...lignesDuJour.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([jour, lignes]) => ({
        jour,
        revenueNet: netInReference(lignes, totalRevenue),
      }));
    const revenueNet = netInReference(
      [...lignesDuJour.values()].flat(),
      totalRevenue,
    );
    periode = { du, au, revenueNet, revenueByDay };
  }

  return {
    payCurrency: project.payCurrency ?? null,
    fxRateToRevenue: project.fxRateToRevenue ?? null,
    currentPeriod: monthKeyParis(Date.now()),
    revenueByMonth,
    totalRevenue: {
      net: totalRevenue.net,
      currency: totalRevenue.currency,
      mixedCurrency: totalRevenue.mixedCurrency,
      conversions: totalRevenue.conversions,
      mixedCurrencyPresent: totalRevenue.mixedCurrencyPresent,
      currenciesPresent: totalRevenue.currenciesPresent,
    },
    ...(periode !== undefined ? { periode } : {}),
  };
}

/**
 * Les créatrices qui coûtent, dans l'ordre de première rencontre, et leurs
 * assignations du projet — UNE lecture `by_project`, que le moteur réutilise
 * au lieu de relire celles de chaque créatrice (même ensemble, même ordre :
 * les deux index ne portent qu'un champ, donc l'ordre de création).
 */
async function projectCostCreators(ctx: ProjectQueryCtx): Promise<{
  creatorIds: Id<"creators">[];
  assignmentsOf: Map<Id<"creators">, Doc<"assignments">[]>;
}> {
  // ─── Les créatrices qui coûtent ────────────────────────────────────────────
  // Elles se lisent dans ce qui COÛTE (vidéos, paliers), pas
  // dans la table des fiches : une créatrice payée puis supprimée n'a plus de
  // fiche, mais l'argent versé est parti. Parcourir `creators` faisait fondre
  // son coût de la marge et ses vues du RPM au moment de la suppression — alors
  // qu'Analytics, qui part des vidéos, continuait de les compter. Ce qu'on ne
  // lui paiera pas a déjà été sorti de la paie à la suppression (remunere=false,
  // cf unpayPostsOfDeletedCreator) : le moteur le rend donc à zéro, sans filtre ici.
  const creatorIds = new Set<Id<"creators">>();
  const assignmentsOf = new Map<Id<"creators">, Doc<"assignments">[]>();
  for (const a of await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect()) {
    creatorIds.add(a.creatorId);
    const arr = assignmentsOf.get(a.creatorId);
    if (arr) arr.push(a);
    else assignmentsOf.set(a.creatorId, [a]);
  }
  for (const u of await ctx.db
    .query("bonusUnlocks")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect()) {
    creatorIds.add(u.creatorId);
  }
  return { creatorIds: [...creatorIds], assignmentsOf };
}

/** Les vues SUIVIES du projet, par mois de publication (Paris), et leur total. */
function trackedViews(
  projectPubs: ProjectPubs,
): Pick<ProfitabilityBase, "trackedViewsByMonth" | "trackedViewsTotal"> {
  // ── Vues TOTALES : les vues SUIVIES, brutes ───────────────────────────────
  // `vuesLatest`, sans plafond J+30. Le plafond répond à « qu'est-ce que j'ai
  // payé », et c'est la part FACTURÉE qui répond à cette question — elle vient
  // du moteur, sans lecture supplémentaire. Le plafonner AUSSI ici donnait un
  // total qui n'était ni ce qu'on a payé, ni ce que les vidéos ont fait, et
  // coûtait une requête `metricSnapshots` par publication hors fenêtre : 179 le
  // 2026-09-06, 509 (toutes) sous trente jours. La tuile annonce « toutes les
  // vues suivies » : c'est désormais ce qu'elle montre.
  const trackedByMonth = new Map<string, number>();
  let trackedViewsTotal = 0;
  for (const p of projectPubs.values()) {
    const m = monthKeyParis(p.datePubli);
    trackedByMonth.set(m, (trackedByMonth.get(m) ?? 0) + (p.vuesLatest ?? 0));
    trackedViewsTotal += p.vuesLatest ?? 0;
  }
  return {
    trackedViewsByMonth: [...trackedByMonth.entries()].map(([period, views]) => ({
      period,
      views,
    })),
    trackedViewsTotal,
  };
}

/** La base de l'outil MCP : revenu, créatrices qui coûtent, vues suivies. */
async function loadBase(
  ctx: ProjectQueryCtx,
  project: Doc<"projects">,
  projectPubs: ProjectPubs,
  periodeLibre: PeriodeLibre | undefined,
): Promise<ProfitabilityBase> {
  const revenue = await loadRevenue(ctx, project, periodeLibre);
  const { creatorIds } = await projectCostCreators(ctx);
  return { configured: true, ...revenue, creatorIds, ...trackedViews(projectPubs) };
}

async function loadCreatorsPart(
  ctx: ProjectQueryCtx,
  project: Doc<"projects">,
  creatorIds: readonly Id<"creators">[],
  projectPubs: ProjectPubs,
  withVideos: boolean,
  /** Assignations du projet par créatrice, déjà lues (cf `projectCostCreators`). */
  assignmentsOf?: ReadonlyMap<Id<"creators">, Doc<"assignments">[]>,
): Promise<ProfitabilityCreatorsPart> {
  // Les publications du projet, lues UNE fois pour toutes les créatrices du lot
  // et tous leurs mois (cf AssignmentViewsCache).
  const viewsCache = newViewsCache(projectPubs);
  const creators: ProfitabilityCreatorsPart["creators"] = [];
  const videos: VideoFacturable[] = [];
  for (const c of creatorIds) {
    const cm = await creatorCostByMonth(
      ctx,
      ctx.projectId,
      c,
      viewsCache,
      project,
      assignmentsOf === undefined ? undefined : (assignmentsOf.get(c) ?? []),
    );
    creators.push({
      months: [...cm.months.entries()].map(([period, m]) => ({ period, ...m })),
    });
    if (withVideos) {
      // Même moteur, même plafond : cf `videosFacturables`.
      videos.push(
        ...videosFacturables(
          cm.billedByAssignment,
          new Map(cm.projectAssignments.map((a) => [a._id as string, a])),
          projectPubs,
        ),
      );
    }
  }
  return { creators, videos };
}

/**
 * Le coût d'un LOT de créatrices (toutes, sans `lot`) et les vues suivies, en
 * une transaction.
 */
async function loadCosts(
  ctx: ProjectQueryCtx,
  project: Doc<"projects">,
  projectPubs: ProjectPubs,
  withVideos: boolean,
  lot?: { lot: number; lots: number },
): Promise<ProfitabilityCosts> {
  const { creatorIds: toutes, assignmentsOf } = await projectCostCreators(ctx);
  const creatorIds =
    lot === undefined ? toutes : lotSlice(toutes, lot.lot, lot.lots);
  const part = await loadCreatorsPart(
    ctx,
    project,
    creatorIds,
    projectPubs,
    withVideos,
    assignmentsOf,
  );
  return { creatorIds, ...trackedViews(projectPubs), part };
}

/**
 * Carte Rentabilité, moitié REVENU : Whop seul. `null` sans Whop — la carte se
 * masque. Cf « POURQUOI TROIS MORCEAUX ».
 */
export const getProfitabilityRevenue = permissionQuery("business.read")({
  args: {},
  handler: async (ctx): Promise<ProfitabilityRevenue | null> => {
    const project = await ctx.db.get(ctx.projectId);
    if (project === null || project.whop === undefined) return null;
    return loadRevenue(ctx, project, undefined);
  },
});

/**
 * Carte Rentabilité, moitié COÛT : le moteur de paie d'un LOT de créatrices
 * (`lot` sur `lots`, tranches contiguës de l'ordre de première rencontre) et
 * les vues suivies. `null` sans Whop, AVANT tout calcul (le moteur itère
 * créatrices × mois).
 */
export const getProfitabilityCosts = permissionQuery("business.read")({
  args: { lot: v.number(), lots: v.number() },
  handler: async (ctx, { lot, lots }): Promise<ProfitabilityCosts | null> => {
    const project = await ctx.db.get(ctx.projectId);
    if (project === null || project.whop === undefined) return null;
    const projectPubs = await loadProjectPublications(ctx, ctx.projectId);
    return loadCosts(ctx, project, projectPubs, false, { lot, lots });
  },
});

/** La base, ou `configured: false` sans Whop — avant tout calcul coûteux. */
export async function profitabilityBase(ctx: ProjectQueryCtx, periode?: PeriodeLibre) {
  const project = await ctx.db.get(ctx.projectId);
  if (project === null || project.whop === undefined) return nonConfiguree(project);
  const projectPubs = await loadProjectPublications(ctx, ctx.projectId);
  return loadBase(ctx, project, projectPubs, periode);
}

/** Le coût d'un lot de créatrices (cf `ProfitabilityCreatorsPart`). */
export async function profitabilityCreatorsPart(
  ctx: ProjectQueryCtx,
  creatorIds: readonly Id<"creators">[],
  withVideos: boolean,
): Promise<ProfitabilityCreatorsPart> {
  const project = await ctx.db.get(ctx.projectId);
  if (project === null) return { creators: [], videos: [] };
  const projectPubs = await loadProjectPublications(ctx, ctx.projectId);
  return loadCreatorsPart(ctx, project, creatorIds, projectPubs, withVideos);
}

/**
 * Cœur de `getProjectProfitability` — la carte, en UNE query : revenu, coût,
 * assemblage. La carte fait les mêmes pas en deux queries, l'outil MCP
 * `rentabilite` en plusieurs (cf « POURQUOI TROIS MORCEAUX »).
 */
export async function getProjectProfitabilityCore(
  ctx: ProjectQueryCtx,
  /**
   * Période LIBRE (jours de Paris inclus) : ajoute au résultat le revenu
   * encaissé ces jours-là et, pour chaque vidéo facturée, son plafond et ses
   * posts rémunérés — de quoi dater ses vues facturées (cf convex/viewsDaily
   * `computeDailyBilledViews`). Absente : réponse inchangée, c'est celle de la
   * carte.
   */
  opts?: { periode?: PeriodeLibre },
) {
  const project = await ctx.db.get(ctx.projectId);
  // Rentabilité = Whop-gated : sans mapping, on court-circuite AVANT tout calcul
  // coûteux (le coût créateurs itère créateurs × mois). L'UI masque la carte.
  if (project === null || project.whop === undefined) return nonConfiguree(project);
  const projectPubs = await loadProjectPublications(ctx, ctx.projectId);
  return assembleRevenueAndCosts(
    await loadRevenue(ctx, project, opts?.periode),
    [await loadCosts(ctx, project, projectPubs, opts?.periode !== undefined)],
  );
}
