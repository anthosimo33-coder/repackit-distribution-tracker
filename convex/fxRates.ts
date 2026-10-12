import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { permissionMutation, permissionQuery } from "./functions";
import { ERR, err } from "./errorCodes";
import { normalizeCurrency } from "./payCurrency";
import {
  collectedCurrencies,
  pricingCurrenciesOf,
  pricingPayCurrency,
} from "./creatorPayCurrency";
import {
  applyFxChange,
  fxRateOf,
  fxRefusalMessage,
  fxTargetFrom,
} from "./fxRatesMath";

/**
 * ÉCRAN DES TAUX DE CHANGE — lecture et écriture (bloc « Réglages du projet »).
 *
 * La règle vit dans convex/fxRatesMath (pure, testée) : ce module ne fait que
 * lire ce qu'elle demande en base, et écrire le patch qu'elle rend.
 */

/**
 * L'ÉTAT DES TAUX d'un projet — ce que montrent l'écran et l'outil MCP
 * `regler_taux` : la cible, et une ligne par devise du projet.
 */
export async function fxRatesView(ctx: QueryCtx, project: Doc<"projects">) {
  const collected = await collectedCurrencies(ctx, project);
  const state = fxTargetFrom(collected, project);
  const pay = normalizeCurrency(project.payCurrency);

  const pricings = await ctx.db
    .query("pricings")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const pricingCount = new Map<string, number>();
  for (const p of pricings) {
    const c = pricingPayCurrency(p, project);
    if (c !== null) pricingCount.set(c, (pricingCount.get(c) ?? 0) + 1);
  }
  const pricingCurrencies = [...pricingCount.keys()];

  // Le catalogue Whop peut vendre dans une devise avant la première vente :
  // son taux se règle d'avance.
  const catalog = new Set<string>();
  for (const plan of await ctx.db
    .query("whopPlans")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect()) {
    const c = normalizeCurrency(plan.currency);
    if (c) catalog.add(c);
  }

  const currencies = new Set<string>([
    ...(pay ? [pay] : []),
    ...pricingCurrencies,
    ...state.collected,
    ...catalog,
    ...(project.fxRatesToRevenue ?? [])
      .map((r) => normalizeCurrency(r.currency))
      .filter((c): c is string => c !== null),
  ]);

  const rows = [...currencies]
    .filter((c) => c !== state.target)
    .sort((a, b) => (a === pay ? -1 : b === pay ? 1 : a.localeCompare(b)))
    .map((c) => {
      const rate = fxRateOf(project, c);
      // Ce que le serveur refuserait au clic « Retirer » — connu seulement
      // quand la cible l'est (sinon c'est l'écran qui la fait choisir).
      const removal =
        rate === null || state.target === null
          ? null
          : applyFxChange(project, collected, pricingCurrencies, {
              currency: c,
              rate: null,
            });
      return {
        currency: c,
        rate,
        isPay: c === pay,
        pricingCount: pricingCount.get(c) ?? 0,
        collected: state.collected.includes(c),
        inCatalog: catalog.has(c),
        removable: removal === null ? null : removal.ok,
        removalBlockedBy:
          removal !== null && !removal.ok ? removal.refusal.code : null,
      };
    });

  return {
    payCurrency: pay,
    target: state.target,
    source: state.source,
    candidates: state.candidates,
    // Un taux posé à tort sur la cible (état réparable) : l'écran le montre.
    targetRate: state.target === null ? null : fxRateOf(project, state.target),
    rows,
  };
}

export const getFxRates = permissionQuery("project.settings")({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.get(ctx.projectId);
    return project ? fxRatesView(ctx, project) : null;
  },
});

export const setFxRate = permissionMutation("project.settings")({
  args: {
    currency: v.string(),
    /** `null` retire le taux. */
    rate: v.union(v.number(), v.null()),
    /** Cible choisie à l'écran, lue seulement si celle du projet est indéterminée. */
    target: v.optional(v.string()),
  },
  handler: async (ctx, { currency, rate, target }) => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project) throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
    await setFxRateCore(ctx, project, { currency, rate, target });
    return { ok: true };
  },
});

/**
 * LE GESTE « poser / retirer un taux » — celui de l'écran, et de l'outil MCP
 * `regler_taux` (et de son `defaire`). Refuse ce que refuse la règle
 * (fxRatesMath.applyFxChange) ; rend le taux d'avant et d'après, et la cible
 * retenue (choisie par l'appelant quand celle du projet est indéterminée).
 */
export async function setFxRateCore(
  ctx: MutationCtx,
  project: Doc<"projects">,
  change: { currency: string; rate: number | null; target?: string },
): Promise<{
  currency: string;
  avant: number | null;
  apres: number | null;
  cible: string | null;
  /** La cible du projet était indéterminée : c'est l'appelant qui l'a choisie. */
  cibleChoisie: boolean;
}> {
  const collected = await collectedCurrencies(ctx, project);
  const res = applyFxChange(project, collected, await pricingCurrenciesOf(ctx, project), change);
  if (!res.ok) {
    throw err(ERR[res.refusal.code], fxRefusalMessage(res.refusal), res.refusal.params);
  }
  const currency = normalizeCurrency(change.currency)!;
  const avant = fxRateOf(project, currency);
  await ctx.db.patch(project._id, res.patch);
  const target = fxTargetFrom(collected, project).target;
  return {
    currency,
    avant,
    apres: change.rate,
    cible: target ?? normalizeCurrency(change.target),
    cibleChoisie: target === null,
  };
}
