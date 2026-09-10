import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  excludeInternalWhop,
  internalAccountsFor,
  type InternalAccountsConfig,
} from "./internalAccounts";

/**
 * Lecture des paiements Whop d'un projet — POINT DE PASSAGE UNIQUE des sites
 * qui en tirent une métrique (règle A4 : les abonnements internes sont exclus
 * de TOUTES les métriques).
 *
 * Pourquoi ce module : le filtre A4 était réécrit à la main sur chaque site de
 * lecture, et deux des cinq l'avaient oublié — `getWhopRevenue`
 * (convex/whopSync) et `getProjectProfitability` (convex/profitability), les
 * deux cartes de l'écran Paiements. Résultat observé en prod : l'écran
 * Paiements affichait 7,32 € de revenu de plus que le hub Analytics pour
 * exactement le même périmètre, l'un filtrant et l'autre non.
 *
 * `all` reste exposé pour les usages qui doivent VOIR les internes : fraîcheur
 * de la synchro (le cron ingère aussi les internes) et inventaire des devises
 * PRÉSENTES (une devise qui n'apparaît que sur un compte interne reste une
 * devise présente en base).
 *
 * NE COUVRE PAS l'ingestion (`upsertWhopPayments`) : on ingère tout, on exclut
 * au READ. Filtrer à l'écriture perdrait la donnée, rendrait l'exclusion
 * invérifiable et non rétroactive, et casserait l'idempotence de l'upsert.
 */
export interface ProjectWhopPayments {
  /** Paiements du projet, abonnements internes RETIRÉS. Base de toute métrique. */
  payments: Doc<"whopPayments">[];
  /** Paiements du projet SANS filtre — fraîcheur de synchro, devises présentes. */
  all: Doc<"whopPayments">[];
  /** MembershipIds internes réellement rencontrés (pour l'afficher). */
  internalMemberIds: Set<string>;
  /** Config A4 du projet, à réutiliser sur whopMemberships. */
  cfg: InternalAccountsConfig;
}

export async function collectProjectWhopPayments(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  projectSlug: string,
): Promise<ProjectWhopPayments> {
  const all = await ctx.db
    .query("whopPayments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const cfg = internalAccountsFor(projectSlug);
  const { kept, internalMemberIds } = excludeInternalWhop(all, cfg);
  return { payments: kept, all, internalMemberIds, cfg };
}
