/**
 * SCRIPTS RÉUTILISABLES — un script déjà fait par une créatrice peut lui
 * revenir, sur tous les projets (décision du 11/11/2026).
 *
 * Un script est un modèle que la créatrice dit avec ses mots, plus un texte
 * figé. L'ancienne unicité à vie (un même combo hook:flux:cta jamais redonné à
 * la même créatrice sur la même plateforme) épuisait les petits catalogues : 15
 * scripts à une vidéo par jour, deux semaines. Ce qui en reste est une
 * PRÉFÉRENCE, appliquée vidéo par vidéo :
 *
 *  1. d'abord un script qu'elle n'a JAMAIS fait sur ces plateformes, par le
 *     tirage équilibré habituel (hook, flux, légende les moins servis) ;
 *  2. une fois tous faits, celui qu'elle a fait il y a le PLUS LONGTEMPS — pas
 *     le premier du catalogue : sans cet ordre, un catalogue épuisé
 *     redonnerait toujours le même script, celui du premier hook créé.
 *
 * Ce qui reste INTERDIT pour une vidéo ne vient pas d'ici : le délai entre deux
 * usages d'un même script sur le projet (`projects.comboCooldownDays`, cf
 * convex/comboCooldown.ts), qui vaut aussi pour elle, et les scripts retirés à
 * la main dans l'aperçu.
 *
 * Module PUR (aucun import Convex) : le tirage serveur (convex/scripts.ts,
 * `pickForDates`) l'appelle tel quel, lib/script-combo-uniqueness.ts en est la
 * face lib, et lib/script-combo-uniqueness.test.ts le teste avec le tirage
 * équilibré de lib (réplique A6 de celui du serveur).
 */

/** Une mission de la créatrice, réduite à ce que la préférence lit. */
export type PassageDeScript = {
  creatorId: string;
  comboKey: string | null | undefined;
  /** Plateformes de la mission (1 mission = 1+ posts). */
  platforms: readonly string[];
  /**
   * Quand elle le dit : publication prévue, sinon réelle, sinon création de la
   * mission. Une mission prévue dans dix jours compte à sa date : c'est là
   * qu'elle le dira.
   */
  at: number;
  /**
   * Combo IMPOSÉ (« Rejouer ce script », combinaison choisie, Pilote) : ne
   * compte pas comme « déjà fait » pour le tirage automatique — un choix
   * manuel ne retire rien de la rotation (règle d'avant, gardée telle quelle).
   */
  comboImposed?: boolean;
  /** Abandonnée ou vidéo refusée : jamais sortie, ne compte pas (cf comboFreeing). */
  liberee?: boolean;
};

/**
 * Instant qui suit toute date réelle : le plus grand qu'une `Date` JS puisse
 * porter (8,64 × 10¹⁵ ms). Les choix SANS date d'un même tirage s'y rangent,
 * dans l'ordre où ils ont été faits — ils sont plus récents que tout ce qui est
 * en base, et entre eux, le premier choisi est le moins récent. Reste exact
 * jusqu'à 2⁵³ : très au-delà des 50 vidéos d'un tirage.
 */
export const APRES_TOUTE_DATE = 8.64e15;

/**
 * Dernier passage de chaque script chez CETTE créatrice, sur AU MOINS UNE des
 * plateformes visées (une mission publie sur toutes ses cibles : un script
 * fait sur l'une est déjà fait pour la mission). Les clés de la table sont les
 * scripts « déjà faits » ; un script absent n'a jamais été fait.
 *
 * Cross-plateforme : un script fait sur son TikTok reste neuf pour son
 * YouTube. Autre créatrice : rien ne se partage.
 */
export function derniersPassages(
  passages: readonly PassageDeScript[],
  cible: { creatorId: string; platforms: readonly string[] },
): Map<string, number> {
  const visees = new Set(cible.platforms);
  const out = new Map<string, number>();
  for (const p of passages) {
    if (p.creatorId !== cible.creatorId || !p.comboKey) continue;
    if (p.liberee === true || p.comboImposed === true) continue;
    if (!p.platforms.some((pf) => visees.has(pf))) continue;
    const avant = out.get(p.comboKey);
    if (avant === undefined || p.at > avant) out.set(p.comboKey, p.at);
  }
  return out;
}

/**
 * Le script fait il y a le plus longtemps, parmi ceux qui ne sont pas
 * `exclus`. Un script jamais fait passe avant tout (−∞). À égalité, l'ordre du
 * catalogue : le résultat est déterministe, donc l'aperçu reste ce que la
 * création fera. `null` = tout est exclu.
 */
export function moinsRecent<C>(
  combos: readonly C[],
  cleDe: (c: C) => string,
  derniers: ReadonlyMap<string, number>,
  exclus: ReadonlySet<string>,
): C | null {
  let meilleur: C | null = null;
  let meilleurAt = Infinity;
  for (const c of combos) {
    const cle = cleDe(c);
    if (exclus.has(cle)) continue;
    const at = derniers.get(cle) ?? -Infinity;
    if (meilleur === null || at < meilleurAt) {
      meilleur = c;
      meilleurAt = at;
    }
  }
  return meilleur;
}

/**
 * TIRAGE VIDÉO PAR VIDÉO d'une créatrice : la boucle que la création et
 * l'aperçu partagent (cf convex/scripts.ts `pickForDates`).
 *
 * Pour chaque vidéo, à sa date :
 *  - interdits : `bloquesLe(date)` (le délai du projet, missions en base), les
 *    retraits à la main, et les choix de CE tirage à moins de `delaiMs` de
 *    cette date (le délai vaut aussi entre ses propres vidéos) ;
 *  - parmi le reste, un script jamais fait (`equilibre`, qui reçoit en
 *    exclusions les interdits ET les déjà faits, comme le tirage d'avant) ;
 *  - sinon le moins récemment fait (`moinsRecent`).
 * Un choix de ce tirage devient aussitôt un passage, à sa date (ou après toute
 * date s'il n'en a pas) : la vidéo suivante le voit comme le plus récent.
 *
 * `onExhausted` : tout est interdit à cette date. L'appelant décide (la
 * création lève une erreur datée si c'est le délai, sinon on s'arrête et la
 * pénurie est rendue).
 */
export function tirerPourDates<C>(input: {
  combos: readonly C[];
  cleDe: (c: C) => string;
  /** Tirage équilibré d'UN combo parmi ceux hors `exclus` (null = aucun). */
  equilibre: (combos: readonly C[], exclus: ReadonlySet<string>) => C | null;
  /** Ses derniers passages en base (`derniersPassages`). */
  derniers: ReadonlyMap<string, number>;
  /** Scripts interdits à cette date par le délai du projet (missions en base). */
  bloquesLe: (date: number | undefined) => ReadonlySet<string>;
  /** Délai du projet en ms, appliqué aux choix de CE tirage entre eux. */
  delaiMs: number;
  dates: readonly (number | undefined)[] | undefined;
  count: number;
  retiresALaMain?: readonly string[];
  onExhausted?: (date: number | undefined) => void;
}): C[] {
  const derniers = new Map(input.derniers);
  const choisis: { cle: string; date: number | undefined }[] = [];
  const out: C[] = [];
  for (let i = 0; i < input.count; i++) {
    const date = input.dates?.[i];
    const interdits = new Set<string>([
      ...input.bloquesLe(date),
      ...(input.retiresALaMain ?? []),
    ]);
    if (date !== undefined) {
      for (const c of choisis) {
        if (c.date !== undefined && Math.abs(c.date - date) < input.delaiMs) interdits.add(c.cle);
      }
    }
    const jamaisFaits = input.equilibre(input.combos, new Set([...interdits, ...derniers.keys()]));
    const un = jamaisFaits ?? moinsRecent(input.combos, input.cleDe, derniers, interdits);
    if (un === null) {
      input.onExhausted?.(date);
      break;
    }
    const cle = input.cleDe(un);
    const at = date ?? APRES_TOUTE_DATE + i;
    derniers.set(cle, Math.max(derniers.get(cle) ?? -Infinity, at));
    choisis.push({ cle, date });
    out.push(un);
  }
  return out;
}
