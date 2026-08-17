/**
 * GRADUATION d'un hook — passage du laboratoire aux ouvertures prouvées.
 *
 * Module PUR (aucun import Convex) : importable depuis `convex/` et le client,
 * testable en vitest via `lib/graduation.test.ts`. Même arrangement que
 * `convex/angleFamily.ts`.
 *
 * ── La règle ─────────────────────────────────────────────────────────────────
 * Un hook du LAB qui a fait ses preuves SUR UN RUN (une publication réelle, pas
 * une moyenne) part dans la banque des ouvertures prouvées. « Sur un run » est
 * délibéré : un hook qui explose une fois est un hook qui marche, une moyenne le
 * noierait sous ses essais ratés.
 *
 * ── L'invariant ──────────────────────────────────────────────────────────────
 * Graduer, c'est DEUX écritures indissociables : copier le hook dans les
 * prouvées ET désactiver l'original dans le LAB. Faire l'une sans l'autre
 * laisserait le MÊME texte actif dans deux campagnes — et le cooldown ne le
 * verrait pas : il travaille sur `comboKey`, donc sur des identifiants de
 * briques, pas sur du texte. Deux briques distinctes portant le même hook sont
 * deux clés différentes : rien ne les empêcherait de sortir le même jour.
 *
 * Les mutations Convex étant transactionnelles, l'atomicité est acquise dès lors
 * que les deux écritures vivent dans LA MÊME mutation — c'est la seule chose à
 * ne pas casser en déplaçant ce code.
 */

/** Nom INTERNE de la campagne laboratoire (source des graduations). */
export const LAB_CAMPAIGN_NAME = "Format Warmup LAB";
/** Nom INTERNE de la campagne des ouvertures prouvées (cible). */
export const PROVEN_CAMPAIGN_NAME = "Format Warmup - Ouvertures prouvées";

/**
 * Seuils de graduation, mesurés SUR UN RUN.
 *
 * ⚠️ Ils vont bouger — c'est leur raison d'être ici plutôt qu'en dur dans une
 * condition. Les toucher change ce que le dashboard PROPOSE, jamais ce qui a
 * déjà été gradué (l'historique fige les scores du moment).
 */
export const GRADUATION_MIN_VIEWS = 10_000;
export const GRADUATION_MIN_SAVE_RATE = 0.01;
export const GRADUATION_MIN_LIKE_RATE = 0.08;

/** Métriques d'UN run (une publication) servant à juger un hook. */
export type HookRun = {
  vues: number;
  likes: number;
  /** `null` = donnée non collectée (le relevé auto ne remonte pas toujours les
   *  saves) — distinct de 0, qui est une mesure. */
  saves: number | null;
};

/** Taux rapporté aux vues. `null` si le dénominateur est nul ou la mesure absente. */
export function rateOf(count: number | null, vues: number): number | null {
  if (count === null || vues <= 0) return null;
  return count / vues;
}

/**
 * Ce run fait-il passer le hook en « prouvé » ?
 *
 * Les trois seuils sont exigés ENSEMBLE : des vues sans engagement, c'est une
 * poussée d'algorithme, pas une ouverture qui accroche. Un taux NON MESURÉ
 * (saves absentes du relevé) ne vaut PAS un taux satisfait — sans quoi tout run
 * volumineux graduerait tant que la collecte des saves n'est pas branchée.
 */
export function qualifiesForGraduation(run: HookRun): boolean {
  if (run.vues < GRADUATION_MIN_VIEWS) return false;
  const likeRate = rateOf(run.likes, run.vues);
  const saveRate = rateOf(run.saves, run.vues);
  if (likeRate === null || likeRate < GRADUATION_MIN_LIKE_RATE) return false;
  if (saveRate === null || saveRate < GRADUATION_MIN_SAVE_RATE) return false;
  return true;
}

/**
 * Meilleur run d'un hook au sens de la graduation : celui qui qualifie ; à
 * défaut, le plus gros en vues (pour afficher « au mieux, il a fait ça »).
 * `null` si le hook n'a aucun run.
 */
export function bestRun(runs: readonly HookRun[]): HookRun | null {
  if (runs.length === 0) return null;
  const qualifiants = runs.filter(qualifiesForGraduation);
  const pool = qualifiants.length > 0 ? qualifiants : runs;
  return pool.reduce((a, b) => (b.vues > a.vues ? b : a));
}

/**
 * Clé d'identité d'un hook par son TEXTE : casse, accents et espaces pliés.
 *
 * C'est elle qui rend la graduation IDEMPOTENTE. On ne peut pas comparer les
 * identifiants de briques (la copie en a un nouveau) ni le texte brut (une
 * majuscule ou un espace en trop rouvrirait la porte au doublon que tout ce
 * mécanisme cherche à éviter).
 */
export function hookIdentityKey(content: string): string {
  return content
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deux campagnes peuvent porter le même nom à la casse ou aux espaces près :
 * la résolution est tolérante, faute de quoi un « Format Warmup Lab » saisi à la
 * main resterait introuvable et la graduation échouerait sans raison lisible.
 *
 * ⚠️ Ces campagnes sont identifiées par leur NOM, pas par un champ de rôle : les
 * renommer casse la graduation. C'est le compromis retenu pour ne pas imposer de
 * migration ; si le besoin se répète, la bonne suite est un champ `role`
 * ("lab" | "proven") sur `scriptCampaigns`.
 */
export function campaignNameMatches(name: string, expected: string): boolean {
  return hookIdentityKey(name) === hookIdentityKey(expected);
}

/** Issue d'une tentative de graduation. */
export type GraduationOutcome =
  /** Copié dans les prouvées + original désactivé. */
  | "graduated"
  /**
   * Le texte existait DÉJÀ dans les prouvées : rien n'est copié (pas de
   * doublon), mais l'original du LAB est bien désactivé — c'est justement ce qui
   * rétablit l'invariant « un seul exemplaire actif ».
   */
  | "already-graduated";
