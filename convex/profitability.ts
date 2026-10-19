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
import { videosFacturables } from "./profitabilityMath";
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
  const ofProject = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((a) => a.projectId === projectId);
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
  const unlocks = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((u) => u.projectId === projectId && u.rewardType === "cash");
  for (const u of unlocks) activeMonths.add(u.attributionPeriod);

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
  // Une seule lecture des sources de la créatrice pour TOUS ses mois : le
  // moteur les relisait sinon à chaque tour de boucle (cf CreatorPayrollSources).
  const sources = await loadCreatorPayrollSources(ctx, projectId, creatorId);
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
 * `assembleProfitability` (pur, sans lecture). La carte enchaîne les trois dans
 * sa query ; l'outil MCP, qui tourne dans une action, appelle la base puis un
 * lot de créatrices par query, et assemble. Même code, même résultat — seul
 * le découpage en transactions diffère.
 */

/** Ce que la rentabilité lit SANS parcourir les créatrices. Sérialisable : il traverse `runQuery`. */
export type ProfitabilityBase = {
  configured: true;
  payCurrency: string | null;
  fxRateToRevenue: number | null;
  currentPeriod: string;
  revenueByMonth: { period: string; revenueNet: number; mixedCurrency: boolean }[];
  totalRevenue: Pick<
    ReturnType<typeof summarizeWhopRevenue>,
    "net" | "currency" | "mixedCurrency" | "conversions" | "mixedCurrencyPresent" | "currenciesPresent"
  >;
  /** Créatrices qui COÛTENT (vidéos, paliers), dans l'ordre de première rencontre. */
  creatorIds: Id<"creators">[];
  /** Vues SUIVIES brutes par mois de publication (Paris), et leur total. */
  trackedViewsByMonth: { period: string; views: number }[];
  trackedViewsTotal: number;
  periode?: {
    du: string;
    au: string;
    revenueNet: number;
    revenueByDay: { jour: string; revenueNet: number }[];
  };
};

/** Le coût d'un lot de créatrices — la part lourde, découpable en plusieurs queries. */
export type ProfitabilityCreatorsPart = {
  /** Une entrée par créatrice du lot, dans l'ordre du lot. */
  creators: {
    months: { period: string; cost: number; billedViews: number; settled: boolean }[];
  }[];
  /** Vidéos facturées du lot, avec leurs posts rémunérés (période libre seulement). */
  videos: VideoFacturable[];
};

async function loadBase(
  ctx: ProjectQueryCtx,
  project: Doc<"projects">,
  projectPubs: Awaited<ReturnType<typeof loadProjectPublications>>,
  periodeLibre: PeriodeLibre | undefined,
): Promise<ProfitabilityBase> {
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

  // ─── Les créatrices qui coûtent ────────────────────────────────────────────
  // Elles se lisent dans ce qui COÛTE (vidéos, paliers), pas
  // dans la table des fiches : une créatrice payée puis supprimée n'a plus de
  // fiche, mais l'argent versé est parti. Parcourir `creators` faisait fondre
  // son coût de la marge et ses vues du RPM au moment de la suppression — alors
  // qu'Analytics, qui part des vidéos, continuait de les compter. Ce qu'on ne
  // lui paiera pas a déjà été sorti de la paie à la suppression (remunere=false,
  // cf unpayPostsOfDeletedCreator) : le moteur le rend donc à zéro, sans filtre ici.
  const creatorIds = new Set<Id<"creators">>();
  for (const a of await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect()) {
    creatorIds.add(a.creatorId);
  }
  for (const u of await ctx.db
    .query("bonusUnlocks")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect()) {
    creatorIds.add(u.creatorId);
  }

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
    configured: true,
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
    creatorIds: [...creatorIds],
    trackedViewsByMonth: [...trackedByMonth.entries()].map(([period, views]) => ({
      period,
      views,
    })),
    trackedViewsTotal,
    ...(periode !== undefined ? { periode } : {}),
  };
}

async function loadCreatorsPart(
  ctx: ProjectQueryCtx,
  project: Doc<"projects">,
  creatorIds: readonly Id<"creators">[],
  projectPubs: Awaited<ReturnType<typeof loadProjectPublications>>,
  withVideos: boolean,
): Promise<ProfitabilityCreatorsPart> {
  // Les publications du projet, lues UNE fois pour toutes les créatrices du lot
  // et tous leurs mois (cf AssignmentViewsCache).
  const viewsCache = newViewsCache(projectPubs);
  const creators: ProfitabilityCreatorsPart["creators"] = [];
  const videos: VideoFacturable[] = [];
  for (const c of creatorIds) {
    const cm = await creatorCostByMonth(ctx, ctx.projectId, c, viewsCache, project);
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
 * L'assemblage — PUR. Les lots se recollent dans l'ordre de `base.creatorIds` :
 * c'est l'ordre de l'ancienne boucle unique, donc les mêmes sommes, arrondies
 * dans le même ordre.
 */
export function assembleProfitability(
  base: ProfitabilityBase,
  parts: readonly ProfitabilityCreatorsPart[],
) {
  const costByMonth = new Map<string, number>();
  const billedByMonth = new Map<string, number>();
  // Un mois n'est FIGÉ que si TOUTES les créatrices qui y coûtent le sont : il
  // suffit d'une vidéo encore vivante (cycle ouvert ET fenêtre ouverte) pour
  // que le mois bouge encore.
  // Un ET, donc, jamais un OU — annoncer « réglé » sur un mois qui va encore
  // grossir serait pire que de ne rien annoncer.
  const settledByMonth = new Map<string, boolean>();
  for (const part of parts) {
    for (const c of part.creators) {
      for (const { period: m, cost, billedViews, settled } of c.months) {
        costByMonth.set(m, round2((costByMonth.get(m) ?? 0) + cost));
        billedByMonth.set(m, (billedByMonth.get(m) ?? 0) + billedViews);
        settledByMonth.set(m, (settledByMonth.get(m) ?? true) && settled);
      }
    }
  }
  const totalCost = round2(
    [...costByMonth.values()].reduce((s, a) => s + a, 0),
  );

  // ─── Vues ventilées RÉMUNÉRÉES / non rémunérées — DÉNOMINATEUR du RPM ─────
  // La coupure est le fait FINANCIER (viewsSplitOf → isRemunerated), pas le fait
  // éditorial. Ce site testait `p.isWarmup === true` en dur, ce que l'en-tête de
  // convex/viewCounters interdit précisément.
  //
  // Le défaut jouait dans les DEUX sens, mesuré sur la prod du 2026-09-02 :
  //   - un post retiré de la paie à la main (remunere=false) restait au
  //     dénominateur — 277 857 vues en août, 23 % du mois ;
  //   - un post warmup explicitement PAYÉ (cas Kelly, remunere=true) en était
  //     absent — 694 000 vues sur juillet à lui seul.
  // Le RPM n'était donc ni sur- ni sous-estimé de façon systématique : il était
  // calculé sur un ensemble qui n'était celui d'aucune des deux questions.
  //
  // ─── PAYÉES = vues FACTURÉES, plafond 150 $/vidéo compris ────────────────
  // Elles viennent de `billedByMonth`, c'est-à-dire du MÊME appel au moteur que
  // le coût. Au-delà du seuil où une vidéo atteint le plafond, chaque vue
  // supplémentaire est GRATUITE : la compter au dénominateur fait baisser le
  // RPM sans qu'un centime ait été dépensé. Mesuré en prod le 03/09/2026 :
  // 2 vidéos sur 128 portaient 248 489 vues gratuites en août (20 % du mois),
  // et l'une d'elles a fait tomber le RPM de 1,88 € à 1,69 € en 24 h pour 0 $.
  //
  // `viewsSplitOf` (coupure isRemunerated) n'est donc plus la source du
  // dénominateur ; il reste celle des vues TOTALES, dont on déduit les non
  // rémunérées. Le `max(0, …)` est une ceinture : les vues facturées sont
  // bornées par les vues payables, elles-mêmes bornées par les vues retenues du
  // même mois — la soustraction ne peut pas passer sous zéro sans un décalage
  // de mois entre un assignment et ses posts (aucun en prod le 03/09).
  const viewsByMonth = new Map<
    string,
    { paidViews: number; unpaidViews: number }
  >();
  for (const { period: m, views } of base.trackedViewsByMonth) {
    const paid = billedByMonth.get(m) ?? 0;
    viewsByMonth.set(m, {
      paidViews: paid,
      unpaidViews: Math.max(0, views - paid),
    });
  }
  // Un mois peut porter des vues FACTURÉES sans aucune publication rangée sous
  // lui (bonus attribué à une période persistée en UTC) : sans cette boucle, sa
  // ligne afficherait un coût et zéro vue.
  for (const [m, paid] of billedByMonth) {
    if (!viewsByMonth.has(m)) {
      viewsByMonth.set(m, { paidViews: paid, unpaidViews: 0 });
    }
  }
  // Totaux recalculés sur TOUT le lot, jamais sommés depuis les mois.
  const totPaid = [...billedByMonth.values()].reduce((s, v) => s + v, 0);
  const totUnpaid = Math.max(0, base.trackedViewsTotal - totPaid);

  // ─── Assemblage (mois présents dans revenu, coût OU vues), plus récent d'abord ─
  const revenueByMonth = new Map(base.revenueByMonth.map((r) => [r.period, r]));
  const allPeriods = new Set<string>([
    ...revenueByMonth.keys(),
    ...costByMonth.keys(),
    ...viewsByMonth.keys(),
  ]);
  const months = [...allPeriods]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((period) => ({
      period,
      revenueNet: revenueByMonth.get(period)?.revenueNet ?? 0,
      mixedCurrency: revenueByMonth.get(period)?.mixedCurrency ?? false,
      creatorCost: costByMonth.get(period) ?? 0,
      paidViews: viewsByMonth.get(period)?.paidViews ?? 0,
      unpaidViews: viewsByMonth.get(period)?.unpaidViews ?? 0,
      // Coût et vues FACTURÉES définitivement arrêtés (cycles réglés ou
      // fenêtres closes). Un mois sans aucune vidéo retenue n'est pas figé :
      // `settledByMonth` ne porte que les mois qui coûtent quelque chose.
      settled: settledByMonth.get(period) === true,
    }));

  // ─── Période LIBRE (outil MCP `rentabilite` avec du/au) ─────────────────────
  // Le revenu des jours demandés, et de quoi DATER les vues facturées de chaque
  // vidéo (cf convex/viewsDaily `computeDailyBilledViews`).
  const periode:
    | {
        du: string;
        au: string;
        revenueNet: number;
        revenueByDay: { jour: string; revenueNet: number }[];
        videos: VideoFacturable[];
      }
    | undefined =
    base.periode === undefined
      ? undefined
      : { ...base.periode, videos: parts.flatMap((p) => p.videos) };

  const totalRevenue = base.totalRevenue;
  return {
    configured: true as const,
    // Devise du REVENU (Whop) ; la paie créatrices a la sienne (payCurrency).
    currency: totalRevenue.currency,
    payCurrency: base.payCurrency,
    // Taux paie→revenu pour la marge (revenu € − coût $ converti). null → marge
    // non calculée (jamais soustraire deux devises sans conversion).
    fxRateToRevenue: base.fxRateToRevenue,
    currentPeriod: base.currentPeriod,
    // A5 — le drapeau était calculé puis jeté : la carte affichait un revenu
    // zéroïsé (donc une marge très négative) comme s'il s'agissait d'un vrai
    // montant. Un chiffre faux est pire qu'un chiffre absent.
    mixedCurrency: totalRevenue.mixedCurrency,
    conversions: totalRevenue.conversions,
    mixedCurrencyPresent: totalRevenue.mixedCurrencyPresent,
    currenciesPresent: totalRevenue.currenciesPresent,
    total: {
      revenueNet: totalRevenue.net,
      creatorCost: totalCost,
      paidViews: totPaid,
      unpaidViews: totUnpaid,
    },
    months,
    ...(periode !== undefined ? { periode } : {}),
  };
}

/**
 * Cœur de `getProjectProfitability` — la carte, en UNE query : base, toutes les
 * créatrices d'un seul lot, assemblage. L'outil MCP `rentabilite` fait les mêmes
 * trois pas, en plusieurs queries (cf « POURQUOI TROIS MORCEAUX »).
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
  const base = await loadBase(ctx, project, projectPubs, opts?.periode);
  const part = await loadCreatorsPart(
    ctx,
    project,
    base.creatorIds,
    projectPubs,
    opts?.periode !== undefined,
  );
  return assembleProfitability(base, [part]);
}
