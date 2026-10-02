/**
 * OUTILS MCP D'ÉCRITURE — la Compta (socle commun : convex/mcpWriteCommon).
 *
 * Une connexion (clé ou application OAuth) ne les voit que si la personne l'a
 * autorisée à « modifier la Compta » DANS L'APP (`writeScopes`). Chaque appel
 * passe par `mcpWriteMutation` : l'autorisation de la connexion est RELUE dans la
 * transaction, puis le droit de la personne — le même que pour le bouton de
 * l'écran — et le corps appelle le CŒUR de la mutation de l'écran (mêmes règles,
 * mêmes refus). Toute écriture réussie est notée au journal (`mcpWriteLog`),
 * que l'écran « Connecter Claude » montre avec l'endroit où la défaire.
 *
 * Claude ne voit pas d'identifiant interne : un virement se désigne par son jour
 * et son montant, une charge par son jour et son libellé, un compte par son nom.
 * Les usages, catégories et colonnes s'écrivent comme à l'écran (« paiement
 * créatrices », « publicité », « frais Whop ») ou par leur code.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { mcpWriteMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  AJOUTE,
  ARG_PROJET,
  ecrire,
  ECRIT,
  EFFACE,
  journaliser,
  resultatEcriture,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import {
  addComptaChargeCore,
  comptaReferenceCurrency,
  deleteComptaChargeCore,
  recordProvisionUseCore,
  saveAccountReadingCore,
  setLineRuleCore,
  ventilateTransferCore,
} from "./compta";
import { isFailedWithdrawal, parisDayKey, round2, type ComptaBucket } from "./comptaMath";
import {
  categorieDepuis,
  colonneDepuis,
  jourDepuis,
  LIBELLE_COLONNE,
  montantDepuis,
  jourTexte,
  montantTexte,
  plierTexte,
  usageDepuis,
} from "./mcpWriteArgs";

// ─── Déclaration des outils ─────────────────────────────────────────────────

const USAGES_TEXTE = "rémunération, paiement créatrices, mise de côté (impôts, URSSAF), charges de l'activité, à récupérer, autre";
const CATEGORIES_TEXTE = "hébergement, outils, abonnements, publicité, scans, autre";

export const OUTILS_ECRITURE_COMPTA: readonly McpTool[] = [
  {
    name: "ventiler_virement",
    title: "Ventiler un virement Whop → banque",
    description: `MODIFIE la Compta : dit à quoi a servi un virement Whop → banque, en une ou plusieurs PARTS (montant, usage, motif). Le virement se désigne par son jour et son montant (et sa destination si deux virements du même montant tombent le même jour). Usages : ${USAGES_TEXTE}. Une part « charges de l'activité » peut être COMPTÉE EN CHARGE sous une catégorie (${CATEGORIES_TEXTE}) : elle entre alors au résultat du mois ; une part « scans » remplace l'estimation des scans du mois. Les parts ne dépassent jamais le virement (le reste reste « sans motif »). Remplace la ventilation existante ; une liste vide l'efface.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        jour: { type: "string", description: "Jour du virement, AAAA-MM-JJ (Paris)." },
        montant: { type: "number", description: "Montant du virement, dans sa devise (ex. 1806)." },
        vers: { type: "string", description: "Destination Whop du virement (ex. « Antho Banque »), si le jour et le montant ne suffisent pas." },
        parts: {
          type: "array",
          description: "Les parts. Vide = effacer la ventilation.",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              montant: { type: "number", description: "Montant de la part, devise du virement." },
              usage: { type: "string", description: `Usage : ${USAGES_TEXTE}.` },
              motif: { type: "string", description: "À quoi a servi l'argent. Obligatoire pour une part comptée en charge." },
              compter_en_charge: {
                type: "string",
                description: `Seulement pour « charges de l'activité » : la catégorie sous laquelle la compter (${CATEGORIES_TEXTE}). Absent = non comptée.`,
              },
            },
            required: ["montant", "usage"],
            additionalProperties: false,
          },
        },
      },
      required: ["jour", "montant", "parts"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "relever_solde",
    title: "Relever le solde d'un compte",
    description:
      "MODIFIE la Compta (Trésorerie) : note le solde d'un compte bancaire (ou Revolut, wallet) à une date — ce que la banque affiche. Le compte se désigne par son nom ; s'il n'existe pas, il est créé (préciser sa devise s'il n'est pas dans la devise de la compta). `destinations` : les destinations Whop dont les virements arrivent sur ce compte (ceux arrivés après le relevé s'y ajouteront) ; absent = inchangé. Un second relevé le même jour remplace le premier.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        compte: { type: "string", description: "Nom du compte (ex. « Antho Banque »)." },
        solde: { type: "number", description: "Solde affiché par la banque, devise du compte." },
        jour: { type: "string", description: "Jour du relevé, AAAA-MM-JJ (défaut : aujourd'hui)." },
        devise: { type: "string", description: "Devise d'un NOUVEAU compte (eur, usd…). Défaut : celle de la compta." },
        destinations: {
          type: "array",
          description: "Destinations Whop qui arrivent sur ce compte (libellés exacts des virements).",
          items: { type: "string" },
        },
      },
      required: ["compte", "solde"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "marquer_mis_de_cote_paye",
    title: "Marquer payé de l'argent mis de côté",
    description:
      "MODIFIE la Compta (Trésorerie) : de l'argent mis de côté (parts « mise de côté » des virements) a servi — impôts, URSSAF. Il sort du « mis de côté », donc le disponible pour dépenser ne bouge pas, mais l'argent réservé baisse. Montant dans la devise de la compta.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        montant: { type: "number", description: "Montant payé (positif)." },
        jour: { type: "string", description: "Jour du paiement, AAAA-MM-JJ (défaut : aujourd'hui)." },
        motif: { type: "string", description: "Ex. « URSSAF 3e trimestre »." },
      },
      required: ["montant"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "ajouter_charge",
    title: "Ajouter une autre charge",
    description: `MODIFIE la Compta : ajoute une charge saisie à la main (hébergement, outil, abonnement, publicité, scans, autre), montant TTC dans la devise de la facture. Catégories : ${CATEGORIES_TEXTE}. Une charge « scans » remplace l'estimation des scans du mois. « chaque mois » la prévoit les mois suivants (à confirmer dans l'écran).`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        jour: { type: "string", description: "Jour de la facture, AAAA-MM-JJ." },
        libelle: { type: "string", description: "Libellé (ex. « Vercel Pro »)." },
        categorie: { type: "string", description: `Catégorie : ${CATEGORIES_TEXTE}.` },
        montant: { type: "number", description: "Montant TTC (positif)." },
        devise: { type: "string", description: "Devise de la facture (eur, usd…). Défaut : celle de la compta." },
        chaque_mois: { type: "boolean", description: "Charge mensuelle (défaut : non)." },
      },
      required: ["jour", "libelle", "categorie", "montant"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "supprimer_charge",
    title: "Supprimer une autre charge",
    description:
      "MODIFIE la Compta : supprime une charge saisie à la main, désignée par son jour et son libellé. Une charge née de la ventilation d'un virement ne se supprime pas ici : il faut changer la ventilation (ventiler_virement).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        jour: { type: "string", description: "Jour de la charge, AAAA-MM-JJ." },
        libelle: { type: "string", description: "Libellé exact (accents et casse ignorés)." },
      },
      required: ["jour", "libelle"],
      additionalProperties: false,
    },
    annotations: EFFACE,
  },
  {
    name: "classer_type_whop",
    title: "Ranger un type de ligne Whop",
    description:
      "MODIFIE la Compta : range un type de ligne du grand livre Whop que Jarvia ne connaît pas dans une colonne (CA brut, remboursements, litiges, frais Whop, virements, mouvements internes). Rétroactif : tous les mois qui ont ce type sont recalculés. Les types connus de Whop ne se reclassent pas.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        type: { type: "string", description: "Type de ligne Whop, exactement (ex. « referral_bonus »)." },
        colonne: { type: "string", description: "CA brut, remboursements, litiges, frais Whop, virements ou mouvements internes." },
      },
      required: ["type", "colonne"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

// ─── Écritures (même garde, mêmes cœurs que l'écran) ────────────────────────

const eur = montantTexte;


export const ecrireVentilation = mcpWriteMutation("business.read", "compta")({
  args: {
    jour: v.string(),
    montant: v.number(),
    vers: v.optional(v.string()),
    parts: v.array(
      v.object({ amount: v.number(), usage: v.string(), note: v.optional(v.string()), countedAs: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, a) => {
    const lignes = await ctx.db
      .query("whopLedgerLines")
      .withIndex("by_project_type_posted", (q) => q.eq("projectId", ctx.projectId).eq("lineType", "withdrawal"))
      .collect();
    const reversals = new Set(
      (
        await ctx.db
          .query("whopLedgerLines")
          .withIndex("by_project_type_posted", (q) =>
            q.eq("projectId", ctx.projectId).eq("lineType", "withdrawal_reversal"),
          )
          .collect()
      ).flatMap((l) => (l.sourceId ? [l.sourceId] : [])),
    );
    const duJour = lignes.filter(
      (l) =>
        parisDayKey(l.postedAt) === a.jour &&
        !isFailedWithdrawal(l.sourceStatus, l.sourceId ? reversals.has(l.sourceId) : false),
    );
    const candidats = duJour.filter(
      (l) =>
        Math.abs(round2(-l.amount) - a.montant) < 0.005 &&
        (a.vers === undefined || plierTexte(l.destination ?? "") === plierTexte(a.vers)),
    );
    const decrire = (l: (typeof lignes)[number]) =>
      `${eur(round2(-l.amount), l.currency)} vers ${l.destination ?? "la banque"}`;
    if (candidats.length !== 1) {
      throw err(
        ERR.COMPTA_TRANSFER_NOT_FOUND,
        candidats.length === 0
          ? `Aucun virement réussi de ${a.montant} le ${a.jour}.` +
              (duJour.length > 0 ? ` Ce jour-là : ${duJour.map(decrire).join(" ; ")}.` : "")
          : `Plusieurs virements de ${a.montant} le ${a.jour} : précise « vers » (${candidats.map((l) => l.destination ?? "?").join(", ")}).`,
      );
    }
    const ligne = candidats[0];
    const avant = { parts: ligne.parts ?? null, usage: ligne.usage ?? null, note: ligne.note ?? null };
    await ventilateTransferCore(ctx, {
      lineId: ligne._id,
      parts: a.parts.map((p, i) => ({
        id: `mcp${i + 1}`,
        amount: p.amount,
        usage: p.usage,
        ...(p.note ? { note: p.note } : {}),
        ...(p.countedAs ? { countedAs: p.countedAs } : {}),
      })),
    });
    const comptees = round2(a.parts.filter((p) => p.countedAs).reduce((s, p) => s + p.amount, 0));
    const summary =
      a.parts.length === 0
        ? `Ventilation effacée : ${decrire(ligne)} du ${jourTexte(a.jour)}`
        : `${decrire(ligne)} du ${jourTexte(a.jour)}, en ${a.parts.length} part${a.parts.length > 1 ? "s" : ""}` +
          (comptees > 0 ? ` (${eur(comptees, ligne.currency)} comptés en charge)` : "");
    const apres = (await ctx.db.get(ligne._id))?.parts ?? null;
    await journaliser(ctx, {
      tool: "ventiler_virement",
      summary,
      section: "transfers",
      month: a.jour.slice(0, 7),
      annulation: { type: "ventilation", lineId: ligne._id, avant, apres },
    });
    return { summary, devise: ligne.currency };
  },
});

export const ecrireReleve = mcpWriteMutation("business.read", "compta")({
  args: {
    compte: v.string(),
    solde: v.number(),
    jour: v.string(),
    devise: v.optional(v.string()),
    destinations: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a) => {
    const comptes = await ctx.db
      .query("comptaAccounts")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const existant = comptes.find((c) => plierTexte(c.name) === plierTexte(a.compte)) ?? null;
    const devise =
      existant?.currency ?? a.devise?.trim().toLowerCase() ?? (await comptaReferenceCurrency(ctx, ctx.projectId)) ?? "";
    const releveAvant = existant
      ? ((
          await ctx.db
            .query("comptaAccountReadings")
            .withIndex("by_account_day", (q) => q.eq("accountId", existant._id).eq("day", a.jour))
            .first()
        )?.amount ?? null)
      : null;
    const { accountId } = await saveAccountReadingCore(ctx, {
      ...(existant ? { accountId: existant._id } : { newAccount: { name: a.compte.trim(), currency: devise } }),
      destinations: a.destinations ?? existant?.destinations ?? [],
      day: a.jour,
      amount: a.solde,
    });
    const summary = `${existant ? "" : "Nouveau compte · "}${existant?.name ?? a.compte.trim()} : ${eur(round2(a.solde), devise)} au ${jourTexte(a.jour)}`;
    await journaliser(ctx, {
      tool: "relever_solde",
      summary,
      section: "treasury",
      annulation: {
        type: "releve",
        accountId,
        compteCree: existant === null,
        day: a.jour,
        avant: releveAvant,
        apres: round2(a.solde),
        destinationsAvant: existant?.destinations ?? [],
      },
    });
    return { summary, cree: existant === null };
  },
});

export const ecrireMisDeCotePaye = mcpWriteMutation("business.read", "compta")({
  args: { montant: v.number(), jour: v.string(), motif: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { useId } = await recordProvisionUseCore(ctx, { day: a.jour, amount: a.montant, ...(a.motif ? { note: a.motif } : {}) });
    const devise = (await comptaReferenceCurrency(ctx, ctx.projectId)) ?? "";
    const summary = `${eur(round2(a.montant), devise)} du mis de côté le ${jourTexte(a.jour)}${a.motif ? ` · « ${a.motif} »` : ""}`;
    await journaliser(ctx, {
      tool: "marquer_mis_de_cote_paye",
      summary,
      section: "treasury",
      annulation: { type: "misDeCote", useId },
    });
    return { summary };
  },
});

export const ecrireCharge = mcpWriteMutation("business.read", "compta")({
  args: {
    jour: v.string(),
    libelle: v.string(),
    categorie: v.string(),
    montant: v.number(),
    devise: v.optional(v.string()),
    chaqueMois: v.boolean(),
  },
  handler: async (ctx, a) => {
    const devise = a.devise?.trim().toLowerCase() || ((await comptaReferenceCurrency(ctx, ctx.projectId)) ?? "");
    const { chargeId } = await addComptaChargeCore(ctx, {
      day: a.jour,
      label: a.libelle,
      category: a.categorie,
      amount: a.montant,
      currency: devise,
      recurring: a.chaqueMois,
    });
    const summary = `${a.libelle.trim()} : ${eur(round2(a.montant), devise)} le ${jourTexte(a.jour)}${a.chaqueMois ? " (chaque mois)" : ""}`;
    await journaliser(ctx, {
      tool: "ajouter_charge",
      summary,
      section: "charges",
      month: a.jour.slice(0, 7),
      annulation: { type: "chargeAjoutee", chargeId },
    });
    return { summary };
  },
});

export const effacerCharge = mcpWriteMutation("business.read", "compta")({
  args: { jour: v.string(), libelle: v.string() },
  handler: async (ctx, a) => {
    const duMois = await ctx.db
      .query("comptaCharges")
      .withIndex("by_project_month", (q) => q.eq("projectId", ctx.projectId).eq("month", a.jour.slice(0, 7)))
      .collect();
    const candidats = duMois.filter((c) => c.day === a.jour && plierTexte(c.label) === plierTexte(a.libelle));
    if (candidats.length !== 1) {
      const duJour = duMois.filter((c) => c.day === a.jour);
      throw err(
        ERR.COMPTA_CHARGE_NOT_FOUND,
        candidats.length === 0
          ? `Aucune charge « ${a.libelle} » le ${a.jour}.` +
              (duJour.length > 0 ? ` Ce jour-là : ${duJour.map((c) => `« ${c.label} »`).join(", ")}.` : "")
          : `Plusieurs charges « ${a.libelle} » le ${a.jour} : supprime-les depuis l'écran.`,
      );
    }
    const charge = candidats[0];
    await deleteComptaChargeCore(ctx, { chargeId: charge._id });
    const summary = `${charge.label} : ${eur(charge.amount, charge.currency)} du ${jourTexte(charge.day)}`;
    await journaliser(ctx, {
      tool: "supprimer_charge",
      summary,
      section: "charges",
      month: charge.month,
      annulation: {
        type: "chargeSupprimee",
        charge: {
          day: charge.day,
          label: charge.label,
          category: charge.category,
          amount: charge.amount,
          currency: charge.currency,
          recurring: charge.recurring === true,
        },
      },
    });
    return { summary };
  },
});

export const ecrireClassement = mcpWriteMutation("business.read", "compta")({
  args: { type: v.string(), colonne: v.string() },
  handler: async (ctx, a) => {
    const etat = await ctx.db
      .query("comptaState")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .first();
    const avant = etat?.rules.find((r) => r.lineType === a.type)?.bucket ?? null;
    await setLineRuleCore(ctx, { lineType: a.type, bucket: a.colonne });
    const summary = `Type Whop « ${a.type} » rangé dans « ${LIBELLE_COLONNE[a.colonne as ComptaBucket] ?? a.colonne} »`;
    await journaliser(ctx, {
      tool: "classer_type_whop",
      summary,
      section: "rules",
      annulation: { type: "regle", lineType: a.type, avant, apres: a.colonne },
    });
    return { summary };
  },
});

// ─── L'appel d'un outil d'écriture (action du serveur MCP) ──────────────────

const OU_DEFAIRE: Record<string, string> = {
  ventiler_virement: "Compta › Virements › « Ventiler ou annoter » sur ce virement › « Effacer la ventilation » (ou corrige les parts).",
  relever_solde: "Compta › Trésorerie › « Relever » sur ce compte › retire le relevé dans « Derniers relevés ».",
  marquer_mis_de_cote_paye: "Compta › Trésorerie › « Marquer payé » › « Déjà payé » : annule la ligne.",
  ajouter_charge: "Compta › Autres charges › le mois de la charge › supprime-la.",
  supprimer_charge: "Recrée la charge (ajouter_charge, ou Compta › Autres charges › « Ajouter une charge »).",
  classer_type_whop: "Compta › « Comment chaque colonne est calculée » › Règles › retire la règle.",
};

/**
 * Exécute un outil d'écriture : lit les arguments (libellés de l'écran ou
 * codes), appelle la mutation gardée, et rend ce qui a changé + où le défaire.
 */
async function appelerEcritureCompta(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const aujourdhui = parisDayKey(Date.now());
  const jour = (cle: string, defaut = true) => {
    const j = jourDepuis(args[cle], defaut ? aujourdhui : "");
    if (j === null || j === "") throw new ToolError(`« ${cle} » doit être un jour AAAA-MM-JJ.`);
    return j;
  };
  const montant = (x: unknown, cle: string) => {
    const n = montantDepuis(x);
    if (n === null) throw new ToolError(`« ${cle} » doit être un montant (ex. 1337.49).`);
    return n;
  };
  const texte = (cle: string) => (typeof args[cle] === "string" ? (args[cle] as string).trim() : "");

  let r: { summary: string };
  if (name === "ventiler_virement") {
    const brutes = Array.isArray(args.parts) ? args.parts : null;
    if (brutes === null) throw new ToolError("« parts » doit être une liste (vide pour effacer la ventilation).");
    const parts = brutes.map((p, i) => {
      const o = (typeof p === "object" && p !== null ? p : {}) as Record<string, unknown>;
      const usage = usageDepuis(o.usage);
      if (usage === null) throw new ToolError(`Part ${i + 1} : usage inconnu « ${String(o.usage)} ». Usages : ${USAGES_TEXTE}.`);
      const compte = o.compter_en_charge;
      const countedAs = compte === undefined || compte === null || compte === "" ? undefined : categorieDepuis(compte);
      if (countedAs === null) throw new ToolError(`Part ${i + 1} : catégorie inconnue « ${String(compte)} ». Catégories : ${CATEGORIES_TEXTE}.`);
      const note = typeof o.motif === "string" && o.motif.trim() !== "" ? o.motif.trim() : undefined;
      return { amount: montant(o.montant, `parts[${i + 1}].montant`), usage, ...(note ? { note } : {}), ...(countedAs ? { countedAs } : {}) };
    });
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWrites.ecrireVentilation, {
        ...cible,
        jour: jour("jour", false),
        montant: montant(args.montant, "montant"),
        ...(texte("vers") ? { vers: texte("vers") } : {}),
        parts,
      }),
    );
  } else if (name === "relever_solde") {
    if (texte("compte") === "") throw new ToolError("« compte » : le nom du compte.");
    const dest = args.destinations;
    if (dest !== undefined && !(Array.isArray(dest) && dest.every((d) => typeof d === "string"))) {
      throw new ToolError("« destinations » doit être une liste de destinations Whop.");
    }
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWrites.ecrireReleve, {
        ...cible,
        compte: texte("compte"),
        solde: montant(args.solde, "solde"),
        jour: jour("jour"),
        ...(texte("devise") ? { devise: texte("devise") } : {}),
        ...(dest !== undefined ? { destinations: dest as string[] } : {}),
      }),
    );
  } else if (name === "marquer_mis_de_cote_paye") {
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWrites.ecrireMisDeCotePaye, {
        ...cible,
        montant: montant(args.montant, "montant"),
        jour: jour("jour"),
        ...(texte("motif") ? { motif: texte("motif") } : {}),
      }),
    );
  } else if (name === "ajouter_charge") {
    const categorie = categorieDepuis(args.categorie);
    if (categorie === null) throw new ToolError(`Catégorie inconnue « ${String(args.categorie)} ». Catégories : ${CATEGORIES_TEXTE}.`);
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWrites.ecrireCharge, {
        ...cible,
        jour: jour("jour", false),
        libelle: texte("libelle"),
        categorie,
        montant: montant(args.montant, "montant"),
        ...(texte("devise") ? { devise: texte("devise") } : {}),
        chaqueMois: args.chaque_mois === true,
      }),
    );
  } else if (name === "supprimer_charge") {
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWrites.effacerCharge, { ...cible, jour: jour("jour", false), libelle: texte("libelle") }),
    );
  } else if (name === "classer_type_whop") {
    const colonne = colonneDepuis(args.colonne);
    if (colonne === null) {
      throw new ToolError("Colonne inconnue : CA brut, remboursements, litiges, frais Whop, virements ou mouvements internes.");
    }
    r = await ecrire(() => ctx.runMutation(internal.mcpWrites.ecrireClassement, { ...cible, type: texte("type"), colonne }));
  } else {
    throw new ToolError(`Outil inconnu : ${name}.`);
  }
  return resultatEcriture(projet, r.summary, OU_DEFAIRE[name]);
}

/** Le domaine « Compta » : interrupteur « Peut modifier la Compta ». */
export const DOMAINE_COMPTA: DomaineEcriture = {
  scope: "compta",
  outils: OUTILS_ECRITURE_COMPTA,
  droits: Object.fromEntries(OUTILS_ECRITURE_COMPTA.map((t) => [t.name, "business.read" as const])),
  appeler: appelerEcritureCompta,
};
