import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  identityOf,
  judgeInstagramOwner,
  type InstagramOwner,
  type OwnerVerdict,
} from "./instagramOwner";

/**
 * GARDE DU PROPRIÉTAIRE — la moitié base de données de `convex/instagramOwner`.
 *
 * Appelée par les DEUX écritures de relevé Instagram, et seulement par elles :
 *  - `upsertApifySnapshot` (relevé de nuit et bouton « Synchroniser ») ;
 *  - `writeEarlyPass` (relevé rapide).
 * Le verdict se prend donc au point où le chiffre entre en base, pas à chaque
 * lecture : un reel refusé n'existe ni pour la paie, ni pour les paliers, ni
 * pour les analytics, ni pour l'alerte de hit, sans qu'aucun d'eux ait à le
 * savoir.
 */

/**
 * Un compte n'a qu'une identité Instagram ; la borne protège seulement d'un
 * emballement (un @ réattribué plusieurs fois par Instagram).
 */
const MAX_LEARNED_IDS = 5;

/** Motif affiché à la place du chiffre (« Non mesuré — <motif> »). */
export function foreignOwnerReason(username: string): string {
  return `lien d'un autre compte (@${username})`;
}

/**
 * Juge le propriétaire rendu pour cette publication et, s'il CONFIRME le
 * compte, apprend son id sur la ligne `comptes`. Hors Instagram, ou sans
 * propriétaire ni drapeau : « inconnu », sans lecture.
 */
export async function judgeAndLearnOwner(
  ctx: MutationCtx,
  pub: Doc<"publications">,
  owner: InstagramOwner | undefined,
): Promise<OwnerVerdict> {
  if (pub.plateforme !== "Instagram") return { kind: "unknown" };
  const flaggedOwner = pub.foreignOwner?.username ?? null;
  const hasOwner =
    owner !== undefined && (owner.ownerUsername !== null || owner.ownerId !== null);
  if (!hasOwner && flaggedOwner === null) return { kind: "unknown" };

  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project", (q) => q.eq("projectId", pub.projectId))
    .collect();
  const { compte, siblings } = identityOf(comptes, pub.compte);
  const verdict = judgeInstagramOwner({
    owner: owner ?? { ownerUsername: null, ownerId: null },
    pubHandle: pub.compte,
    compte,
    siblings,
    flaggedOwner,
  });
  if (verdict.kind === "own" && verdict.learnOwnerId !== null && compte !== null) {
    await ctx.db.patch(compte._id, {
      instagramOwnerIds: [...(compte.instagramOwnerIds ?? []), verdict.learnOwnerId].slice(
        -MAX_LEARNED_IDS,
      ),
    });
  }
  return verdict;
}
