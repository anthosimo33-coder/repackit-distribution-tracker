/**
 * PÉRIMÈTRE DE CRÉATRICES D'UN MANAGER — sur qui il a la main.
 *
 * Module PUR (aucun import `_generated`), même patron que `convex/permissions.ts`
 * et `convex/roles.ts` : importable côté client et testable depuis `lib/`.
 *
 * ── DEUX AXES, PAS UN ────────────────────────────────────────────────────────
 * Les blocs (`permissions`) disent QUELS ÉCRANS et QUELS GESTES. Le périmètre dit
 * SUR QUI. Un manager d'un marché garde « Assignments et planning », mais ne
 * l'exerce que sur les créatrices de son marché. Les deux se croisent, aucun ne
 * remplace l'autre.
 *
 * ── ABSENT = TOUTES ──────────────────────────────────────────────────────────
 * `memberships.creatorScope` absent ⇒ AUCUNE restriction. C'est l'inverse du
 * fail-closed des blocs, et c'est délibéré (arbitrage du 13/09/2026) : le jour du
 * déploiement ne doit rien changer pour les managers déjà en place, exactement
 * comme la bascule des blocs n'a rien changé pour les admins. La restriction est
 * un geste qu'on fait, pas un état dans lequel on tombe.
 *
 * ⚠️ UNE LISTE VIDE N'EST PAS « ABSENT ». `[]` veut dire « aucune créatrice » :
 * c'est un choix explicite, et il ferme tout le nominatif. Ne JAMAIS normaliser
 * `[]` en `undefined` (ni l'inverse) — ce serait ouvrir tout le projet à quelqu'un
 * qu'on vient de restreindre.
 *
 * ── CE QUE LE PÉRIMÈTRE NE BORNE PAS ─────────────────────────────────────────
 * Les écrans AGRÉGÉS (Dashboard, Tracker, performance des scripts) restent à
 * l'échelle du projet — arbitrage du 13/09/2026. Seul le NOMINATIF est filtré :
 * fiches, comptes, assignments, validation, rushes, et toute action sur une
 * créatrice.
 *
 * La barrière vit côté serveur (`creatorScopeFor` / `requireCreatorInScope` dans
 * convex/functions.ts). Rien ici ne protège quoi que ce soit : ce module décide,
 * il ne garde pas.
 */

/** `null` = toutes les créatrices ; un ensemble = seulement celles-là. */
export type CreatorScope = ReadonlySet<string> | null;

/**
 * Le périmètre porté par un membership. `undefined`/`null` ⇒ toutes ; une liste
 * (même vide) ⇒ exactement celle-là.
 */
export function creatorScopeFrom(
  stored: readonly string[] | null | undefined,
): CreatorScope {
  if (stored === undefined || stored === null) return null;
  return new Set(stored);
}

/**
 * La créatrice est-elle dans le périmètre ?
 *
 * Un objet SANS créatrice (compte interne de l'équipe, ligne orpheline) n'est
 * dans aucun périmètre restreint : un manager de marché n'a pas la main sur ce
 * qui n'appartient à personne. Sans restriction, tout passe.
 */
export function isInCreatorScope(
  scope: CreatorScope,
  creatorId: string | null | undefined,
): boolean {
  if (scope === null) return true;
  return creatorId !== null && creatorId !== undefined && scope.has(creatorId);
}

/** Garde les lignes dont la créatrice est dans le périmètre. */
export function filterByCreatorScope<T>(
  rows: readonly T[],
  creatorIdOf: (row: T) => string | null | undefined,
  scope: CreatorScope,
): T[] {
  if (scope === null) return [...rows];
  return rows.filter((r) => isInCreatorScope(scope, creatorIdOf(r)));
}

/**
 * Le périmètre sous sa forme de JOURNAL — pour `traceDiff`, qui compare deux
 * listes de chaînes et écrit ce qui change.
 *
 * « Toutes » est une ligne à elle seule : passer de « toutes » à « trois
 * créatrices » écrit un retrait de « toutes » et trois ajouts, ce qui se relit
 * exactement comme le geste fait.
 */
export const SCOPE_ALL_TRACE = "périmètre:toutes";
export const SCOPE_CREATOR_TRACE_PREFIX = "périmètre:";

export function scopeTrace(stored: readonly string[] | null | undefined): string[] {
  if (stored === undefined || stored === null) return [SCOPE_ALL_TRACE];
  return stored.map((id) => `${SCOPE_CREATOR_TRACE_PREFIX}${id}`);
}

/** L'id de créatrice porté par une ligne de journal de périmètre, sinon `null`. */
export function creatorIdOfScopeTrace(permission: string): string | null {
  if (permission === SCOPE_ALL_TRACE) return null;
  if (!permission.startsWith(SCOPE_CREATOR_TRACE_PREFIX)) return null;
  return permission.slice(SCOPE_CREATOR_TRACE_PREFIX.length);
}
