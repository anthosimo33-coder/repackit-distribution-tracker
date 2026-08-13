import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { clipperQuery } from "./functions";
import { utcDayKey, utcDayRange } from "./accountPhase";
import { resolveCreatorKind } from "./roles";

/**
 * COMPTAGE DES PUBLICATIONS PAR COMPTE ET PAR JOUR — l'unique implémentation.
 *
 * POURQUOI UN MODULE. L'écran clippeur affiche « 1 post sur 2 ce jour-là » et le
 * serveur refuse au-delà du quota. Si les deux comptaient séparément, ils
 * finiraient par ne plus dire la même chose — et l'écran annoncerait un créneau
 * libre pendant que la publication est refusée. On vient d'en payer une avec
 * `digest_warmup_late`, où le digest et le tableau de bord ont divergé sur ce
 * qu'ils comptaient. La garde (`assertClipperDailyQuota`) et la query de lecture
 * (`myQuotaWindow`) appellent donc les MÊMES fonctions.
 *
 * Les deux règles qui ne doivent jamais diverger sont ici :
 *   1. le RAPPROCHEMENT publication → compte se fait par HANDLE ;
 *   2. le SEAU est la journée UTC de `datePubli`.
 */

/**
 * Fenêtre de lecture de l'écran, en jours. Le serveur borne déjà la date de
 * publication déclarée à `assignment.createdAt` au plus tôt ; 30 jours couvre
 * très largement l'antidatage réel (un post de la veille), pour une plage
 * d'index de quelques dizaines de documents.
 */
export const QUOTA_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Publications du projet dont `datePubli` tombe dans `[start, end)`.
 *
 * Plage d'INDEX (`by_project_datePubli`), jamais un scan des publications du
 * projet — c'est le risque n°9 du diagnostic.
 */
export async function publicationsInRange(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  start: number,
  end: number,
): Promise<Doc<"publications">[]> {
  return await ctx.db
    .query("publications")
    .withIndex("by_project_datePubli", (q) =>
      q.eq("projectId", projectId).gte("datePubli", start).lt("datePubli", end),
    )
    .collect();
}

/**
 * Une publication appartient-elle à ce compte ? Par HANDLE : `publications.compte`
 * est une string, pas un `Id<"comptes">` (TD-001), et c'est la jointure canonique
 * du dépôt.
 */
export function publicationIsOnHandle(
  p: Doc<"publications">,
  handle: string,
): boolean {
  return p.compte === handle;
}

/** Nombre de publications de ce compte dans un lot déjà chargé. */
export function countOnHandle(
  pubs: Doc<"publications">[],
  handle: string,
): number {
  return pubs.filter((p) => publicationIsOnHandle(p, handle)).length;
}

/**
 * Comptage `handle → clé de jour UTC → nombre`, sur un lot déjà chargé. Les jours
 * sans publication sont ABSENTS de la table (le lecteur applique 0) : matérialiser
 * trente zéros par compte n'apprend rien de plus.
 */
export function tallyByHandleAndDay(
  pubs: Doc<"publications">[],
  handles: string[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const h of handles) out[h] = {};
  for (const p of pubs) {
    const bucket = out[p.compte];
    if (bucket === undefined) continue;
    const key = utcDayKey(p.datePubli);
    bucket[key] = (bucket[key] ?? 0) + 1;
  }
  return out;
}

/** Bornes de la fenêtre de lecture : `QUOTA_WINDOW_DAYS` jours UTC jusqu'à `at` inclus. */
export function quotaWindowRange(at: number): { start: number; end: number } {
  const today = utcDayRange(at);
  return {
    start: today.start - (QUOTA_WINDOW_DAYS - 1) * DAY_MS,
    end: today.end,
  };
}

/**
 * COMPTEUR DE L'ÉCRAN CLIPPEUR — ses comptes, et pour chacun le nombre de
 * publications par journée UTC sur la fenêtre.
 *
 * L'écran dérive phase et quota de `validatedAt` avec `convex/accountPhase.ts`
 * (module pur, importable côté client) : la règle n'est pas dupliquée ici, seul
 * le comptage — qui exige la base — l'est.
 *
 * ⚠️ Une date HORS FENÊTRE doit faire dire « le serveur vérifiera » à l'écran,
 * jamais « 0 publié » : un compteur faux est pire que pas de compteur. Les bornes
 * sortent donc avec les données.
 */
export const myQuotaWindow = clipperQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const { start, end } = quotaWindowRange(now);
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_creator", (q) =>
        q.eq("projectId", ctx.projectId).eq("creatorId", ctx.creatorId),
      )
      .collect();
    const handles = comptes.map((c) => c.handle);
    // Aucun compte : inutile d'ouvrir la plage d'index.
    const pubs =
      handles.length === 0
        ? []
        : await publicationsInRange(ctx, ctx.projectId, start, end);
    const parCompte = tallyByHandleAndDay(pubs, handles);
    return {
      windowStart: start,
      windowEnd: end,
      comptes: comptes.map((c) => ({
        compteId: c._id,
        handle: c.handle,
        plateforme: c.plateforme,
        validatedAt: c.validatedAt ?? null,
        parJour: parCompte[c.handle] ?? {},
      })),
    };
  },
});

/**
 * Le propriétaire d'un compte est-il un clippeur ? Le quota ne s'applique QU'À
 * eux (arbitrage D3 : le warmup d'une partenaire se compte en checks réellement
 * posés, pas en jours écoulés).
 */
export async function ownerIsClipper(
  ctx: QueryCtx,
  compte: Doc<"comptes">,
): Promise<boolean> {
  if (!compte.creatorId) return false;
  const owner = await ctx.db.get(compte.creatorId);
  return resolveCreatorKind(owner?.kind) === "clipper";
}
