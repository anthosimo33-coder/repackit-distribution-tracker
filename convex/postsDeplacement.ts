/**
 * DÉPLACER des posts PUBLIÉS d'un compte vers un autre compte de la même
 * créatrice, sur la même plateforme — l'outil MCP `deplacer_posts` et son
 * `defaire`.
 *
 * Cas du 04/11/2026 : la créatrice renomme son compte TikTok (`@ilosnitchy` →
 * `@ilosnytch`), l'équipe déclare le nouveau @ et archive l'ancien. Les posts
 * déjà sortis restent sur la fiche archivée. `changer_compte_cible` ne peut plus
 * rien pour eux (verrou de publication), et renommer l'ancienne fiche entre en
 * collision avec la nouvelle.
 *
 * Un post est rattaché à son compte par DEUX liens, et les deux bougent :
 *  - `publications.compte`, le HANDLE (une chaîne, pas une clé) — la clé du
 *    relevé de vues, de la fiche Comptes et de la garde d'auteur ;
 *  - `assignments.targets[].accountId` (et le legacy `accountId`) de la cible
 *    qui porte ce post — le pays du P&L par marché, le panneau de mission.
 *
 * La PAIE ne bouge pas : elle suit l'assignation (créatrice + barème figés),
 * que la publication retrouve par la créatrice du compte — la même des deux
 * côtés, c'est la première garde.
 *
 * Module sans import serveur : testable en vitest (lib/posts-deplacement.test.ts).
 */

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { effectiveStatus } from "./compteStatut";

/**
 * Au plus 50 posts par appel : le journal garde chaque post et chaque mission
 * touchés, en entier, avant et après, dans UN document (1 MiB au plus).
 * Au-delà, l'outil déplace les 50 premiers et dit combien il en reste.
 */
export const MAX_POSTS_PAR_APPEL = 50;

type CompteMin = Pick<Doc<"comptes">, "_id" | "handle" | "plateforme" | "creatorId" | "status" | "actif">;

/** Pourquoi on ne déplace pas de `source` vers `dest` — `null` = permis. */
export function refusDeplacement(source: CompteMin, dest: CompteMin): string | null {
  if (source._id === dest._id) return `${source.handle} est déjà le compte de ces posts.`;
  if (source.plateforme !== dest.plateforme) {
    return `${source.handle} est un compte ${source.plateforme}, ${dest.handle} un compte ${dest.plateforme} : un post ne change pas de plateforme.`;
  }
  if (source.creatorId === undefined || source.creatorId !== dest.creatorId) {
    return `${source.handle} et ${dest.handle} ne sont pas à la même créatrice : la paie de ces posts en dépend.`;
  }
  if (effectiveStatus(dest) === "archived") {
    return `${dest.handle} est archivé : réactive-le dans Comptes avant d'y ranger des posts.`;
  }
  return null;
}

/**
 * Les paires (départ, arrivée) que deux désignations peuvent former : même
 * plateforme, même créatrice, deux comptes distincts. Un @ porté par TikTok ET
 * Instagram se lève ainsi tout seul quand l'autre compte n'existe que sur l'une.
 */
export function paires<T extends CompteMin>(sources: readonly T[], dests: readonly T[]): [T, T][] {
  return sources.flatMap((s) =>
    dests
      .filter((d) => d._id !== s._id && d.plateforme === s.plateforme && d.creatorId !== undefined && d.creatorId === s.creatorId)
      .map((d): [T, T] => [s, d]),
  );
}

/**
 * Les cibles d'une mission, une fois ses posts déplacés : celle qui porte un
 * post déplacé ET vise encore le compte de départ passe sur le compte
 * d'arrivée. `null` = rien à écrire.
 */
export function cibleDeplacee(
  a: Pick<Doc<"assignments">, "targets" | "publicationId" | "accountId">,
  posts: ReadonlySet<string>,
  depart: Id<"comptes">,
  arrivee: Id<"comptes">,
): Partial<Pick<Doc<"assignments">, "targets" | "accountId">> | null {
  let change = false;
  const targets = a.targets?.map((t) => {
    if (t.publicationId === undefined || !posts.has(t.publicationId) || t.accountId !== depart) return t;
    change = true;
    return { ...t, accountId: arrivee };
  });
  // Legacy (une seule cible) : le post et le compte vivent sur la mission.
  const legacy = a.publicationId !== undefined && posts.has(a.publicationId) && a.accountId === depart;
  if (!change && !legacy) return null;
  return { ...(change ? { targets } : {}), ...(legacy ? { accountId: arrivee } : {}) };
}

/** Les missions de la créatrice qui portent ces posts — à photographier avant, puis à réécrire. */
export async function missionsDesPosts(
  ctx: { db: MutationCtx["db"] },
  creatorId: Id<"creators">,
  posts: readonly Doc<"publications">[],
): Promise<Doc<"assignments">[]> {
  const ids = new Set<string>(posts.map((p) => p._id));
  const porte = (x: Id<"publications"> | undefined) => x !== undefined && ids.has(x);
  const missions = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  return missions.filter((m) => porte(m.publicationId) || (m.targets ?? []).some((t) => porte(t.publicationId)));
}

/**
 * Le DÉPLACEMENT lui-même — l'outil et son `defaire`. Réécrit le handle des
 * posts, puis le compte de la cible de chaque mission qui les porte.
 */
export async function deplacerPostsCore(
  ctx: { db: MutationCtx["db"] },
  posts: readonly Doc<"publications">[],
  missions: readonly Doc<"assignments">[],
  depart: Id<"comptes">,
  arrivee: Pick<Doc<"comptes">, "_id" | "handle">,
): Promise<void> {
  for (const p of posts) await ctx.db.patch(p._id, { compte: arrivee.handle });
  const ids = new Set<string>(posts.map((p) => p._id));
  for (const m of missions) {
    const patch = cibleDeplacee(m, ids, depart, arrivee._id);
    if (patch !== null) await ctx.db.patch(m._id, patch);
  }
}
