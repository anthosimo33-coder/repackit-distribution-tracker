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
