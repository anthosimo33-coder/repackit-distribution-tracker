import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ERR, err } from "./errorCodes";
import { fxTargetFrom, type FxCollected, type FxTargetState } from "./fxRatesMath";
import {
  canAdoptPayCurrency,
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
 * DEVISES ENCAISSÉES — celles des derniers paiements Whop, plus la devise
 * retenue au dernier import du grand livre (`comptaReference`).
 *
 * Volontairement SANS passer par convex/compta : ce module est atteint par les
 * écrans (via convex/pricing), et le grand livre n'a rien à y faire.
 */
export async function collectedCurrencies(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<FxCollected> {
  const seen = new Set<string>();
  const state = await ctx.db
    .query("comptaState")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .first();
  for (const p of await ctx.db
    .query("whopPayments")
    .withIndex("by_project_paidAt", (q) => q.eq("projectId", project._id))
    .order("desc")
    .take(500)) {
    const c = normalizeCurrency(p.currency);
    if (c) seen.add(c);
  }
  return {
    seen: [...seen],
    comptaReference: normalizeCurrency(state?.referenceCurrency),
  };
}

/** Cible des taux du projet (cf fxRatesMath.fxTargetFrom). */
export async function fxTargetOf(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<FxTargetState> {
  return fxTargetFrom(await collectedCurrencies(ctx, project), project);
}

/** Devises RÉSOLUES des barèmes du projet, archivés compris (leurs vidéos restent). */
export async function pricingCurrenciesOf(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<string[]> {
  const pricings = await ctx.db
    .query("pricings")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const out = new Set<string>();
  for (const p of pricings) {
    const c = pricingPayCurrency(p, project);
    if (c !== null) out.add(c);
  }
  return [...out].sort();
}

/**
 * DE L'ARGENT EST-IL DÉJÀ ENGAGÉ DANS LA DEVISE DU PROJET ?
 *
 * `projects.payCurrency` est la devise de tout ce qui n'en porte pas en propre
 * (cf convex/payCurrency, règle 2) : barèmes et paiements d'avant, primes de
 * défi et paliers débloqués, versements et CPM des managers, tarif par clip et
 * forfait des talents. Tant que rien de tout ça n'existe, la changer ne
 * réinterprète aucun montant. Rend le premier motif trouvé, `null` si libre.
 *
 * `exceptPricingId` : le barème qu'on modifie, que l'appelant sait inutilisé
 * (pricingCurrencyLocked) — il change de devise AVEC le projet.
 *
 * Les tests les moins chers d'abord : un projet qui a déjà un barème (tous les
 * projets qui tournent) répond au premier, sans balayer ses assignations.
 */
export async function payCurrencyEngagement(
  ctx: QueryCtx,
  project: Doc<"projects">,
  exceptPricingId?: Id<"pricings">,
): Promise<string | null> {
  const projectId = project._id;
  const pricings = await ctx.db
    .query("pricings")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .take(2);
  if (pricings.some((p) => p._id !== exceptPricingId)) return "pricing";
  if (
    await ctx.db
      .query("payments")
      .withIndex("by_project_period", (q) => q.eq("projectId", projectId))
      .first()
  ) {
    return "payment";
  }
  if (
    await ctx.db
      .query("managerPayouts")
      .withIndex("by_project_manager", (q) => q.eq("projectId", projectId))
      .first()
  ) {
    return "managerPayout";
  }
  // Défis, primes et paliers pendent à un barème, mais lui survivent : un
  // barème sans vidéo se supprime même quand une grille ou un défi s'y réfère.
  if (
    await ctx.db
      .query("challenges")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()
  ) {
    return "challenge";
  }
  if (
    await ctx.db
      .query("challengeWins")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()
  ) {
    return "challengeWin";
  }
  if (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()
  ) {
    return "bonusUnlock";
  }
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  if (members.some((m) => (m.managerCpms ?? []).length > 0)) return "managerCpm";
  const creators = await ctx.db
    .query("creators")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  if (
    creators.some(
      (c) => c.clipRate !== undefined || c.monthlyRetainer !== undefined,
    )
  ) {
    return "creatorRate";
  }
  // Un clip commandé garde son tarif même si le clippeur n'en a plus.
  for await (const a of ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))) {
    if (a.clipRateSnapshot !== undefined) return "clip";
  }
  return null;
}

/**
 * Parmi `choices`, les devises qu'un barème ferait ADOPTER au projet (cf
 * admitPricingCurrency). L'écran l'annonce sous le choix de devise : la devise
 * du projet ne change jamais en silence.
 */
export async function adoptablePayCurrencies(
  ctx: QueryCtx,
  project: Doc<"projects">,
  choices: readonly string[],
  exceptPricingId?: Id<"pricings">,
): Promise<string[]> {
  const pay = normalizeCurrency(project.payCurrency);
  const fx = await fxTargetOf(ctx, project);
  const reference = fx.source === "revenue" ? fx.target : null;
  const candidates = choices
    .map((c) => normalizeCurrency(c))
    .filter((c): c is string => c !== null && c !== pay)
    .filter((c) => !isPayCurrencyConvertible(c, project, fx.target))
    .filter((c) => canAdoptPayCurrency(c, project, reference));
  if (candidates.length === 0) return [];
  return (await payCurrencyEngagement(ctx, project, exceptPricingId)) === null
    ? candidates
    : [];
}

/**
 * ADMET la devise d'un barème qu'on écrit :
 *  - le projet sait la convertir → rien ;
 *  - le projet n'a encore rien engagé → elle devient SA devise de paie ;
 *  - sinon → refus. C'est ce contrôle, fait UNE fois à l'écriture, qui permet à
 *    `payCurrencyFactor` de lire une devise sans taux propre comme la devise du
 *    revenu sans jamais se tromper.
 *
 * Le deuxième cas est celui du PREMIER BARÈME d'un projet neuf. Tout projet naît
 * en dollars et sans taux (createProject) : sans lui, un projet dont les
 * créatrices sont payées en euros ne pourrait pas créer de barème du tout, et
 * la devise du projet ne se change qu'en ligne de commande. Tant que rien n'est
 * engagé dans l'ancienne devise (payCurrencyEngagement) et que taux et revenu
 * le permettent (canAdoptPayCurrency), en changer ne réinterprète aucun montant.
 */
export async function admitPricingCurrency(
  ctx: MutationCtx,
  project: Doc<"projects">,
  currency: string,
  exceptPricingId?: Id<"pricings">,
): Promise<void> {
  const c = normalizeCurrency(currency);
  if (c === null) {
    // i18n-exempt: repli FR du code ERR_PRICING_CURRENCY_INVALID, traduit côté client
    throw err(ERR.PRICING_CURRENCY_INVALID, "Devise de barème manquante.", {
      currency: "—",
    });
  }
  if (c === normalizeCurrency(project.payCurrency)) return;
  const fx = await fxTargetOf(ctx, project);
  const reference = fx.source === "revenue" ? fx.target : null;
  if (isPayCurrencyConvertible(c, project, fx.target)) return;
  if (
    canAdoptPayCurrency(c, project, reference) &&
    (await payCurrencyEngagement(ctx, project, exceptPricingId)) === null
  ) {
    await ctx.db.patch(project._id, { payCurrency: c });
    return;
  }
  throw err(
    ERR.PRICING_CURRENCY_INVALID,
    // Repli FR du code, que le client traduit (cf messages/*.json, error.*).
    `Ce projet ne sait pas convertir la devise ${c.toUpperCase()} : règle d'abord son taux (bouton « Taux de change » en haut des barèmes), ` + // i18n-exempt: repli FR du code ERR_PRICING_CURRENCY_INVALID
      "sans quoi le coût d'une créatrice payée dans cette devise ne pourrait pas entrer dans la marge.", // i18n-exempt: repli FR du code ERR_PRICING_CURRENCY_INVALID
    { currency: c.toUpperCase() },
  );
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
