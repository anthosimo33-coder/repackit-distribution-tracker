/**
 * RADAR — SUIVI D'OFFICE : ce qu'on fait d'une app repérée. Règle pure (les écritures : convex/radarAuto).
 */
import { marketPatterns } from "./radarMarketMath";
import { storeAutoFollow, tagCore, type CreatorWhy } from "./radarStoreMath";

export type AutoPlan = { patterns: string[] } | { skip: string };

type Candidate = {
  kind: "mention" | "domain" | "store" | "market";
  label: string;
  store?: { tag: string; creators: readonly { handle: string; why: CreatorWhy }[] };
  market?: { handle: string };
};

/**
 * Les motifs pour suivre l'app d'office, ou pourquoi elle reste proposée :
 *  - une app des classements entre quand ses comptes créateurs la prouvent assez (radarStoreMath.storeAutoFollow) ;
 *  - un produit d'une place de marché entre dès qu'on sait le nommer : sa campagne paie des créateurs ;
 *  - un compte mentionné ou un site cité par des comptes ne sont jamais suivis d'office.
 */
export function autoPlan(c: Candidate): AutoPlan {
  if (c.kind === "store" && c.store) {
    return storeAutoFollow(c.store.tag, c.store.creators) ? { patterns: [tagCore(c.store.tag)] } : { skip: "preuve insuffisante" };
  }
  if (c.kind === "market" && c.market) {
    const patterns = marketPatterns(c.label, c.market.handle);
    return patterns.length ? { patterns } : { skip: "nom trop court" };
  }
  return { skip: "pas une source suivie d'office" };
}
