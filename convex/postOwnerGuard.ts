import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  identityOf,
  isOwnerPlatform,
  judgePostOwner,
  learnedOwnerIds,
  type PostOwner,
  type OwnerVerdict,
} from "./postOwner";

/**
 * GARDE DE L'AUTEUR — la moitié base de données de `convex/postOwner`.
 *
 * Appelée par les DEUX écritures de relevé Instagram et TikTok, et seulement
 * par elles :
 *  - `upsertApifySnapshot` (relevé de nuit et bouton « Synchroniser », page
 *    publique TikTok comme secours Apify) ;
 *  - `writeEarlyPass` (relevé rapide).
 * Le verdict se prend donc au point où le chiffre entre en base, pas à chaque
 * lecture : un post refusé n'existe ni pour la paie, ni pour les paliers, ni
 * pour les analytics, ni pour l'alerte de hit, sans qu'aucun d'eux ait à le
 * savoir.
 */

/**
 * Un compte n'a qu'une identité ; la borne protège seulement d'un emballement
 * (un @ réattribué plusieurs fois par la plateforme).
 */
const MAX_LEARNED_IDS = 5;

/** Motif affiché à la place du chiffre (« Non mesuré — <motif> »). */
export function foreignOwnerReason(username: string): string {
  return `lien d'un autre compte (@${username})`;
}

/**
 * Juge l'auteur rendu pour cette publication et, s'il CONFIRME le compte,
 * apprend son id sur la ligne `comptes`. Hors Instagram et TikTok, ou sans
 * auteur ni drapeau : « inconnu », sans lecture.
 */
export async function judgeAndLearnOwner(
  ctx: MutationCtx,
  pub: Doc<"publications">,
  owner: PostOwner | undefined,
): Promise<OwnerVerdict> {
  if (!isOwnerPlatform(pub.plateforme)) return { kind: "unknown" };
  const flaggedOwner = pub.foreignOwner?.username ?? null;
  const hasOwner =
    owner !== undefined && (owner.ownerUsername !== null || owner.ownerId !== null);
  if (!hasOwner && flaggedOwner === null) return { kind: "unknown" };

  // Les comptes de la plateforme seulement : `identityOf` n'en regarde pas
  // d'autres, et cette lecture est payée à CHAQUE relevé écrit.
  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project_plateforme", (q) =>
      q.eq("projectId", pub.projectId).eq("plateforme", pub.plateforme),
    )
    .collect();
  const { compte, siblings } = identityOf(comptes, pub.compte, pub.plateforme);
  const verdict = judgePostOwner({
    owner: owner ?? { ownerUsername: null, ownerId: null },
    pubHandle: pub.compte,
    compte,
    siblings,
    flaggedOwner,
  });
  if (verdict.kind === "own" && verdict.learnOwnerId !== null && compte !== null) {
    const ids = [...learnedOwnerIds(compte), verdict.learnOwnerId].slice(-MAX_LEARNED_IDS);
    await ctx.db.patch(
      compte._id,
      pub.plateforme === "TikTok" ? { tiktokOwnerIds: ids } : { instagramOwnerIds: ids },
    );
  }
  return verdict;
}
