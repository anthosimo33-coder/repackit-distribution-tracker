/**
 * RÉPLIQUE serveur de lib/script-tier.ts (règle A6 : convex/ ne peut pas
 * importer lib/). Tiers de hook : "S" → « Argent », tout le reste (A, "B"
 * legacy, absent) → « Autre ». Valeurs internes S/A conservées en base ; seul
 * le LIBELLÉ change. Toute évolution doit être reportée dans lib/script-tier.ts.
 */

/** Libellé visible d'un tier. Tout sauf "S" → « Autre ». */
export function tierLabel(tier: string | null | undefined): string {
  return tier === "S" ? "Argent" : "Autre";
}

/** Ramène une valeur stockée (éventuellement legacy "B") sur un tier S|A. */
export function normalizeTier(tier: string | null | undefined): "S" | "A" {
  return tier === "S" ? "S" : "A";
}
