import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { adminQuery } from "./functions";
import {
  calendarStatus,
  onTimeTally,
  parisDayIndex,
  representativePostedAt,
  type OnTimeTally,
} from "./calendarStatus";

/**
 * RETARDS DE PUBLICATION — la lecture partagée par l'écran et par les deux
 * notifications (bilan du soir, publication en retard).
 *
 * Une seule implémentation, pour la raison qui revient à chaque fois dans ce
 * dépôt : un chiffre annoncé dans un message et un chiffre affiché à l'écran
 * qui divergent font perdre confiance dans les deux. Le taux à l'heure vient
 * d'`onTimeTally` (convex/calendarStatus.ts), le même que consomme
 * `AssignmentsCalendar`.
 *
 * ⚠️ Le jour de référence est PARIS (cf l'en-tête de convex/calendarStatus.ts) :
 * ces fonctions tournent côté serveur, où le runtime est en UTC, et `postDate`
 * est stocké à minuit Paris.
 */

/** Un post planifié, réduit à ce dont le calcul a besoin. */
type Planifie = { postDate: number | null; postedAt: number | null };

const planifieDe = (a: Doc<"assignments">): Planifie => ({
  postDate: a.postDate ?? null,
  postedAt: representativePostedAt(a),
});

export interface CreatorPublicationStats {
  creatorId: Id<"creators">;
  creatorName: string;
  tally: OnTimeTally;
}

/**
 * Taux à l'heure PAR CRÉATRICE, sur TOUT l'historique du projet.
 *
 * Périmètre volontairement identique à celui de l'écran (`listAssignments` fait
 * un `.collect()` complet, sans fenêtre) : une fenêtre glissante ici ferait
 * cohabiter deux taux différents pour la même personne le même jour.
 *
 * Le taux du PROJET (63 % au relevé du 2026-08-14) ne décrit personne : sur le
 * même jeu, Kelly est à 91 % et Jade à 0 %. C'est le chiffre par créatrice qui
 * porte l'information.
 */
export async function creatorPublicationStats(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  now: number,
): Promise<CreatorPublicationStats[]> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const creators = await ctx.db
    .query("creators")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const nomDe = new Map(creators.map((c) => [c._id, c.name]));

  const parCreateur = new Map<Id<"creators">, Planifie[]>();
  for (const a of assignments) {
    const arr = parCreateur.get(a.creatorId);
    if (arr) arr.push(planifieDe(a));
    else parCreateur.set(a.creatorId, [planifieDe(a)]);
  }
  const out: CreatorPublicationStats[] = [];
  for (const [creatorId, posts] of parCreateur) {
    out.push({
      creatorId,
      creatorName: nomDe.get(creatorId) ?? "—",
      tally: onTimeTally(posts, now),
    });
  }
  return out.sort((a, b) =>
    a.creatorName.localeCompare(b.creatorName, "fr", { sensitivity: "base" }),
  );
}

/** Un post prévu aujourd'hui et pas encore publié, tel que le message le nomme. */
export interface PostDuJour {
  assignmentId: Id<"assignments">;
  /** Compte cible (handle), ou null si l'assignation n'en désigne pas. */
  accountHandles: string[];
  /** Campagne (script) ou format — de quoi reconnaître le post. */
  missionLabel: string;
}

export interface CreatorEveningReport {
  creatorId: Id<"creators">;
  creatorName: string;
  posts: PostDuJour[];
  /** Taux à l'heure sur TOUT l'historique (les anciens manqués comptent ICI). */
  tally: OnTimeTally;
}

/**
 * BILAN DU SOIR — par créatrice ayant au moins un post prévu AUJOURD'HUI et pas
 * encore publié.
 *
 * ⚠️ VERROU : uniquement AUJOURD'HUI. Les posts en retard ou manqués des jours
 * précédents n'entrent JAMAIS dans cette liste. Quelqu'un qui a loupé 30 posts
 * il y a dix jours et en a 2 aujourd'hui reçoit un message qui parle de 2 posts.
 * Les anciens manqués comptent — mais dans le TAUX, qui est leur seul endroit.
 *
 * Une créatrice sans post prévu ce jour-là est absente du résultat : c'est une
 * condition d'entrée, pas un filtre d'affichage.
 */
export async function eveningUnpublishedReports(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  now: number,
): Promise<CreatorEveningReport[]> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const aujourdhui = parisDayIndex(now);

  // Prévus AUJOURD'HUI et pas encore publiés. `calendarStatus` renvoie
  // "scheduled" pour le jour même non publié — la journée n'est pas finie, et
  // c'est bien ce que le message dira : « pas encore publié », pas « manqué ».
  const duJour = assignments.filter((a) => {
    if (a.postDate == null) return false;
    if (parisDayIndex(a.postDate) !== aujourdhui) return false;
    return (
      calendarStatus({
        postDate: a.postDate,
        postedAt: representativePostedAt(a),
        now,
      }) === "scheduled"
    );
  });
  if (duJour.length === 0) return [];

  const creators = await ctx.db
    .query("creators")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const nomDe = new Map(creators.map((c) => [c._id, c.name]));
  const stats = new Map(
    (await creatorPublicationStats(ctx, projectId, now)).map((s) => [
      s.creatorId,
      s.tally,
    ]),
  );

  const parCreateur = new Map<Id<"creators">, Doc<"assignments">[]>();
  for (const a of duJour) {
    const arr = parCreateur.get(a.creatorId);
    if (arr) arr.push(a);
    else parCreateur.set(a.creatorId, [a]);
  }

  const out: CreatorEveningReport[] = [];
  for (const [creatorId, posts] of parCreateur) {
    const detail: PostDuJour[] = [];
    for (const a of posts) {
      detail.push({
        assignmentId: a._id,
        accountHandles: await handlesDe(ctx, a),
        missionLabel: await missionLabelDe(ctx, a),
      });
    }
    out.push({
      creatorId,
      creatorName: nomDe.get(creatorId) ?? "—",
      posts: detail,
      tally: stats.get(creatorId) ?? {
        onTime: 0,
        late: 0,
        missed: 0,
        scheduled: 0,
        past: 0,
        rate: null,
      },
    });
  }
  return out.sort((a, b) =>
    a.creatorName.localeCompare(b.creatorName, "fr", { sensitivity: "base" }),
  );
}

/** Handles des comptes cibles, dédupliqués et dans l'ordre des cibles. */
async function handlesDe(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<string[]> {
  const out: string[] = [];
  for (const t of a.targets ?? []) {
    if (!t.accountId) continue;
    const compte = await ctx.db.get(t.accountId);
    if (compte && !out.includes(compte.handle)) out.push(compte.handle);
  }
  return out;
}

/** Campagne (script) ou nom de format — de quoi reconnaître le post manquant. */
async function missionLabelDe(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<string> {
  if (a.scriptCombo) {
    const campagne = await ctx.db.get(a.scriptCombo.campaignId);
    if (campagne) return campagne.name;
  }
  if (a.formatId) {
    const format = await ctx.db.get(a.formatId);
    if (format) return format.name;
  }
  return "sans campagne";
}

/**
 * Écran — taux à l'heure par créatrice. Même source que les notifications, donc
 * le message du soir et le tableau ne peuvent pas annoncer deux chiffres.
 */
export const getCreatorPublicationStats = adminQuery({
  args: {},
  handler: async (ctx) =>
    creatorPublicationStats(ctx, ctx.projectId, Date.now()),
});
