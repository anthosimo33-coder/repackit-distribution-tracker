import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { resolveCreatorKind } from "./roles";
import { dayOffset, localDayLabelMs } from "./calendarStatus";
import { postedAtOf } from "./earlyTracking";

/**
 * PUBLIER SANS VALIDATION — la créatrice de confiance.
 *
 * Le circuit normal est `todo → in_progress → video_submitted → [valider] →
 * to_publish → published`. Chez une créatrice qui porte
 * `creators.skipVideoReview`, la mission saute tout ce qui précède `to_publish` :
 * elle publie le jour prévu et colle ses liens, rien d'autre.
 *
 * POURQUOI UN ÉTAT, ET PAS UNE GARDE LEVÉE. Lever seulement la garde
 * `to_publish` de `confirmPublicationCore` laissait la mission en `todo` jusqu'à
 * sa publication. Or l'échéance de production (`dueDate`) est UNE date pour tout
 * un lot, quand les publications s'étalent sur des jours : passé l'échéance,
 * chaque mission encore à venir s'affichait « en retard », partait dans le
 * digest de l'équipe et déclenchait l'e-mail « ta vidéo est attendue ». En
 * `to_publish`, toutes ces surfaces lisent déjà la bonne chose — c'est le statut
 * qu'elles connaissent pour « il ne reste qu'à publier ». Même patron que les
 * comptes gérés (`managedByAdmin`), créés directement en `to_publish`.
 *
 * RÉVERSIBLE À L'IDENTIQUE. La mission garde d'où elle venait
 * (`reviewSkippedFrom`) : retirer la confiance remet chaque mission encore « à
 * publier » dans son statut d'origine — une vidéo soumise retourne dans la file
 * Validation, une vidéo refusée garde son motif. Une mission PUBLIÉE garde le
 * champ : c'est la trace que personne n'a vu la vidéo avant sa mise en ligne.
 *
 * CE QUI NE BOUGE PAS. Toutes les gardes du LIEN restent : un post et pas un
 * profil, la bonne plateforme, un post de SON compte, un compte publiable, un
 * lien par plateforme. La paie part à la publication, comme avant.
 *
 * PARTENAIRES SEULEMENT. Un clippeur publie le montage d'un rush, un talent ne
 * publie rien : la confiance n'a de sens que sur le flux partenaire.
 *
 * Module sans import runtime `_generated` → importable par les tests.
 */

/** Statuts qu'une mise en confiance fait passer « à publier ». */
export const REVIEW_SKIPPABLE_STATUSES = [
  "todo",
  "in_progress",
  "video_submitted",
  "video_rejected",
] as const;
export type ReviewSkippableStatus = (typeof REVIEW_SKIPPABLE_STATUSES)[number];

function isReviewSkippable(status: string): status is ReviewSkippableStatus {
  return (REVIEW_SKIPPABLE_STATUSES as readonly string[]).includes(status);
}

/** La confiance s'applique-t-elle à cette fiche ? (partenaire ET réglage posé) */
export function skipsVideoReview(
  creator: Pick<Doc<"creators">, "kind" | "skipVideoReview"> | null | undefined,
): boolean {
  return (
    creator?.skipVideoReview === true &&
    resolveCreatorKind(creator.kind) === "partner"
  );
}

/**
 * État de NAISSANCE d'une mission. Le compte géré passe en premier : l'équipe
 * publie, la créatrice ne touche à rien — sa confiance n'y change rien, et la
 * mission ne porte donc pas `reviewSkippedFrom`.
 */
export function initialMissionState(
  managed: boolean,
  creator: Pick<Doc<"creators">, "kind" | "skipVideoReview"> | null | undefined,
): {
  status: "todo" | "to_publish";
  managedByAdmin?: true;
  reviewSkippedFrom?: "todo";
} {
  if (managed) return { status: "to_publish", managedByAdmin: true };
  if (skipsVideoReview(creator)) {
    return { status: "to_publish", reviewSkippedFrom: "todo" };
  }
  return { status: "todo" };
}

/**
 * Pose (ou retire) la confiance sur la fiche ET aligne ses missions en cours.
 * L'appelant a déjà vérifié le projet, le périmètre et la population.
 *
 * Idempotent : remettre la même valeur ne déplace rien (`moved: 0`).
 */
export async function appliquerConfianceVideo(
  ctx: MutationCtx,
  creator: Doc<"creators">,
  enabled: boolean,
): Promise<{ moved: number }> {
  await ctx.db.patch(creator._id, {
    skipVideoReview: enabled ? true : undefined,
  });
  const missions = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  let moved = 0;
  for (const a of missions) {
    if (enabled) {
      if (a.managedByAdmin || !isReviewSkippable(a.status)) continue;
      await ctx.db.patch(a._id, {
        status: "to_publish",
        reviewSkippedFrom: a.status,
      });
    } else {
      if (a.status !== "to_publish" || a.reviewSkippedFrom === undefined) continue;
      await ctx.db.patch(a._id, {
        status: a.reviewSkippedFrom,
        reviewSkippedFrom: undefined,
        // Une vidéo soumise retourne dans la file : elle y ENTRE maintenant (le
        // temps passé « à publier » n'attendait personne).
        ...(a.reviewSkippedFrom === "video_submitted" ? { inReviewSince: Date.now() } : {}),
      });
    }
    moved++;
  }
  return { moved };
}

/**
 * « À LA BONNE DATE » — le seul contrôle qui reste quand personne ne voit la
 * vidéo. Le jour de mise en ligne LU DANS LE LIEN (id TikTok, code Instagram)
 * comparé au jour prévu. La date de confirmation ne suffit pas : coller le lien
 * le lendemain matin d'un post de 22 h n'est pas un retard (TD-020), publier
 * deux jours trop tôt n'est pas « à l'heure ».
 *
 * Une ALERTE, jamais un refus : la règle du dépôt est de ne refuser que le
 * prouvé faux, et un jour lu dans un id reste une lecture (fuseau inconnu,
 * id bricolé). Rien quand le lien ne porte pas de date (lien court, autres
 * plateformes) : on ne sait pas, on ne dit rien.
 *
 * Renvoie le premier écart trouvé (plateformes dans l'ordre des cibles), ou null.
 */
export type LinkDayGap = {
  /** Écart signé : > 0 en retard, < 0 en avance. Jamais 0. */
  days: number;
  /** Jour lu dans le lien, chez la créatrice (minuit UTC de ce jour, cf localDayLabelMs). */
  linkDay: number;
  /** Jour prévu (instant `postDate`, étiquette de Paris). */
  postDate: number;
  platform: string;
};

export function linkDayGap(
  a: {
    postDate?: number | null;
    targets?: {
      platform: string;
      publishedUrl?: string | null;
      publishedAt?: number | null;
    }[] | null;
  },
  timeZone: string | null,
  now: number,
): LinkDayGap | null {
  if (a.postDate == null) return null;
  for (const t of a.targets ?? []) {
    if (!t.publishedUrl) continue;
    if (t.platform !== "TikTok" && t.platform !== "Instagram") continue;
    const read = postedAtOf(t.platform, t.publishedUrl, t.publishedAt ?? now, now);
    if (read.source !== "url") continue;
    const days = dayOffset({ postDate: a.postDate, postedAt: read.at, timeZone });
    if (days === null || days === 0) continue;
    return {
      days,
      linkDay: localDayLabelMs(read.at, timeZone),
      postDate: a.postDate,
      platform: t.platform,
    };
  }
  return null;
}
