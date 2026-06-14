/**
 * S2 — génération + sélection des combos d'une campagne (pur, testé Vitest).
 * Aucune dépendance Convex/React. Le combo = 1 hook + 1 corps + 1 flux + 1 cta
 * (bricks ACTIVES uniquement). assembledScript figé via assembleScript (labels
 * OFF : le créateur lit un script naturel). RIEN n'est matérialisé en base —
 * c'est calculé à la volée pour l'assignation.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. La logique est RÉPLIQUÉE
 * côté serveur (convex/scripts.ts) pour l'anti-coordination ; toute évolution
 * ici doit l'être là-bas. Les tests vivent ici.
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
  corpsBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
  assembledScript: string;
}

/** Signature stable d'un combo (hook:corps:flux:cta) pour l'anti-coordination. */
export function comboKeyOf(c: {
  hookBrickId: string;
  corpsBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
}): string {
  return `${c.hookBrickId}:${c.corpsBrickId}:${c.fluxBrickId}:${c.ctaBrickId}`;
}

/**
 * Produit cartésien des bricks ACTIVES (hooks × corps × flux × cta). Chaque
 * combo porte son assembledScript (labels OFF). 0 combo si un kind n'a aucune
 * brick active. Ordre déterministe (ordre des bricks fournis).
 */
export function generateCombos(
  bricks: ComboBrick[],
  demoBlock: string,
): Combo[] {
  const of = (k: ScriptKind) => bricks.filter((b) => b.active && b.kind === k);
  const hooks = of("hook");
  const corps = of("corps");
  const flux = of("flux");
  const cta = of("cta");

  const out: Combo[] = [];
  for (const h of hooks) {
    for (const c of corps) {
      for (const f of flux) {
        for (const t of cta) {
          out.push({
            hookBrickId: h._id,
            corpsBrickId: c._id,
            fluxBrickId: f._id,
            ctaBrickId: t._id,
            assembledScript: assembleScript(
              {
                hook: h.content,
                corps: c.content,
                flux: f.content,
                cta: t.content,
                demoBlock,
              },
              { labels: false },
            ),
          });
        }
      }
    }
  }
  return out;
}

/**
 * Choisit jusqu'à `n` combos pour un créateur : exclut ceux déjà reçus
 * (`usedKeys`) et MAXIMISE la diversité de hook (round-robin par hook → on ne
 * donne pas 10× le même hook si d'autres sont dispo). Renvoie MOINS de `n` si
 * le stock disponible est épuisé (l'appelant signale l'épuisement).
 */
export function pickCombosForCreator(
  allCombos: Combo[],
  usedKeys: Set<string>,
  n: number,
): Combo[] {
  if (n <= 0) return [];
  const available = allCombos.filter((c) => !usedKeys.has(comboKeyOf(c)));

  // Buckets par hook, dans l'ordre d'apparition (déterministe).
  const buckets = new Map<string, Combo[]>();
  for (const c of available) {
    const b = buckets.get(c.hookBrickId);
    if (b) b.push(c);
    else buckets.set(c.hookBrickId, [c]);
  }
  const order = [...buckets.values()];

  // Round-robin : 1 combo de chaque hook à tour de rôle → diversité de hook
  // maximale. À l'intérieur d'un hook, l'ordre varie corps/flux/cta.
  const picked: Combo[] = [];
  let progressed = true;
  while (picked.length < n && progressed) {
    progressed = false;
    for (const bucket of order) {
      if (picked.length >= n) break;
      const next = bucket.shift();
      if (next) {
        picked.push(next);
        progressed = true;
      }
    }
  }
  return picked;
}
