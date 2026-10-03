import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { referenceCurrency } from "./comptaMath";
import { ERR, err } from "./errorCodes";
import { projectFx } from "./whopRevenue";
import {
  isPayCurrencyConvertible,
  normalizeCurrency,
  resolvePayCurrency,
} from "./payCurrency";

/**
 * UNE DEVISE PAR CRÉATRICE — les gardes qui la tiennent (cf convex/payCurrency
 * pour la doctrine).
 *
 * Le moteur de paie additionne tout ce qu'une créatrice gagne sur un cycle : le
 * fixe et le CPM de chaque barème, les paliers, les primes de défi, le bonus par
 * vidéo. Il ne convertit rien, et c'est voulu — un dû se paie dans sa devise.
 * Il faut donc que tout ce qui entre dans un cycle soit dans la MÊME monnaie, et
 * c'est ici qu'on l'impose, au moment où l'argent est engagé : l'attribution d'un
 * barème à une vidéo, et le choix de sa grille de paliers.
 *
 * Si une donnée y échappait quand même (écrite hors de ces chemins), le
 * breakdown la signale (`mixedCurrency`) et le paiement la refuse plutôt que
 * d'additionner des euros et des dollars.
 */

/** Devise de paie EFFECTIVE d'une créatrice (la sienne, sinon celle du projet). */
export function creatorPayCurrency(
  creator: Pick<Doc<"creators">, "payCurrency">,
  project: Pick<Doc<"projects">, "payCurrency"> | null | undefined,
): string | null {
  return resolvePayCurrency(creator.payCurrency, project?.payCurrency);
}

/** Devise EFFECTIVE d'un barème (la sienne, sinon celle du projet). */
export function pricingPayCurrency(
  pricing: Pick<Doc<"pricings">, "currency">,
  project: Pick<Doc<"projects">, "payCurrency"> | null | undefined,
): string | null {
  return resolvePayCurrency(pricing.currency, project?.payCurrency);
}

/**
 * DEVISE DE RÉFÉRENCE DU REVENU — la seule devise encaissée sans taux (même
 * règle que la compta, cf comptaMath.referenceCurrency). Lue sur les derniers
 * paiements Whop et la devise retenue au dernier import du grand livre. `null`
 * si elle est indéterminée (pas de Whop, ou deux devises sans taux).
 *
 * Volontairement SANS passer par convex/compta : ce module est atteint par les
 * écrans (via convex/pricing), et le grand livre n'a rien à y faire.
 */
async function revenueReferenceCurrency(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<string | null> {
  const seen = new Set<string>();
  const state = await ctx.db
    .query("comptaState")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .first();
  if (state?.referenceCurrency) seen.add(state.referenceCurrency);
  for (const p of await ctx.db
    .query("whopPayments")
    .withIndex("by_project_paidAt", (q) => q.eq("projectId", project._id))
    .order("desc")
    .take(500)) {
    if (p.currency) seen.add(p.currency.toLowerCase());
  }
  return referenceCurrency(seen, projectFx(project)) ?? state?.referenceCurrency ?? null;
}

/**
 * Refuse une devise de barème que les écrans d'analyse ne sauraient pas
 * convertir. C'est ce contrôle, fait UNE fois à l'écriture, qui permet à
 * `payCurrencyFactor` de lire une devise sans taux propre comme la devise du
 * revenu sans jamais se tromper.
 */
export async function assertPayCurrencyConvertible(
  ctx: QueryCtx,
  project: Doc<"projects">,
  currency: string,
): Promise<void> {
  const c = normalizeCurrency(currency);
  if (c === null) {
    // i18n-exempt: repli FR du code ERR_PRICING_CURRENCY_INVALID, traduit côté client
    throw err(ERR.PRICING_CURRENCY_INVALID, "Devise de barème manquante.", {
      currency: "—",
    });
  }
  if (c === normalizeCurrency(project.payCurrency)) return;
  const reference = await revenueReferenceCurrency(ctx, project);
  if (!isPayCurrencyConvertible(c, project, reference)) {
    throw err(
      ERR.PRICING_CURRENCY_INVALID,
      // Repli FR du code, que le client traduit (cf messages/*.json, error.*).
      `Ce projet ne sait pas convertir la devise ${c.toUpperCase()} : sans taux de change réglé, ` + // i18n-exempt: repli FR du code ERR_PRICING_CURRENCY_INVALID
        "le coût d'une créatrice payée dans cette devise ne pourrait pas entrer dans la marge.", // i18n-exempt: repli FR du code ERR_PRICING_CURRENCY_INVALID
      { currency: c.toUpperCase() },
    );
  }
}

/**
 * Fiche VIERGE — rien n'est encore tarifé pour elle : aucune vidéo avec un
 * barème ou un tarif figé, aucun palier débloqué, aucune prime de défi, aucun
 * paiement porteur d'argent. C'est le seul état où sa devise peut encore se
 * choisir sans re-tarifer quoi que ce soit.
 */
export async function isCreatorPayVirgin(
  ctx: QueryCtx,
  creator: Doc<"creators">,
): Promise<boolean> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  if (
    assignments.some(
      (a) =>
        a.projectId === creator.projectId &&
        (a.pricingSnapshot !== undefined || a.clipRateSnapshot !== undefined),
    )
  ) {
    return false;
  }
  const unlock = await ctx.db
    .query("bonusUnlocks")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .first();
  if (unlock) return false;
  const win = await ctx.db
    .query("challengeWins")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .first();
  if (win) return false;
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  return !payments.some(
    (p) =>
      p.status === "paid" ||
      p.lineItems.length > 0 ||
      (p.advances ?? []).length > 0,
  );
}

/**
 * GARANTIT que la créatrice est payée dans `currency` avant qu'on lui engage de
 * l'argent dans cette devise :
 *  - c'est déjà sa devise → rien ;
 *  - sa fiche est vierge → sa devise devient celle-là (premier barème) ;
 *  - sinon → refus, avec les deux devises nommées. La changer suppose de
 *    re-tarifer ses vidéos non payées : c'est une migration, pas un clic.
 */
export async function ensureCreatorPayCurrency(
  ctx: MutationCtx,
  creator: Doc<"creators">,
  project: Doc<"projects">,
  currency: string | null,
): Promise<void> {
  const wanted = normalizeCurrency(currency);
  const current = creatorPayCurrency(creator, project);
  if (wanted === null || wanted === current) return;
  if (await isCreatorPayVirgin(ctx, creator)) {
    await ctx.db.patch(creator._id, { payCurrency: wanted });
    return;
  }
  const from = (current ?? "—").toUpperCase();
  const to = wanted.toUpperCase();
  throw err(
    ERR.CREATOR_PAY_CURRENCY_MISMATCH,
    // Repli FR du code, que le client traduit (cf messages/*.json, error.*).
    `${creator.name} est payée en ${from} : un barème en ${to} ne peut pas lui être attribué. ` + // i18n-exempt: repli FR du code ERR_CREATOR_PAY_CURRENCY_MISMATCH
      `Choisis un barème en ${from}.`, // i18n-exempt: repli FR du code ERR_CREATOR_PAY_CURRENCY_MISMATCH
    { name: creator.name, creatorCurrency: from, pricingCurrency: to },
  );
}
