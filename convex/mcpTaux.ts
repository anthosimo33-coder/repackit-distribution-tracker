/**
 * OUTIL MCP D'ÉCRITURE — les TAUX DE CHANGE du projet, sous l'interrupteur
 * « Barèmes » (un taux admet un barème dans une autre devise), droit
 * `project.settings` : celui du bouton « Taux de change » de l'écran Barèmes.
 *
 *  - `regler_taux` : pose ou retire le taux d'une devise, par le geste de
 *    l'écran (`setFxRateCore`) et donc sous la même règle
 *    (convex/fxRatesMath). `simuler` montre l'état et le verdict sans écrire.
 *
 * Journalisé avec le projet avant/après ; `defaire` remet le taux d'avant tant
 * qu'il montre encore celui écrit.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { mcpPermissionQuery, mcpWriteMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  ARG_PROJET,
  ECRIT,
  ecrire,
  etatsApres,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  type CibleEcriture,
} from "./mcpWriteCommon";
import { fxRatesView, setFxRateCore } from "./fxRates";
import { applyFxChange, fxRefusalMessage } from "./fxRatesMath";
import { collectedCurrencies, pricingCurrenciesOf } from "./creatorPayCurrency";
import { isCurrencyCode, normalizeCurrency } from "./payCurrency";

export const OUTIL_REGLER_TAUX: McpTool = {
  name: "regler_taux",
  title: "Régler un taux de change du projet",
  description:
    "MODIFIE les taux de change du projet, comme le bouton « Taux de change » de l'écran Barèmes : « 1 <devise> = <taux> <devise cible> ». Ils ne changent JAMAIS ce qu'une créatrice touche (elle est payée dans la devise de son barème, sans conversion) : ils servent à la marge, aux coûts et aux totaux de revenu en plusieurs devises, et permettent un barème dans une autre devise que celle du projet. La devise cible est celle du revenu (la seule encaissée sans taux) ; si le projet n'encaisse rien, sa devise de paie. Appelle d'abord avec « simuler » : la cible, chaque devise avec son taux et son rôle, et ce que le changement donnerait (ou pourquoi il serait refusé). Refusé : un taux sur la devise cible ; retirer le taux d'une devise encaissée, celui de la paie quand le revenu est ailleurs, ou un taux dont un barème dépend — un taux faux se CORRIGE. Aucun email. Journalisé ; `defaire` remet le taux d'avant.",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      devise: { type: "string", description: "Code devise à trois lettres (USD, EUR, RSD…). Facultatif avec « simuler » seul : l'état des taux." },
      taux: {
        type: "number",
        minimum: 0,
        description: "Valeur de 1 unité de « devise » dans la devise cible, strictement positive. Ex. 0.86 pour « 1 USD = 0,86 EUR ».",
      },
      retirer: { type: "boolean", description: "true = retire le taux de « devise » (au lieu de « taux »)." },
      devise_du_revenu: {
        type: "string",
        description: "Seulement si la simulation dit la cible INDÉTERMINÉE : celle des devises candidates qui doit rester sans taux.",
      },
      simuler: { type: "boolean", description: "true = n'écrit rien : l'état des taux, et le verdict sur le changement demandé." },
    },
    additionalProperties: false,
  },
  annotations: ECRIT,
};

const fr = (n: number) => n.toLocaleString("fr-FR", { maximumSignificantDigits: 6 });

const NON_RETIRABLE: Record<string, string> = {
  FX_RATE_NEEDED_BY_REVENUE: "des ventes sont encaissées dans cette devise : corrige-le",
  FX_RATE_NEEDED_BY_MARGIN: "c'est la paie et le revenu est ailleurs, la marge en dépend : corrige-le",
  FX_RATE_NEEDED_BY_PRICING: "des barèmes en dépendent pour être convertis",
};

const changeValidator = {
  devise: v.optional(v.string()),
  taux: v.optional(v.union(v.number(), v.null())),
  cible: v.optional(v.string()),
};

export const simulerTaux = mcpPermissionQuery("project.settings")({
  args: changeValidator,
  handler: async (ctx, { devise, taux, cible }) => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project) throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
    const view = await fxRatesView(ctx, project);
    const T = view.target?.toUpperCase() ?? null;
    const etat = {
      deviseCible: T,
      cible:
        view.source === "revenue"
          ? "la devise du revenu (la seule encaissée sans taux)"
          : view.source === "pay"
            ? "la devise de paie : le projet n'encaisse encore rien"
            : `INDÉTERMINÉE : ${view.candidates.map((c) => c.toUpperCase()).join(", ")} — passe « devise_du_revenu »`,
      deviseDePaie: view.payCurrency?.toUpperCase() ?? null,
      ...(view.targetRate !== null && T
        ? { anomalie: `${T} est la cible mais porte un taux (${fr(view.targetRate)}) : à retirer.` }
        : {}),
      devises: view.rows.map((r) => {
        const C = r.currency.toUpperCase();
        return {
          devise: C,
          taux: r.rate,
          ...(r.rate !== null && T
            ? { lecture: `1 ${C} = ${fr(r.rate)} ${T}`, inverse: `1 ${T} = ${fr(1 / r.rate)} ${C}` }
            : { lecture: "aucun taux : non convertie" }),
          role: [
            r.isPay ? "devise de paie" : null,
            r.pricingCount > 0 ? `${r.pricingCount} barème(s)` : null,
            r.collected ? "ventes encaissées" : null,
            !r.collected && r.inCatalog ? "catalogue Whop" : null,
          ].filter((x) => x !== null),
          ...(r.rate !== null
            ? {
                retirable:
                  r.removable === null
                    ? "inconnu tant que la cible est indéterminée"
                    : r.removable
                      ? "oui"
                      : `non — ${NON_RETIRABLE[r.removalBlockedBy ?? ""] ?? "refusé"}`,
              }
            : {}),
        };
      }),
    };
    if (devise === undefined) return { etat };
    // Le verdict de la règle, sur l'état lu à l'instant.
    const res = applyFxChange(
      project,
      await collectedCurrencies(ctx, project),
      await pricingCurrenciesOf(ctx, project),
      { currency: devise, rate: taux ?? null, ...(cible !== undefined ? { target: cible } : {}) },
    );
    const C = devise.trim().toUpperCase();
    return {
      etat,
      verdict: res.ok
        ? taux == null
          ? `accepté : le taux ${C} serait retiré`
          : `accepté : 1 ${C} = ${fr(taux)} ${T ?? cible?.toUpperCase() ?? "?"}`
        : `REFUSÉ : ${fxRefusalMessage(res.refusal)}`,
    };
  },
});

export const ecrireTaux = mcpWriteMutation("project.settings", "baremes")({
  args: { devise: v.string(), taux: v.union(v.number(), v.null()), cible: v.optional(v.string()) },
  handler: async (ctx, { devise, taux, cible }) => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project) throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
    const photos = await photographier(ctx, "projects", [ctx.projectId]);
    const r = await setFxRateCore(ctx, project, {
      currency: devise,
      rate: taux,
      ...(cible !== undefined ? { target: cible } : {}),
    });
    const C = r.currency.toUpperCase();
    const T = r.cible?.toUpperCase() ?? "?";
    const avant = r.avant === null ? "aucun taux" : `${fr(r.avant)} ${T}`;
    const summary =
      r.apres === null
        ? `Taux ${C} retiré (était ${avant})`
        : r.avant === r.apres
          ? `Taux ${C} inchangé : 1 ${C} = ${fr(r.apres)} ${T}`
          : `Taux ${C} : 1 ${C} = ${fr(r.apres)} ${T} (avant : ${avant})`;
    if (r.avant === r.apres) return { summary };
    await journaliser(ctx, {
      tool: "regler_taux",
      summary,
      section: "pricing",
      path: "pricings",
      annulation: {
        type: "taux",
        devise: r.currency,
        avant: r.avant,
        apres: r.apres,
        ...(r.cibleChoisie && r.cible ? { cible: r.cible } : {}),
      },
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

// ─── L'appel de l'outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE =
  "`defaire` remet le taux d'avant (tant qu'il n'a pas rebougé) ; sinon écran Barèmes › « Taux de change ».";

export async function appelerReglerTaux(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const deviseBrute = texteArg(args, "devise");
  const devise = deviseBrute === "" ? undefined : deviseBrute;
  if (devise !== undefined && !isCurrencyCode(devise)) {
    throw new ToolError(`« devise » : « ${deviseBrute} » n'est pas un code à trois lettres (USD, EUR, RSD…).`);
  }
  const retirer = args.retirer === true;
  if (args.taux !== undefined && (typeof args.taux !== "number" || !Number.isFinite(args.taux) || args.taux <= 0)) {
    throw new ToolError("« taux » : un nombre strictement positif (0.86 pour 1 USD = 0,86 EUR).");
  }
  const taux = typeof args.taux === "number" ? args.taux : undefined;
  if (retirer && taux !== undefined) throw new ToolError("« taux » OU « retirer », pas les deux.");
  const revenu = texteArg(args, "devise_du_revenu");
  const change = {
    ...(devise !== undefined ? { devise: normalizeCurrency(devise)! } : {}),
    ...(retirer ? { taux: null } : taux !== undefined ? { taux } : {}),
    ...(revenu !== "" ? { cible: revenu.toLowerCase() } : {}),
  };

  if (args.simuler === true) {
    if (devise !== undefined && !retirer && taux === undefined) {
      throw new ToolError("Avec « devise », dis ce qui changerait : « taux » ou « retirer ». Sans « devise », la simulation montre l'état.");
    }
    const vue = await ecrire(() =>
      ctx.runQuery(internal.mcpTaux.simulerTaux, { userId: cible.userId, projectId: cible.projectId, ...change }),
    );
    return resultatEcriture(projet, "Simulation : rien n'a été écrit.", "Rien à défaire.", {
      simulation: vue,
      ...(devise !== undefined ? { suite: "Pour écrire : rappelle regler_taux sans « simuler »." } : {}),
    });
  }
  if (devise === undefined) throw new ToolError("« devise » : le code de la devise à régler (ou « simuler » pour l'état).");
  if (!retirer && taux === undefined) throw new ToolError("« taux » (1 devise = taux devise cible) ou « retirer: true ».");
  const r = await ecrire(() =>
    ctx.runMutation(internal.mcpTaux.ecrireTaux, {
      ...cible,
      devise: normalizeCurrency(devise)!,
      taux: retirer ? null : taux!,
      ...(revenu !== "" ? { cible: revenu.toLowerCase() } : {}),
    }),
  );
  return resultatEcriture(projet, r.summary, OU_DEFAIRE);
}
