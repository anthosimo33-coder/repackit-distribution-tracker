/**
 * ÉLIGIBILITÉ D'UN SCRIPT À UN RUSH — la garde D7, et le mode d'usage des
 * briques dont elle dérive.
 *
 * Module PUR (aucun import `_generated`) → importable côté serveur, côté client
 * ET depuis `lib/`, en une seule définition (patron `convex/roles.ts`,
 * `convex/rushStatus.ts`, `convex/accountPhase.ts`). `lib/script-mode.ts` en
 * RÉ-EXPORTE `resolveBrickMode` : A6 interdit `convex/ → lib/`, pas l'inverse,
 * donc déplacer la définition ici ne crée aucune copie de plus — elle en retire
 * une de la trajectoire.
 *
 * ⚠️ IL RESTE UNE OCCURRENCE NON FUSIONNÉE : le `?? "les_deux"` inline de
 * `convex/assignments.splitScriptZones`. Elle rend le script de la créatrice
 * PARTENAIRE ; la toucher sortirait du périmètre de ce chantier. Sa garde
 * anti-divergence (comparaison à l'octet près du texte assemblé) existe déjà.
 *
 * ─── LA RÈGLE (arbitrage D7, cas A) ────────────────────────────────────────
 * Tous les rushes sont MUETS : le texte arrive à l'écran au montage. Un script
 * n'est donc assignable à un rush que si tout ce qui doit passer DANS la vidéo
 * est à AFFICHER, jamais à dire.
 *
 * Deux précisions qui ne sont pas des détails :
 *
 * 1. `cta` est EXCLU de la garde. Son `mode` est ignoré par conception (zone
 *    description, cf schema) et AUCUN cta n'en porte en production (14/14
 *    absents au 2026-08-11). L'inclure refuserait 100 % des scripts — la garde
 *    serait silencieusement mortelle.
 * 2. `mode` ABSENT = REFUSÉ, aligné sur le défaut `les_deux` de
 *    `resolveBrickMode`. Relevé prod (2026-08-13) : 77 briques gardées sont refusées — 34 hooks et
 *    18 flux sans mode, 14 hooks « dire », 8 hooks et 3 flux « les_deux ». Ce
 *    n'est PAS bloquant : 228 hooks et 28 flux sont déjà « afficher », donc le
 *    stock assignable existe. Étiqueter le reste se fait à la main, et commence
 *    par les FLUX (28 utilisables contre 21 refusés : le gain y est décisif,
 *    alors qu'il est marginal côté hooks). Aucun traitement de faveur pour de la donnée incomplète :
 *    une brique dont personne n'a dit si elle se dit ou s'affiche n'est pas une
 *    brique à afficher.
 */

/** Mode d'usage d'une brique DANS la vidéo (zone 🎬). */
export type BrickMode = "dire" | "afficher" | "les_deux";

/** Défaut rétrocompat : brique sans mode (ou valeur inconnue) → "les_deux". */
export function resolveBrickMode(mode: string | null | undefined): BrickMode {
  return mode === "dire" || mode === "afficher" || mode === "les_deux"
    ? mode
    : "les_deux";
}

/** Les seuls kinds soumis à la garde. `cta` n'y est PAS — cf en-tête. */
export const RUSH_GUARDED_KINDS = ["hook", "flux"] as const;
export type RushGuardedKind = (typeof RUSH_GUARDED_KINDS)[number];

/** La forme minimale d'une brique dont dépend la décision. */
export interface EligibilityBrick {
  kind: string;
  mode?: string;
  content: string;
  active: boolean;
}

/** Ce kind est-il soumis à la garde ? */
export function isGuardedKind(kind: string): kind is RushGuardedKind {
  return kind === "hook" || kind === "flux";
}

/**
 * Cette brique peut-elle entrer dans un script monté sur un rush ?
 *
 * Un `cta` passe TOUJOURS (hors garde). Un `hook` ou un `flux` ne passe que s'il
 * est explicitement `afficher`.
 */
export function isBrickRushEligible(brick: EligibilityBrick): boolean {
  if (!isGuardedKind(brick.kind)) return true;
  return resolveBrickMode(brick.mode) === "afficher";
}

/**
 * Filtre les briques éligibles AVANT le tirage.
 *
 * Filtrer en amont plutôt que refuser le combo tiré est ce qui évite à l'admin
 * de tomber sur « aucun combo disponible » : le tirage ne travaille que sur des
 * briques valides, et l'absence de combo devient une information exacte (« ce
 * hook-ci n'est pas à afficher ») au lieu d'un cul-de-sac.
 */
export function eligibleBricksForRush<T extends EligibilityBrick>(
  bricks: T[],
): T[] {
  return bricks.filter(isBrickRushEligible);
}

/** Extrait court d'une brique, pour la nommer dans un message d'erreur. */
function extrait(content: string, max = 60): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Libellé FR du kind, pour les messages. */
const KIND_LABEL: Record<string, string> = {
  hook: "accroche",
  flux: "corps",
  // i18n-exempt: motif de refus ADMIN (assignation de script) — jamais rendu dans un portail créateur
  cta: "appel à l'action",
};

/**
 * Explique POURQUOI une brique est refusée, en la NOMMANT.
 *
 * « Aucun combo disponible » sans explication est le pire message possible :
 * l'admin ne sait ni quelle brique corriger, ni comment. Ici il lit la brique
 * fautive, son mode actuel et le geste attendu.
 */
export function describeIneligibleBrick(brick: EligibilityBrick): string {
  const mode = resolveBrickMode(brick.mode);
  const kind = KIND_LABEL[brick.kind] ?? brick.kind;
  const cause =
    brick.mode === undefined || brick.mode === null || brick.mode === ""
      // i18n-exempt: motif de refus ADMIN (assignation de script) — jamais rendu dans un portail créateur
      ? "son mode n'est pas renseigné"
      // i18n-exempt: motif de refus ADMIN (assignation de script) — jamais rendu dans un portail créateur
      : `elle est réglée sur « ${mode === "dire" ? "Dire à l'oral" : "Les deux"} »`;
  return `L'${kind} « ${extrait(brick.content)} » ne peut pas servir sur un rush : ${cause}. Les rushes sont muets — passe-la sur « Afficher à l'écran ».`;
}

/**
 * Message d'ensemble quand AUCUN combo n'est assignable, listant les briques à
 * corriger (bornées à 3 pour rester lisible).
 */
export function describeNoEligibleCombo(
  ineligible: EligibilityBrick[],
): string {
  const actives = ineligible.filter((b) => b.active);
  if (actives.length === 0) {
    // i18n-exempt: motif de refus ADMIN (assignation de script) — jamais rendu dans un portail créateur
    return "Aucun script assignable : cette campagne n'a pas d'accroche et de corps actifs.";
  }
  const head = actives.slice(0, 3).map((b) => describeIneligibleBrick(b));
  const reste =
    actives.length > 3 ? ` (+ ${actives.length - 3} autre(s) à corriger)` : "";
  return `${head.join(" ")}${reste}`;
}
