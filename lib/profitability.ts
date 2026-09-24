/**
 * Rentabilité — point d'accès CLIENT. La DÉFINITION vit dans
 * convex/profitabilityMath.ts (module pur partagé avec l'outil MCP `rentabilite`),
 * ce fichier ne fait que ré-exporter. Tests : lib/profitability.test.ts.
 */
export {
  computeMargin,
  computeRpm,
  computeProfitability,
  profitabilityReport,
  viewsForToggle,
  type ProfitabilityInput,
  type ProfitabilityMetrics,
  type ProfitabilityReport,
  type ProfitabilitySource,
  type ViewsSplit,
} from "../convex/profitabilityMath";
