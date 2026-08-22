/**
 * QUADRANT « Vues × Intent » — classement dérivé d'un post publié sur deux axes
 * INDÉPENDANTS, à partir des seules métriques TikTok déjà relevées.
 *
 *   X — DISTRIBUTION : vues du post ÷ médiane de son compte sur 14 jours.
 *       « Est-ce que ce post est sorti plus loin que ce que ce compte fait
 *       normalement ? » Un ratio et pas un nombre absolu : 40 000 vues sur un
 *       compte à 200 000 de médiane est une contre-performance.
 *   Y — INTENT : saves ÷ vues. « Les gens qui l'ont vu ont-ils eu envie d'y
 *       revenir ? » Le save est le geste le plus coûteux qu'expose la donnée.
 *
 * Croiser les deux sépare quatre situations qu'un classement par vues confond :
 * un post vu et gardé (on reconduit), vu et oublié (le produit arrive mal), peu
 * vu mais gardé (le hook ne distribue pas, l'angle est bon), ni l'un ni l'autre.
 *
 * ── Module PUR ───────────────────────────────────────────────────────────────
 * Aucun import de `_generated/server` : il est importé À L'IDENTIQUE par le
 * recalcul serveur (`convex/quadrantSync.ts`, branché sur le relevé nocturne) et
 * par la carte du tracker. Même précédent que `convex/viewsDaily.ts` — un module
 * pur sous `convex/` est importable du client, alors que l'inverse ne l'est pas
 * (règle A6). Il n'y a donc PAS de réplique à tenir synchrone.
 * Les tests vivent dans `lib/quadrant.test.ts`.
 *
 * ── Ce que ce module ne fait PAS ─────────────────────────────────────────────
 * Aucune lecture de conversion / attribution (PostHog, `creator_ref`, Whop) :
 * le quadrant est à 100 % des métriques de plateforme, et doit le rester — un
 * axe « intent » qui mélangerait des saves TikTok et des checkouts Whop ne
 * serait plus lisible sur les 3 posts par mois qui convertissent.
 * Aucune écriture non plus, et aucun contact avec la paie : `isWarmup` n'est lu
 * QUE pour colorer un point, jamais pour décider d'un versement.
 */

import {
  QUADRANT_SETTINGS,
  type QuadrantSettings,
} from "./quadrantSettings";
import { savesAvailability } from "./decisionThresholds";

/* ── Vocabulaire ──────────────────────────────────────────────────────────── */

/**
 * Qualification ÉDITORIALE du post, telle que posée à l'assignation
 * (`assignments.contentType`) et propagée en `publications.isWarmup` :
 *   - `warmup` : `isWarmup === true`  — contenu de chauffe, hors paie ;
 *   - `promo`  : `isWarmup === false` — contenu produit, qualifié explicitement ;
 *   - `autre`  : `isWarmup` ABSENT    — jamais qualifié (post manuel, historique).
 *
 * Les trois sont DISTINCTS : replier « absent » sur « promo » ferait passer un
 * défaut de saisie pour une décision.
 */
export type QuadrantQualification = "warmup" | "promo" | "autre";

/**
 * Les quatre cases. Nommées par ce qu'elles DISENT, jamais par leur position à
 * l'écran (« haut-gauche » dépend de l'orientation des axes ; un jour où l'on
 * inverserait Y, le nom mentirait sans que rien n'échoue).
 */
export type QuadrantKey =
  /** Distribution HAUTE + intent HAUT. */
  | "scale"
  /** Distribution HAUTE + intent FAIBLE. */
  | "intent_faible"
  /** Distribution FAIBLE + intent HAUT. */
  | "distribution_faible"
  /** Les deux FAIBLES. */
  | "archiver";

/**
 * Position de chaque case sur les deux axes. Table EXPLICITE et exportée : le
 * test la lit pour verrouiller le couple (axes → case), qui est exactement
 * l'endroit où une inversion passerait inaperçue à l'écran.
 */
export const QUADRANT_AXES: Record<
  QuadrantKey,
  { distributionHigh: boolean; intentHigh: boolean }
> = {
  scale: { distributionHigh: true, intentHigh: true },
  intent_faible: { distributionHigh: true, intentHigh: false },
  distribution_faible: { distributionHigh: false, intentHigh: true },
  archiver: { distributionHigh: false, intentHigh: false },
};

/** Les quatre cases, dans l'ordre de lecture de la légende. */
export const QUADRANT_KEYS: readonly QuadrantKey[] = [
  "scale",
  "intent_faible",
  "distribution_faible",
  "archiver",
] as const;

/**
 * État d'un post vis-à-vis du classement. Un post NON classé n'est pas un post
 * mauvais — c'est un post sur lequel on ne sait pas encore. Les confondre est
 * précisément le défaut que ce module évite : afficher un point en bas à gauche
 * pour un post dont les saves n'ont jamais été collectées reviendrait à le
 * condamner sur une absence de mesure.
 */
export type QuadrantStatus =
  /** Les deux scores sont calculables : le post a une case. */
  | "classified"
  /** Moins de 48 h : trop tôt pour juger (cf. `MATURITY_HOURS`). */
  | "pending"
  /** Aucun relevé de vues sur ce post — pas « zéro vue », « pas de mesure ». */
  | "not_measured"
  /** Le compte n'a pas de médiane de référence exploitable. */
  | "no_baseline"
  /** Axe Y incalculable (cf. `NoIntentReason`). */
  | "no_intent";

/** Pourquoi l'axe intent est incalculable. */
export type NoIntentReason =
  /** La plateforme n'expose PAS les saves (Instagram, YouTube) — définitif. */
  | "saves_unavailable"
  /** TikTok, mais ce post est antérieur à la collecte des saves — temporaire. */
  | "saves_collecting"
  /** 0 vue mesurée : pas de dénominateur pour un taux. */
  | "no_views";

/**
 * Ce que le calcul attend d'un post. Volontairement réduit aux champs relevés :
 * aucun identifiant de créatrice, aucun libellé — la jointure d'affichage se
 * fait ailleurs (`convex/trackerData.ts`), le classement n'en a pas besoin.
 */
export type QuadrantInput = {
  id: string;
  /** Handle du compte. Couplé à `plateforme` pour l'identité réelle du compte. */
  compte: string;
  plateforme: string;
  datePubli: number;
  /** `vuesLatest`. `null` = JAMAIS relevé, ce qui n'est pas « 0 vue ». */
  vues: number | null;
  /** `savesLatest`. `null` = non collecté, ce qui n'est pas « 0 save ». */
  saves: number | null;
  /** `publications.isWarmup`, TRI-ÉTAT (absent = jamais qualifié). */
  isWarmup?: boolean;
};

export type QuadrantResult = {
  id: string;
  status: QuadrantStatus;
  /** Renseigné UNIQUEMENT quand `status === "no_intent"`. */
  reason: NoIntentReason | null;
  qualification: QuadrantQualification;
  /** Médiane du compte sur la fenêtre, `null` si échantillon insuffisant. */
  baselineViews: number | null;
  /** Nombre de posts qui ont servi à cette médiane (0 s'il n'y en a pas). */
  baselineSample: number;
  /** vues ÷ médiane. `null` si l'un des deux manque. */
  scoreDistribution: number | null;
  /** saves ÷ vues. `null` si l'un des deux manque. */
  scoreIntent: number | null;
  /** La case, UNIQUEMENT si `status === "classified"`. */
  quadrant: QuadrantKey | null;
  /** Publié dans la foulée d'un gros post du même compte (cf. `breakoutFlags`). */
  breakoutWindow: boolean;
};

/**
 * Forme STOCKÉE du résultat sur `publications.quadrant` (cf. le validateur au
 * schéma, dont ce type est le miroir TypeScript).
 *
 * Elle diffère de `QuadrantResult` sur un point volontaire : les valeurs
 * absentes y sont OMISES et jamais `null`. Un `null` en base se relit comme une
 * valeur mesurée à zéro par une lecture distraite ; une clé absente ne se relit
 * pas du tout. `qualification` n'y est pas non plus — elle se dérive à tout
 * moment de `publications.isWarmup`, la stocker en ferait une copie à tenir à
 * jour à chaque bascule warmup.
 */
export type QuadrantSnapshot = {
  computedAt: number;
  status: QuadrantStatus;
  reason?: NoIntentReason;
  baselineViews?: number;
  baselineSample: number;
  scoreDistribution?: number;
  scoreIntent?: number;
  key?: QuadrantKey;
  breakoutWindow: boolean;
};

/* ── Briques ──────────────────────────────────────────────────────────────── */

/**
 * Médiane d'un échantillon. `null` si vide, moyenne des deux centraux si n pair.
 *
 * ⚠️ TROISIÈME définition dans le dépôt (`lib/scriptStats.ts` et sa réplique
 * `convex/scriptAnalytics.ts`). Elle n'est pas importée de là : `scriptStats`
 * est sous `lib/` (interdit au runtime Convex, règle A6) et `scriptAnalytics`
 * n'est pas un module pur (il importe `_generated/server`, donc l'importer
 * traînerait du code serveur dans le bundle client). Un module pur de stats
 * partagé est la bonne sortie ; en attendant, `lib/quadrant.test.ts` verrouille
 * l'égalité des trois implémentations pour qu'elles ne divergent pas en silence.
 */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Qualification éditoriale d'un post depuis le tri-état `isWarmup`. */
export function qualificationOf(isWarmup?: boolean): QuadrantQualification {
  if (isWarmup === true) return "warmup";
  if (isWarmup === false) return "promo";
  return "autre";
}

/**
 * Identité d'un COMPTE : (handle, plateforme) et jamais le handle seul. Le même
 * pseudo vit sur TikTok et sur Instagram, et leurs volumes de vues n'ont rien à
 * voir — une médiane commune ferait juger les posts TikTok à l'aune d'Instagram.
 * C'est aussi la clé d'unicité de la table `comptes`.
 */
export function accountKey(compte: string, plateforme: string): string {
  return `${plateforme}::${compte}`;
}

export type AccountBaseline = { views: number | null; sample: number };

/**
 * Médiane de référence de chaque compte : les vues MESURÉES de ses posts publiés
 * dans la fenêtre glissante, hors posts trop jeunes.
 *
 * Trois exclusions, et chacune corrige une lecture fausse :
 *   - posts de moins de 48 h : ils n'ont pas fini de prendre leurs vues, les
 *     compter tirerait la référence du compte vers le bas à chaque publication ;
 *   - posts jamais relevés (`vues === null`) : les compter pour 0 ferait chuter
 *     la médiane sur un défaut de collecte ;
 *   - posts hors fenêtre : la référence doit suivre la trajectoire du compte.
 *
 * Le warmup, lui, compte par DÉFAUT (`baselineIncludesWarmup`) — arbitrage
 * documenté dans `convex/quadrantSettings.ts`.
 *
 * Le post évalué est INCLUS dans sa propre médiane : tous les posts d'un compte
 * partagent ainsi la même référence, donc leurs scores sont comparables entre
 * eux. En le retirant (leave-one-out), chaque post serait jugé contre une
 * référence différente et un gros post gonflerait son propre score en s'étant
 * lui-même retiré du dénominateur.
 */
export function accountBaselines(
  posts: readonly QuadrantInput[],
  now: number,
  settings: QuadrantSettings = QUADRANT_SETTINGS,
): Map<string, AccountBaseline> {
  const parCompte = new Map<string, number[]>();
  const floor = now - settings.baselineWindowMs;
  for (const p of posts) {
    if (p.vues === null) continue;
    if (p.datePubli < floor) continue;
    if (now - p.datePubli < settings.maturityMs) continue;
    if (!settings.baselineIncludesWarmup && p.isWarmup === true) continue;
    const key = accountKey(p.compte, p.plateforme);
    const bucket = parCompte.get(key);
    if (bucket) bucket.push(p.vues);
    else parCompte.set(key, [p.vues]);
  }

  const out = new Map<string, AccountBaseline>();
  for (const [key, values] of parCompte) {
    const med = values.length >= settings.baselineMinPosts ? medianOf(values) : null;
    out.set(key, {
      // Une médiane à 0 (compte dont la moitié des posts ne sont jamais sortis)
      // est une mesure valable mais un dénominateur impossible : on la traite
      // comme une absence de référence, pas comme un zéro à diviser.
      views: med !== null && med > 0 ? med : null,
      sample: values.length,
    });
  }
  return out;
}

/**
 * Posts publiés dans les 48 h qui SUIVENT un gros post du même compte.
 *
 * Le drapeau ne disqualifie rien : il signale une distribution possiblement
 * EMPRUNTÉE. Un post à 4× la médiane posé le lendemain d'un post à 200 000 vues
 * doit se lire autrement qu'un post à 4× posé un jour ordinaire — sans quoi on
 * reconduirait un format dont le seul mérite est d'être passé au bon moment.
 *
 * Strictement APRÈS (`delta > 0`) : un post n'ouvre pas sa propre fenêtre, et
 * deux posts au même horodatage ne se portent pas l'un l'autre. Le gros post
 * déclencheur n'est pas tenu d'être dans la fenêtre de la médiane ni d'être
 * mature : c'est un fait de calendrier, pas une mesure de performance.
 */
export function breakoutFlags(
  posts: readonly QuadrantInput[],
  settings: QuadrantSettings = QUADRANT_SETTINGS,
): Set<string> {
  const parCompte = new Map<string, QuadrantInput[]>();
  for (const p of posts) {
    const key = accountKey(p.compte, p.plateforme);
    const bucket = parCompte.get(key);
    if (bucket) bucket.push(p);
    else parCompte.set(key, [p]);
  }

  const flagged = new Set<string>();
  for (const bucket of parCompte.values()) {
    // Tri chronologique puis balayage arrière borné par la fenêtre : linéaire en
    // pratique, là où un double parcours naïf serait quadratique par compte.
    const ordered = [...bucket].sort((a, b) => a.datePubli - b.datePubli);
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      for (let j = i - 1; j >= 0; j--) {
        const q = ordered[j];
        const delta = p.datePubli - q.datePubli;
        if (delta > settings.breakoutWindowMs) break;
        if (delta <= 0) continue;
        if ((q.vues ?? 0) >= settings.breakoutMinViews) {
          flagged.add(p.id);
          break;
        }
      }
    }
  }
  return flagged;
}

/**
 * La case d'un post dont les DEUX scores sont connus.
 *
 * Deux conditions en ET (jamais OU) pour la moitié haute, et elles ne disent
 * pas la même chose :
 *   - le MULTIPLICATEUR répond « ce post est-il sorti par rapport à son
 *     compte ? » — c'est la mesure, relative, sur l'axe X ;
 *   - `minSampleViews` répond « le save rate de ce post veut-il dire quelque
 *     chose ? » — c'est une garde de FIABILITÉ sur l'axe Y (cf. le pourquoi
 *     détaillé dans `convex/quadrantSettings.ts`). Sous ce volume, les deux
 *     verdicts de la moitié haute se liraient sur un ratio bruité, donc on n'y
 *     laisse pas monter le post.
 *
 * Comparaisons LARGES (`>=`) des deux côtés — un post exactement au seuil est
 * au-dessus, comme l'énoncent les réglages.
 */
export function quadrantFor(
  scoreDistribution: number,
  vues: number,
  scoreIntent: number,
  settings: QuadrantSettings = QUADRANT_SETTINGS,
): QuadrantKey {
  const distributionHigh =
    scoreDistribution >= settings.distributionMultiplier &&
    vues >= settings.minSampleViews;
  const intentHigh = scoreIntent >= settings.intentSaveRate;
  if (distributionHigh) return intentHigh ? "scale" : "intent_faible";
  return intentHigh ? "distribution_faible" : "archiver";
}

/* ── Calcul complet ───────────────────────────────────────────────────────── */

/**
 * Classe TOUS les posts fournis. L'appelant passe l'ensemble des posts PUBLIÉS
 * du projet : la médiane d'un compte et la fenêtre de breakout se lisent sur le
 * voisinage du post, jamais sur le sous-ensemble filtré à l'écran. Filtrer
 * ensuite pour l'affichage est sans effet sur les scores — c'est voulu : deux
 * lectures de la même carte avec des filtres différents doivent donner le même
 * verdict pour un post donné.
 *
 * `now` est INJECTÉ (jamais `Date.now()` ici) : le recalcul nocturne l'ancre sur
 * l'instant du run, et les tests peuvent poser une horloge.
 *
 * Ordre des statuts, du plus fort au plus faible — chacun couvre une ignorance
 * différente et le premier qui s'applique gagne :
 *   1. `pending`      — trop jeune, on ne juge pas (même si tout est calculable) ;
 *   2. `not_measured` — jamais relevé ;
 *   3. `no_baseline`  — pas de référence de compte ;
 *   4. `no_intent`    — pas d'axe Y ;
 *   5. `classified`.
 */
export function computeQuadrant(
  posts: readonly QuadrantInput[],
  now: number,
  settings: QuadrantSettings = QUADRANT_SETTINGS,
): QuadrantResult[] {
  const baselines = accountBaselines(posts, now, settings);
  const flagged = breakoutFlags(posts, settings);

  return posts.map((p) => {
    const baseline = baselines.get(accountKey(p.compte, p.plateforme)) ?? {
      views: null,
      sample: 0,
    };
    const vues = p.vues;
    const scoreDistribution =
      vues !== null && baseline.views !== null && baseline.views > 0
        ? vues / baseline.views
        : null;
    const scoreIntent =
      vues !== null && vues > 0 && p.saves !== null ? p.saves / vues : null;

    const base = {
      id: p.id,
      qualification: qualificationOf(p.isWarmup),
      baselineViews: baseline.views,
      baselineSample: baseline.sample,
      scoreDistribution,
      scoreIntent,
      breakoutWindow: flagged.has(p.id),
    };

    if (now - p.datePubli < settings.maturityMs) {
      return { ...base, status: "pending" as const, reason: null, quadrant: null };
    }
    if (vues === null) {
      return {
        ...base,
        status: "not_measured" as const,
        reason: null,
        quadrant: null,
      };
    }
    if (scoreDistribution === null) {
      return {
        ...base,
        status: "no_baseline" as const,
        reason: null,
        quadrant: null,
      };
    }
    if (scoreIntent === null) {
      // Distinguer les trois ignorances : « la plateforme ne le donnera jamais »,
      // « la collecte n'a pas encore couvert ce post » et « 0 vue, pas de taux
      // possible » n'appellent pas la même réponse côté écran.
      const reason: NoIntentReason =
        vues === 0
          ? "no_views"
          : savesAvailability(p.saves, p.plateforme) === "unavailable"
            ? "saves_unavailable"
            : "saves_collecting";
      return { ...base, status: "no_intent" as const, reason, quadrant: null };
    }
    return {
      ...base,
      status: "classified" as const,
      reason: null,
      quadrant: quadrantFor(scoreDistribution, vues, scoreIntent, settings),
    };
  });
}
