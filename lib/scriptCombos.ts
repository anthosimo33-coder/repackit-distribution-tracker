/**
 * S2 — génération + sélection des combos d'une campagne (pur, testé Vitest).
 * Aucune dépendance Convex/React. Le combo = 1 hook + 1 flux + 1 cta (bricks
 * ACTIVES uniquement). assembledScript figé via assembleScript (labels OFF : le
 * créateur lit un script naturel). RIEN n'est matérialisé en base — c'est
 * calculé à la volée pour l'assignation.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. La logique est RÉPLIQUÉE
 * côté serveur (convex/scripts.ts) pour l'anti-coordination ; toute évolution
 * ici doit l'être là-bas. Les tests vivent ici.
 *
 * Refonte 3 briques : le kind "corps" et le socle démo ont disparu du montage.
 * `comboKey` est désormais "hook:flux:cta" (3 segments). Les combos figés
 * historiques gardent leur clé 4 segments — espaces de clés DISJOINTS, donc
 * aucune collision sur l'index anti-coordination by_creator_combo.
 */
import { assembleScript, type ScriptKind, type ScriptTier } from "./scriptAssembly";

/**
 * La DURÉE du cooldown ne vit plus ici : c'est un réglage PAR PROJET
 * (`projects.comboCooldownDays`), lu par `comboCooldownDaysOf`. Les fonctions de
 * ce module la reçoivent en PARAMÈTRE OBLIGATOIRE — jamais par défaut.
 *
 * ⚠️ Le caractère obligatoire est le point. Un paramètre à valeur par défaut
 * laisserait un appelant oublié compiler en silence avec le mauvais nombre de
 * jours, et personne ne le verrait avant de constater des doublons en ligne.
 * Ici, un site d'appel oublié casse le typecheck. Même contrat que
 * `lib/warmup.defaultTargetDays(plateforme, days)`.
 */
const DAY_MS = 86_400_000;

/** Usage d'un combo déjà en base, réduit à ce dont le cooldown a besoin. */
export interface ScheduledComboUsage {
  comboKey: string | null | undefined;
  /**
   * Date d'ancrage = date de publication PRÉVUE (`postDate`), à défaut la date
   * RÉELLE de sortie (`targets[].publishedAt`). `null` = aucune des deux → la
   * ligne n'occupe aucune fenêtre (elle reste couverte par l'exclusion à vie).
   */
  anchorAt: number | null | undefined;
}

/**
 * comboKeys INDISPONIBLES pour une date visée, à l'échelle du projet.
 *
 * Borne STRICTE : un écart de EXACTEMENT `cooldownDays` jours est AUTORISÉ.
 * Avec 1 jour (le défaut) — le jour même refusé, la veille et le lendemain
 * acceptés. Symétrique (valeur absolue) : on protège aussi bien vers le passé
 * que vers le futur, sinon programmer à rebours contournerait la règle.
 *
 * `cooldownDays = 0` désactive le cooldown (aucun écart n'est jamais strictement
 * inférieur à 0) — l'unicité à vie, elle, continue de s'appliquer.
 *
 * ⚠️ Les combos IMPOSÉS occupent la fenêtre comme les autres, alors qu'ils sont
 * ignorés de l'unicité à vie. Ce n'est pas une incohérence : un combo imposé est
 * une publication RÉELLE, elle sort le même jour que les autres. « Hors règles »
 * signifie qu'un imposé n'est jamais REFUSÉ, pas qu'il devient invisible aux
 * autres.
 *
 * `targetAt` nul (assignation sans date planifiée) → aucun cooldown : sans date
 * visée, il n'y a pas de fenêtre à calculer.
 */
export function comboKeysInCooldown(
  usages: ScheduledComboUsage[],
  targetAt: number | null | undefined,
  cooldownDays: number,
): Set<string> {
  const out = new Set<string>();
  if (targetAt === null || targetAt === undefined) return out;
  const window = cooldownDays * DAY_MS;
  for (const u of usages) {
    if (!u.comboKey) continue;
    if (u.anchorAt === null || u.anchorAt === undefined) continue;
    if (Math.abs(u.anchorAt - targetAt) < window) out.add(u.comboKey);
  }
  return out;
}

/**
 * Décale un planning de `days` JOURS CALENDAIRES.
 *
 * En masse, chaque créateur reçoit le planning saisi décalé de son rang : le 1er
 * garde les dates telles quelles, le 2e +1 jour, etc. Sans ce décalage, tous les
 * créateurs d'un lot visent la même date et se disputent la même fenêtre de
 * cooldown — le pool se vide pour rien alors que les scripts pourraient
 * simplement s'étaler.
 *
 * ⚠️ Arithmétique CALENDAIRE (`setDate`), pas `+ n × 86 400 000`. Les dates de
 * post sont posées à minuit heure locale ; ajouter 24 h fixes à travers un
 * changement d'heure les ferait atterrir à 23 h ou 01 h, donc potentiellement le
 * mauvais JOUR. `setDate` suit le calendrier du fuseau du runtime.
 */
export function shiftPostDatesByDays(dates: number[], days: number): number[] {
  if (days === 0) return [...dates];
  return dates.map((ts) => {
    const d = new Date(ts);
    d.setDate(d.getDate() + days);
    return d.getTime();
  });
}

/**
 * Première date ≥ `targetAt` à laquelle AU MOINS UN combo se libère, ou `null`
 * si aucun usage ne bloque (donc rien à attendre). Sert au message d'erreur du
 * pool épuisé : sortir une date concrète plutôt qu'un « réessayez plus tard ».
 *
 * Un combo bloqué par un usage ancré à `A` redevient libre à `A + fenêtre`. La
 * première libération utile est donc le plus PETIT de ces instants parmi les
 * seuls combos qui bloquent réellement à `targetAt`.
 */
export function firstFreeSlotAfter(
  usages: ScheduledComboUsage[],
  targetAt: number,
  cooldownDays: number,
): number | null {
  const window = cooldownDays * DAY_MS;
  let best: number | null = null;
  for (const u of usages) {
    if (!u.comboKey) continue;
    if (u.anchorAt === null || u.anchorAt === undefined) continue;
    if (Math.abs(u.anchorAt - targetAt) >= window) continue;
    const freeAt = u.anchorAt + window;
    if (best === null || freeAt < best) best = freeAt;
  }
  return best;
}

export interface ComboBrick {
  _id: string;
  kind: ScriptKind;
  content: string;
  active: boolean;
  tier?: ScriptTier | null;
}

export interface Combo {
  hookBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
  assembledScript: string;
}

/** Signature stable d'un combo (hook:flux:cta) pour l'anti-coordination. */
export function comboKeyOf(c: {
  hookBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
}): string {
  return `${c.hookBrickId}:${c.fluxBrickId}:${c.ctaBrickId}`;
}

/**
 * Décompose un comboKey en ses 3 brickIds (pour « Rejouer ce script » depuis
 * l'analytics, où seul le comboKey est en main). Gère les DEUX espaces de clés :
 * 3 segments "hook:flux:cta" (refonte) et 4 segments legacy "hook:corps:flux:cta"
 * (le corps est ignoré — retiré du montage). Toute autre forme → null (non
 * rejouable). Lecture CLIENT — aucune réplique serveur (le serveur ne reparse
 * jamais un comboKey ; il reçoit les 3 brickIds directement).
 */
export function parseComboKey(comboKey: string): {
  hookBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
} | null {
  const parts = comboKey.split(":");
  if (parts.length === 3) {
    return { hookBrickId: parts[0], fluxBrickId: parts[1], ctaBrickId: parts[2] };
  }
  if (parts.length === 4) {
    // Legacy "hook:corps:flux:cta" → on saute le corps (parts[1]).
    return { hookBrickId: parts[0], fluxBrickId: parts[2], ctaBrickId: parts[3] };
  }
  return null;
}

/**
 * Produit cartésien des bricks ACTIVES (hooks × flux × cta). Chaque combo porte
 * son assembledScript (labels OFF). 0 combo si un kind n'a aucune brick active.
 * Ordre déterministe (ordre des bricks fournis).
 */
export function generateCombos(bricks: ComboBrick[]): Combo[] {
  const of = (k: ScriptKind) => bricks.filter((b) => b.active && b.kind === k);
  const hooks = of("hook");
  const flux = of("flux");
  const cta = of("cta");

  const out: Combo[] = [];
  for (const h of hooks) {
    for (const f of flux) {
      for (const t of cta) {
        out.push({
          hookBrickId: h._id,
          fluxBrickId: f._id,
          ctaBrickId: t._id,
          assembledScript: assembleScript(
            { hook: h.content, flux: f.content, cta: t.content },
            { labels: false },
          ),
        });
      }
    }
  }
  return out;
}

/**
 * Choisit jusqu'à `n` combos pour un créateur en ÉQUILIBRANT les 3 dimensions
 * (hook, flux, cta) — sélection gloutonne « least-used ». Exclut les combos déjà
 * reçus (`usedKeys`). Renvoie MOINS de `n` si le stock disponible est épuisé
 * (l'appelant signale l'épuisement). Pas de doublon silencieux.
 *
 * Score d'un combo = somme des usages de ses 3 bricks (hook + flux + cta) sur les
 * combos DÉJÀ retenus. À chaque pas on prend le combo disponible de score MINIMAL
 * → un flux/cta déjà utilisé renchérit ses combos, donc le choix bascule vers les
 * bricks les moins servies. Avec le produit cartésien plein et plus de hooks que
 * de picks, un hook neuf (usage 0) gagne toujours → la diversité de hook reste
 * maximale, et flux/cta s'équilibrent DANS ce cadre (≠ ancien round-robin où flux
 * & cta restaient figés tant que N < hooks·cta).
 *
 * Tie-break STABLE : à score égal, le PREMIER en ordre de génération l'emporte
 * (`< bestScore` strict + parcours ascendant) → sélection déterministe et
 * reproductible, sans aléatoire.
 *
 * Continuité de l'équilibre : les compteurs sont AMORCÉS depuis `usedKeys` (les
 * combos déjà pris par le créateur+plateforme). Une clé est « hook:flux:cta » →
 * on incrémente les 3 compteurs (clé legacy 4 segments ignorée, espace disjoint).
 * Ainsi un flux sur-servi lors d'une assignation précédente reste évité ensuite —
 * pas de remise à zéro qui re-piocherait le même flux.
 */
export function pickCombosForCreator(
  allCombos: Combo[],
  usedKeys: Set<string>,
  n: number,
): Combo[] {
  if (n <= 0) return [];
  const available = allCombos.filter((c) => !usedKeys.has(comboKeyOf(c)));

  // Compteurs d'usage par brick, amorcés depuis les combos déjà pris (usedKeys).
  const hookUse = new Map<string, number>();
  const fluxUse = new Map<string, number>();
  const ctaUse = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const key of usedKeys) {
    const parts = key.split(":");
    if (parts.length !== 3) continue; // clé legacy 4 segments → ignorée
    bump(hookUse, parts[0]);
    bump(fluxUse, parts[1]);
    bump(ctaUse, parts[2]);
  }

  const picked: Combo[] = [];
  const taken = new Array<boolean>(available.length).fill(false);
  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < available.length; i++) {
      if (taken[i]) continue;
      const c = available[i];
      const score =
        (hookUse.get(c.hookBrickId) ?? 0) +
        (fluxUse.get(c.fluxBrickId) ?? 0) +
        (ctaUse.get(c.ctaBrickId) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break; // stock épuisé
    taken[bestIdx] = true;
    const c = available[bestIdx];
    picked.push(c);
    bump(hookUse, c.hookBrickId);
    bump(fluxUse, c.fluxBrickId);
    bump(ctaUse, c.ctaBrickId);
  }
  return picked;
}
