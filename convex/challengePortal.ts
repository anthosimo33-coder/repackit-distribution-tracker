import { creatorQuery, creatorMutation, adminViewAsQuery } from "./functions";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { targetInputValidator } from "./assignments";
import {
  challengeAssignments,
  challengeWinsOf,
  computeChallengeRanking,
  createChallengeAssignment,
  requireChallenge,
} from "./challenges";
import {
  challengeIsOver,
  progressRatio,
  viewsToTarget,
  winnerSlots,
  type WinnerRule,
} from "./challengeScore";
import { NIGHTLY_HOUR_PARIS, NIGHTLY_MINUTE_PARIS } from "./syncScope";

/**
 * DÉFIS — la face CRÉATRICE : ce qu'elle voit, et ce qu'elle peut faire.
 *
 * ⚠️ Tout ce qui sort d'ici est lu par une créatrice. Deux règles qui ne se
 * voient pas au typage :
 *
 *  1. AUCUN texte d'interface n'est composé ici. Le serveur rend des FAITS
 *     (score, rang, vues, instants) ; les phrases vivent dans
 *     `messages/{fr,en}.json` et se composent côté client, dans SA langue. Le
 *     runtime Convex n'a ni requête ni `Accept-Language` : une phrase écrite ici
 *     angliciserait une créatrice francophone, ou l'inverse.
 *  2. Le `coutReel` d'une récompense en nature n'est JAMAIS exposé — c'est ce
 *     que l'objet nous coûte, pas ce qu'il vaut pour elle. Même règle que
 *     `bonusUnlocks`, où l'oubli aurait été tout aussi invisible.
 *
 * Le classement est NOMINATIF (transparence assumée, comme le classement de
 * gains déjà en place) mais ne rend QUE des noms et des scores : jamais un
 * handle de compte, jamais une URL de post d'une autre créatrice.
 */

const DAY_MS = 86_400_000;

/** Récompense telle qu'une créatrice a le droit de la lire. */
type PublicReward = {
  type: "cash" | "nature";
  amount?: number;
  libelle?: string;
};

/**
 * Allowlist EXPLICITE de la récompense (et non `{...reward}` moins un champ) :
 * la denylist est le mécanisme qui a produit deux fuites de suite côté
 * assignations (#167, #169). On repart de rien.
 */
function publicReward(reward: Doc<"challenges">["reward"]): PublicReward {
  return reward.type === "cash"
    ? { type: "cash", amount: reward.amount }
    : { type: "nature", libelle: reward.libelle };
}

/**
 * Instant du PROCHAIN relevé nocturne, en partant de `now`.
 *
 * ⚠️ Le relevé est à 23h30 EUROPE/PARIS, et le runtime Convex tourne en UTC. On
 * ne peut donc pas ajouter « 23h30 » à un minuit UTC : selon la saison, ça
 * tomberait à 22h30 ou 00h30 heure de Paris. On balaie donc les heures UTC
 * candidates et on retient la première dont l'heure PARISIENNE vaut
 * NIGHTLY_HOUR_PARIS — le même remède que le cron lui-même, qui est horaire et
 * gardé sur l'heure de Paris (cf convex/crons.ts).
 *
 * Rendu au client pour qu'il affiche « prochain relevé dans X h » sans jamais
 * recalculer un fuseau côté navigateur.
 */
export function nextNightlySyncAt(now: number): number {
  // ⚠️ `formatToParts` et NON `format`. En français, `format` rend « 23 h » —
  // avec l'espace et le « h ». `Number("23 h")` vaut NaN, la comparaison échoue
  // TOUJOURS, et la fonction retombait sur son filet `now + 24 h` : chaque
  // créatrice se voyait annoncer un relevé à l'heure qu'il était, et une échéance
  // de « 23 h » assez plausible pour ne réveiller personne. Constaté à l'aperçu
  // visuel, pas au typage ni à la relecture.
  const parisHourOf = (ts: number): number => {
    const part = new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Europe/Paris",
    })
      .formatToParts(new Date(ts))
      .find((p) => p.type === "hour");
    return part ? Number(part.value) : Number.NaN;
  };
  // On part de l'heure pleine suivante et on avance heure par heure. 48 essais
  // couvrent deux jours — largement au-delà de tout décalage saisonnier.
  const HOUR = 3_600_000;
  const base = Math.floor(now / HOUR) * HOUR;
  for (let i = 0; i <= 48; i++) {
    const candidate = base + i * HOUR + NIGHTLY_MINUTE_PARIS * 60_000;
    if (candidate <= now) continue;
    if (parisHourOf(candidate) === NIGHTLY_HOUR_PARIS) return candidate;
  }
  // Filet : ne jamais rendre une date absurde si l'Intl se comportait autrement.
  return now + DAY_MS;
}

/** Le défi tel qu'une participante le lit. */
export type CreatorChallengeDTO = {
  _id: Id<"challenges">;
  name: string;
  description: string | null;
  targetViews: number;
  mode: "cumulative" | "single";
  reward: PublicReward;
  winnerRule: WinnerRule;
  /** Nombre de places, `null` pour « toutes » (pas de plafond). */
  slots: number | null;
  deadline: number;
  /** Son score, ses vidéos comptées, sa progression. */
  myScore: number;
  myVideoCount: number;
  myProgress: number;
  myViewsToTarget: number;
  /** A-t-elle gagné ? Sa récompense est alors acquise. */
  iWon: boolean;
  /** Classement NOMINATIF complet (nom + score), soi marquée. */
  ranking: {
    creatorId: string;
    name: string;
    score: number;
    rank: number;
    crossed: boolean;
    won: boolean;
    isMe: boolean;
  }[];
  /** Places déjà prises — « il reste 2 places » se dit avec ça. */
  winnersCount: number;
  /** Terminé de fait (deadline passée ou places prises) : plus rien à jouer. */
  over: boolean;
  /** Horodatage du dernier relevé qui a nourri ces chiffres. `null` si aucun. */
  lastSyncAt: number | null;
  /** Prochain relevé — « prochain relevé dans X h ». */
  nextSyncAt: number;
};

/**
 * Défis VISIBLES d'une créatrice : ceux où elle est nommément inscrite ET qui
 * sont ouverts. Un brouillon n'existe pas pour elle ; un défi clos disparaît de
 * son espace (son historique reste côté admin).
 *
 * ⚠️ Un défi TERMINÉ DE FAIT (deadline passée, ou toutes les places prises)
 * reste rendu tant qu'il est `active` : c'est là qu'elle lit le résultat. Le
 * masquer à la seconde où la deadline tombe escamoterait l'issue de ce qu'elle
 * vient de jouer.
 */
async function challengesForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
): Promise<CreatorChallengeDTO[]> {
  const participations = await ctx.db
    .query("challengeParticipants")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  const now = Date.now();
  const nextSyncAt = nextNightlySyncAt(now);
  const out: CreatorChallengeDTO[] = [];

  for (const p of participations) {
    if (p.projectId !== projectId) continue;
    const c = await ctx.db.get(p.challengeId);
    if (!c || c.projectId !== projectId) continue;
    if (c.status !== "active") continue;

    // MÊME classement que l'admin et que l'évaluation nocturne : une seule
    // implémentation, sinon le rang affiché ne serait pas celui qui décide.
    const [ranking, wins, assignments] = await Promise.all([
      computeChallengeRanking(ctx, c),
      challengeWinsOf(ctx, c._id),
      challengeAssignments(ctx, c._id),
    ]);
    const liveWins = wins.filter((w) => w.cancelledAt === undefined);
    const wonIds = new Set(liveWins.map((w) => w.creatorId as string));
    const mine = ranking.find((r) => r.creatorId === creatorId);

    // Fraîcheur : le relevé le plus récent parmi SES publications du défi. C'est
    // la date qu'on lui annonce — pas celle du run global, qui peut avoir traité
    // d'autres comptes que le sien.
    let lastSyncAt: number | null = null;
    for (const a of assignments) {
      if (a.creatorId !== creatorId) continue;
      for (const t of a.targets ?? []) {
        if (!t.publicationId) continue;
        const pub = await ctx.db.get(t.publicationId);
        const at = pub?.latestSnapshotAt;
        if (at !== undefined && (lastSyncAt === null || at > lastSyncAt)) {
          lastSyncAt = at;
        }
      }
    }

    const rule = c.winnerRule as WinnerRule;
    const slots = winnerSlots(rule);
    out.push({
      _id: c._id,
      name: c.name,
      description: c.description ?? null,
      targetViews: c.targetViews,
      mode: c.mode as "cumulative" | "single",
      reward: publicReward(c.reward),
      winnerRule: rule,
      slots: Number.isFinite(slots) ? slots : null,
      deadline: c.deadline,
      myScore: mine?.score ?? 0,
      myVideoCount: mine?.videoCount ?? 0,
      myProgress: progressRatio(mine?.score ?? 0, c.targetViews),
      myViewsToTarget: viewsToTarget(mine?.score ?? 0, c.targetViews),
      iWon: wonIds.has(creatorId),
      ranking: ranking.map((r) => ({
        creatorId: r.creatorId,
        name: r.name,
        score: r.score,
        rank: r.rank,
        crossed: r.crossed,
        won: wonIds.has(r.creatorId),
        isMe: r.creatorId === creatorId,
      })),
      winnersCount: liveWins.length,
      over: challengeIsOver({
        rule,
        existingWins: liveWins.map((w) => ({ creatorId: w.creatorId })),
        deadline: c.deadline,
        now,
      }),
      lastSyncAt,
      nextSyncAt,
    });
  }

  // Le plus urgent d'abord — une deadline proche passe devant. Les défis
  // terminés de fait descendent : ils ne demandent plus rien.
  return out.sort(
    (a, b) => Number(a.over) - Number(b.over) || a.deadline - b.deadline,
  );
}

/** CRÉATRICE — ses défis ouverts. */
export const getMyChallenges = creatorQuery({
  args: {},
  handler: async (ctx): Promise<CreatorChallengeDTO[]> =>
    challengesForCreator(ctx, ctx.projectId, ctx.creatorId),
});

/** ADMIN view-as (lecture seule) — les défis du créateur observé. */
export const getChallengesAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx): Promise<CreatorChallengeDTO[]> =>
    challengesForCreator(ctx, ctx.projectId, ctx.creatorId),
});

/**
 * SOUMISSION LIBRE — la créatrice se commande une vidéo de défi.
 *
 * SANS QUOTA, et c'est le point : rien ici ne compte ses vidéos pour la limiter.
 * Le seul décompte du cœur partagé sert à choisir quel hook servir (rotation).
 * Si un jour quelqu'un veut plafonner, ce sera une décision explicite à écrire —
 * pas un effet de bord qu'on découvre.
 *
 * Elle choisit ses cibles parmi SES comptes disponibles, exactement comme
 * l'admin le fait pour une assignation ordinaire : `validateTargets` (dans le
 * cœur) refuse un compte qui n'est pas à elle, en warmup, ou archivé.
 */
export const startChallengeVideo = creatorMutation({
  args: {
    challengeId: v.id("challenges"),
    targets: v.array(targetInputValidator),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ assignmentId: Id<"assignments"> }> => {
    const challenge = await requireChallenge(
      ctx,
      args.challengeId,
      ctx.projectId,
    );
    if (args.targets.length === 0) {
      throw new ConvexError("Choisis au moins un compte pour publier.");
    }
    return createChallengeAssignment(ctx as MutationCtx & { projectId: Id<"projects"> }, {
      challenge,
      creatorId: ctx.creatorId,
      targets: args.targets,
    });
  },
});
