/**
 * UN POST, UNE PUBLICATION — la garde de saisie et la règle de la publication
 * gardée.
 *
 * ── Le défaut que ce module ferme ────────────────────────────────────────────
 * Constat du 19/11/2026 sur Snytch : 38 liens de post rattachés à plusieurs
 * publications, 48 publications en trop, 947 811 vues comptées deux fois (8,4 %
 * des vues du projet). Le viral de Kelly du 31/08 (837 500 vues) comptait sur
 * deux missions de deux formats différents ; Naia avait collé le même reel sur
 * sept missions, payées chacune au fixe. Rien ne l'empêchait : la paie et les
 * analytics dédoublonnaient par `publicationId`, jamais par VIDÉO.
 *
 * ── La règle ─────────────────────────────────────────────────────────────────
 * La vidéo derrière un lien (`postKeyOf`, convex/postUrlShape) ne s'attache qu'à
 * UNE publication du projet. C'est une garde « prouvée » au sens de #153 : on ne
 * refuse que ce qu'on démontre faux, et un id de vidéo déjà porté par une autre
 * publication EST la preuve. Aucun cas légitime connu ne colle la même vidéo sur
 * deux missions (un repost sur un autre compte a son propre lien).
 *
 * Module sans dépendance sur convex/publications : importé par lui (`updateMetrics`)
 * comme par convex/assignments (les trois chemins de saisie d'une mission).
 */

import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ERR, err } from "./errorCodes";
import { postKeyOf } from "./postUrlShape";
import type { Plateforme } from "./platforms";

/**
 * Motif affiché à la place des chiffres d'une publication marquée en double
 * (même canal que `foreignOwnerReason` : `lastCollectFailureReason`, repris tel
 * quel par les écrans qui disent pourquoi un post n'a pas de vues).
 */
export const DUPLICATE_LINK_REASON = "lien déjà rattaché à une autre mission";

/**
 * Clé STOCKÉE d'un lien : `postKeyOf`, ou `""` quand il n'y en a pas (pas
 * publiée, lien sans clé). La chaîne vide n'est jamais cherchée par la garde
 * (`postKeyOf` ne la rend pas) ; elle dit seulement « déjà calculée », pour que
 * la tâche de rattrapage ne relise pas indéfiniment les mêmes lignes.
 */
export function storedPostKey(url: string | undefined): string {
  return (typeof url === "string" && url.length > 0 ? postKeyOf(url) : null) ?? "";
}

/**
 * La publication du projet qui porte DÉJÀ la vidéo de ce lien, hors `except`
 * (la publication qu'on corrige, celles de la mission qu'on publie). `null` =
 * aucune, ou un lien sans clé.
 */
export async function findLinkedPublication(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  url: string,
  except: ReadonlySet<string> = new Set(),
): Promise<Doc<"publications"> | null> {
  const key = postKeyOf(url);
  if (key === null) return null;
  const rows = await ctx.db
    .query("publications")
    .withIndex("by_project_postKey", (q) => q.eq("projectId", projectId).eq("postKey", key))
    .take(20);
  return rows.find((p) => !except.has(p._id as string)) ?? null;
}

/**
 * Refuse un lien dont la vidéo est déjà rattachée à une autre publication du
 * projet. Le message ne nomme personne : la publication trouvée peut être celle
 * d'une autre créatrice (cas réel : Marine avait collé la vidéo de Sarah).
 */
export async function assertPostUrlNotLinked(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  url: string,
  platform: Plateforme,
  except: ReadonlySet<string> = new Set(),
): Promise<void> {
  const linked = await findLinkedPublication(ctx, projectId, url, except);
  if (linked === null) return;
  throw err(
    ERR.POST_URL_ALREADY_LINKED,
    `Ce lien ${platform} est déjà celui d'une autre mission : colle le lien du post de cette vidéo-ci.`,
    { platform },
  );
}

// ─── La publication GARDÉE d'un groupe de doublons (règle pure) ───────────────

/** Ce que la règle lit d'une publication. */
export type DuplicateCandidate = {
  _id: string;
  _creationTime: number;
  compte: string;
  postUrl?: string;
};

/** `@Kelly.Leydie` → `kelly.leydie`. */
function normalizeHandle(h: string): string {
  return h.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Le compte publie-t-il la vidéo de son lien ? Lisible seulement sur un lien
 * TikTok canonique (`tiktok.com/@<handle>/video/<id>`) ; `null` = on ne sait pas
 * (Instagram, lien court, lien sans @).
 */
export function accountOwnsLink(p: { compte: string; postUrl?: string }): boolean | null {
  const m = /tiktok\.com\/@([^/?#]+)\//i.exec(p.postUrl ?? "");
  if (!m) return null;
  return normalizeHandle(decodeURIComponent(m[1])) === normalizeHandle(p.compte);
}

/**
 * Répartit les publications d'UNE vidéo : celle qui garde les vues, et les
 * autres. Arbitrage du fondateur (19/11/2026) :
 *   1. en TikTok, celle du COMPTE QUI POSSÈDE la vidéo (le @ du lien) ;
 *   2. sinon, la PLUS ANCIENNE (le premier lien collé) ;
 *   3. à égalité, l'id — pour qu'un rejeu rende toujours la même.
 */
export function splitDuplicates<T extends DuplicateCandidate>(
  pubs: readonly T[],
): { keeper: T; extras: T[] } {
  if (pubs.length === 0) throw new Error("splitDuplicates : groupe vide");
  const rank = (p: T) => (accountOwnsLink(p) === false ? 1 : 0);
  const sorted = [...pubs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a._creationTime - b._creationTime ||
      (a._id < b._id ? -1 : a._id > b._id ? 1 : 0),
  );
  return { keeper: sorted[0], extras: sorted.slice(1) };
}

/**
 * Groupes de publications qui partagent une vidéo (2 au moins), par clé de post
 * calculée sur le lien ACTUEL — jamais sur `postKey` stocké, qui peut manquer
 * (publications d'avant la clé) ou retarder (lien court pas encore résolu).
 */
export function duplicateGroups<T extends DuplicateCandidate>(
  pubs: readonly T[],
): { key: string; keeper: T; extras: T[] }[] {
  const byKey = new Map<string, T[]>();
  for (const p of pubs) {
    if (typeof p.postUrl !== "string" || p.postUrl.length === 0) continue;
    const key = postKeyOf(p.postUrl);
    if (key === null) continue;
    const arr = byKey.get(key);
    if (arr) arr.push(p);
    else byKey.set(key, [p]);
  }
  const out: { key: string; keeper: T; extras: T[] }[] = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    out.push({ key, ...splitDuplicates(group) });
  }
  return out;
}
