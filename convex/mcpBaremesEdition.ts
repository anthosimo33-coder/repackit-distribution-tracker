/**
 * OUTILS MCP D'ÉCRITURE — CRÉER et MODIFIER un barème, sous l'interrupteur
 * « Barèmes » (convex/mcpBaremes), droit `pricing.manage` : celui de l'écran.
 *
 *  - `creer_bareme`    : « Nouveau pricing » de l'écran (`createPricingCore`).
 *  - `modifier_bareme` : la modification de l'écran (`updatePricingCore`) ;
 *                        sans « bareme », sa simulation liste les barèmes.
 *
 * Ils écrivent les TERMES (convex/baremeTermes) : nom, fixe, nombre de vidéos,
 * CPM, seuil de vues du mois, minimum de vues par vidéo. Ni les paliers, ni le
 * bonus par vidéo, ni la devise d'un barème existant : ceux-là restent à
 * l'écran, et l'écriture les laisse en place.
 *
 * ⚠️ UN BARÈME EST FIGÉ SUR CHAQUE VIDÉO À L'ATTRIBUTION. Modifier ses termes
 * ne change que les vidéos attribuées ENSUITE ; les autres passent par
 * `changer_bareme`. Les deux outils le disent, chiffres à l'appui.
 *
 * Journalisés (document entier avant/après) ; `defaire` supprime un barème créé
 * tant qu'il n'a servi à rien, et remet les termes d'avant tant que le barème
 * montre encore ceux écrits.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mcpPermissionQuery, mcpWriteMutation, type ProjectQueryCtx } from "./functions";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  AJOUTE,
  ARG_PROJET,
  designerOuRefuser,
  ECRIT,
  ecrire,
  etatsApres,
  etatsCrees,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  type CibleEcriture,
} from "./mcpWriteCommon";
import { plierTexte } from "./mcpWriteArgs";
import { createPricingCore, updatePricingCore } from "./pricing";
import { pricingPayCurrency } from "./creatorPayCurrency";
import { isCurrencyCode, normalizeCurrency } from "./payCurrency";
import {
  appliquerChangements,
  differences,
  empreinteTermes,
  termesDe,
  termesLisibles,
  toucheLesTermesFiges,
  versChampsPricing,
  type ChangementsBareme,
  type TermesBareme,
} from "./baremeTermes";

const ARGS_TERMES = {
  fixe: { type: "number", minimum: 0, description: "Montant fixe du forfait, dans la devise du barème (0 = pas de fixe)." },
  nb_videos: { type: "integer", minimum: 1, description: "Nombre de vidéos du forfait : le fixe par vidéo = fixe ÷ ce nombre." },
  cpm: { type: "number", minimum: 0, description: "Montant pour 1 000 vues (0 = pas de CPM)." },
  seuil_vues_mois: {
    type: "integer",
    minimum: 0,
    description: "Vues cumulées dans le mois sous lesquelles le fixe du mois vaut 0 (0 = aucun seuil). Exige un fixe.",
  },
  min_vues_par_video: {
    type: "integer",
    minimum: 0,
    description: "Vues qu'une vidéo doit faire pour toucher son fixe ; sous ce nombre, fixe à 0 pour elle, CPM payé quand même (0 = aucun minimum). Exige un fixe.",
  },
} as const;

export const OUTIL_CREER_BAREME: McpTool = {
  name: "creer_bareme",
  title: "Créer un barème",
  description:
    "CRÉE un barème, comme « Nouveau pricing » de l'écran Barèmes : nom, fixe pour N vidéos, CPM, seuil de vues du mois, minimum de vues par vidéo. Les paliers et le bonus par vidéo s'ajoutent à l'écran. Il ne paie personne tant qu'aucune mission n'est attribuée dessus (écran Assignments, `assigner_scripts`) ou qu'aucune vidéo n'y est passée (`changer_bareme`). Deux barèmes ne portent pas le même nom. Appelle d'abord avec « simuler ». Aucun email. Journalisé ; `defaire` le supprime tant qu'il n'a servi à rien.",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      nom: { type: "string", description: "Nom du barème, unique dans le projet." },
      devise: { type: "string", description: "Code à trois lettres (EUR, USD…). Défaut : la devise de paie du projet." },
      ...ARGS_TERMES,
      simuler: { type: "boolean", description: "true = n'écrit rien : montre le barème tel qu'il serait créé." },
    },
    required: ["nom", "fixe", "nb_videos", "cpm"],
    additionalProperties: false,
  },
  annotations: AJOUTE,
};

export const OUTIL_MODIFIER_BAREME: McpTool = {
  name: "modifier_bareme",
  title: "Modifier un barème",
  description:
    "MODIFIE les termes d'un barème, comme l'écran Barèmes : nom, fixe, nombre de vidéos, CPM, seuil de vues du mois, minimum de vues par vidéo (0 = le retirer). Seuls les termes passés changent ; paliers, bonus par vidéo et devise ne bougent pas. ⚠️ Un barème est FIGÉ sur chaque vidéo à son attribution : la modification ne vaut que pour les vidéos attribuées ENSUITE. Pour les vidéos déjà attribuées, `changer_bareme` (la simulation dit combien en ont). Changer le fixe, le nombre de vidéos ou le CPM d'un barème déjà attribué crée deux versions qui se partagent les cycles : mieux vaut souvent `creer_bareme` puis `changer_bareme`. Sans « bareme », « simuler » liste les barèmes du projet et leurs termes. Aucun email. Journalisé ; `defaire` remet les termes d'avant.",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      bareme: { type: "string", description: "Nom du barème à modifier. Absent avec « simuler » : la liste des barèmes." },
      nouveau_nom: { type: "string", description: "Nouveau nom, unique dans le projet." },
      ...ARGS_TERMES,
      simuler: { type: "boolean", description: "true = n'écrit rien : termes avant/après et vidéos qui gardent les anciens." },
    },
    additionalProperties: false,
  },
  annotations: ECRIT,
};

// ─── Lectures communes ──────────────────────────────────────────────────────

const pliee = (s: string) => plierTexte(s).trim();

async function baremesDuProjet(ctx: ProjectQueryCtx) {
  return ctx.db
    .query("pricings")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
}

/** Deux barèmes ne portent pas le même nom : l'outil les désigne par lui. */
function refuserNomPris(baremes: readonly Doc<"pricings">[], nom: string, sauf?: string) {
  const pris = baremes.find((p) => p._id !== sauf && pliee(p.name) === pliee(nom));
  if (pris) {
    throw err(ERR.MCP_DESIGNATION, `Un barème s'appelle déjà « ${pris.name} » : choisis un autre nom.`);
  }
}

/** Vidéos dont le barème FIGÉ vient de ce barème (elles ne suivent pas une modification). */
async function videosFigees(ctx: ProjectQueryCtx, pricingId: string) {
  const asg = await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  const miennes = asg.filter((a) => a.pricingSnapshot?.pricingId === pricingId && a.status !== "cancelled");
  return {
    total: miennes.length,
    nonPubliees: miennes.filter((a) => a.status !== "published" && a.status !== "paid").length,
  };
}

const changementsValidator = v.object({
  nom: v.optional(v.string()),
  fixe: v.optional(v.number()),
  nbVideos: v.optional(v.number()),
  cpm: v.optional(v.number()),
  seuilVuesMois: v.optional(v.number()),
  minVuesParVideo: v.optional(v.number()),
});

// ─── creer_bareme ───────────────────────────────────────────────────────────

const creationValidator = {
  nom: v.string(),
  devise: v.optional(v.string()),
  fixe: v.number(),
  nbVideos: v.number(),
  cpm: v.number(),
  seuilVuesMois: v.number(),
  minVuesParVideo: v.number(),
};

export const simulerCreation = mcpPermissionQuery("pricing.manage")({
  args: creationValidator,
  handler: async (ctx, a) => {
    refuserNomPris(await baremesDuProjet(ctx), a.nom);
    const project = await ctx.db.get(ctx.projectId);
    const devise = normalizeCurrency(a.devise) ?? normalizeCurrency(project?.payCurrency);
    return { bareme: termesLisibles(a, devise) };
  },
});

export const ecrireCreation = mcpWriteMutation("pricing.manage", "baremes")({
  args: creationValidator,
  handler: async (ctx, a) => {
    refuserNomPris(await baremesDuProjet(ctx), a.nom);
    const { devise, ...termes } = a;
    // Le geste de l'écran, sous sa règle (devise admise, seuil et minimum
    // refusés sans fixe…).
    const { pricingId } = await createPricingCore(ctx, {
      ...versChampsPricing(termes),
      ...(devise !== undefined ? { currency: devise } : {}),
    });
    const cree = (await ctx.db.get(pricingId))!;
    const project = await ctx.db.get(ctx.projectId);
    const ecrits = termesDe(cree);
    const lisible = termesLisibles(ecrits, pricingPayCurrency(cree, project));
    const summary = `Barème « ${cree.name} » créé : fixe ${lisible.fixe}, CPM ${lisible.cpm}, minimum par vidéo ${lisible.minimumParVideo}`;
    await journaliser(ctx, {
      tool: "creer_bareme",
      summary,
      section: "pricing",
      path: "pricings",
      annulation: { type: "baremeCree", pricingId, apres: empreinteTermes(ecrits) },
      etats: await etatsCrees(ctx, "pricings", [pricingId]),
    });
    return { summary, bareme: lisible };
  },
});

// ─── modifier_bareme ────────────────────────────────────────────────────────

/** Le barème désigné, ses termes avant/après, et les vidéos qui gardent l'avant. */
async function decrireModification(ctx: ProjectQueryCtx, bareme: string, c: ChangementsBareme) {
  const baremes = await baremesDuProjet(ctx);
  const p = designerOuRefuser(baremes, (x) => x.name, bareme, "barèmes");
  if (c.nom !== undefined) refuserNomPris(baremes, c.nom, p._id);
  const project = await ctx.db.get(ctx.projectId);
  const devise = pricingPayCurrency(p, project);
  const avant = termesDe(p);
  const apres = appliquerChangements(avant, c);
  const figees = await videosFigees(ctx, p._id);
  const changements = differences(avant, apres, devise);
  return {
    p,
    avant,
    apres,
    vue: {
      bareme: p.name,
      ...(p.status === "archived" ? { statut: "archivé : il ne s'attribue plus tant qu'il n'est pas réactivé à l'écran" } : {}),
      avant: termesLisibles(avant, devise),
      apres: termesLisibles(apres, devise),
      changements: changements.length > 0 ? changements : ["aucun : les termes demandés sont déjà ceux du barème"],
      ...(toucheLesTermesFiges(avant, apres) && figees.total > 0
        ? {
            videosDejaAttribuees:
              `${figees.total} vidéo(s) attribuée(s) sur ce barème (dont ${figees.nonPubliees} pas encore publiée(s)) ` +
              "GARDENT les anciens termes : la modification ne vaut que pour les prochaines attributions. " +
              "Pour elles, `changer_bareme` par créatrice, à partir d'un jour.",
          }
        : {}),
    },
  };
}

/** Sans barème désigné : la liste, pour choisir. */
async function listerBaremes(ctx: ProjectQueryCtx) {
  const project = await ctx.db.get(ctx.projectId);
  return (await baremesDuProjet(ctx))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      ...termesLisibles(termesDe(p), pricingPayCurrency(p, project)),
      ...(p.status === "archived" ? { statut: "archivé" } : {}),
    }));
}

export const simulerModification = mcpPermissionQuery("pricing.manage")({
  args: { bareme: v.optional(v.string()), changements: changementsValidator },
  handler: async (ctx, { bareme, changements }) =>
    bareme === undefined
      ? { baremes: await listerBaremes(ctx) }
      : (await decrireModification(ctx, bareme, changements)).vue,
});

export const ecrireModification = mcpWriteMutation("pricing.manage", "baremes")({
  args: { bareme: v.string(), changements: changementsValidator },
  handler: async (ctx, { bareme, changements }) => {
    const { p, avant, apres, vue } = await decrireModification(ctx, bareme, changements);
    if (empreinteTermes(avant) === empreinteTermes(apres)) {
      return { summary: `Barème « ${p.name} » : rien à changer, les termes demandés sont déjà les siens`, vue };
    }
    const photos = await photographier(ctx, "pricings", [p._id]);
    // Le geste de l'écran. Seuil et minimum TOUJOURS envoyés (cf
    // versChampsPricing) ; paliers, bonus par vidéo et devise absents ⇒ intacts.
    await updatePricingCore(ctx, p._id, versChampsPricing(apres));
    const ecrits = termesDe((await ctx.db.get(p._id))!);
    const summary = `Barème « ${p.name} » modifié : ${vue.changements.join(" ; ")}`;
    await journaliser(ctx, {
      tool: "modifier_bareme",
      summary,
      section: "pricing",
      path: "pricings",
      annulation: {
        type: "baremeModifie",
        pricingId: p._id,
        avant: empreinteTermes(avant),
        apres: empreinteTermes(ecrits),
      },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, vue };
  },
});

// ─── L'appel des outils (action du serveur MCP) ─────────────────────────────

function nombreArg(args: Record<string, unknown>, cle: string, entier: boolean, min: number): number | undefined {
  const x = args[cle];
  if (x === undefined) return undefined;
  if (typeof x !== "number" || !Number.isFinite(x) || x < min || (entier && !Number.isInteger(x))) {
    throw new ToolError(`« ${cle} » : ${entier ? "un nombre entier" : "un nombre"} ≥ ${min}.`);
  }
  return x;
}

/** Les termes passés à l'appel ; chaque absent reste absent. */
function changementsArgs(args: Record<string, unknown>): ChangementsBareme {
  const out: ChangementsBareme = {};
  const fixe = nombreArg(args, "fixe", false, 0);
  const nbVideos = nombreArg(args, "nb_videos", true, 1);
  const cpm = nombreArg(args, "cpm", false, 0);
  const seuil = nombreArg(args, "seuil_vues_mois", true, 0);
  const min = nombreArg(args, "min_vues_par_video", true, 0);
  if (fixe !== undefined) out.fixe = fixe;
  if (nbVideos !== undefined) out.nbVideos = nbVideos;
  if (cpm !== undefined) out.cpm = cpm;
  if (seuil !== undefined) out.seuilVuesMois = seuil;
  if (min !== undefined) out.minVuesParVideo = min;
  return out;
}

const OU_DEFAIRE_CREATION =
  "`defaire` le supprime tant qu'il n'est attribué à aucune vidéo ni grille de créatrice ; sinon écran Barèmes › « Archiver ».";
const OU_DEFAIRE_MODIFICATION =
  "`defaire` remet les termes d'avant (tant qu'ils n'ont pas rebougé) ; sinon écran Barèmes › le barème.";

export async function appelerCreerBareme(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const nom = texteArg(args, "nom");
  if (nom === "") throw new ToolError("« nom » : le nom du barème.");
  const deviseBrute = texteArg(args, "devise");
  if (deviseBrute !== "" && !isCurrencyCode(deviseBrute)) {
    throw new ToolError(`« devise » : « ${deviseBrute} » n'est pas un code à trois lettres (EUR, USD…).`);
  }
  const c = changementsArgs(args);
  if (c.fixe === undefined || c.nbVideos === undefined || c.cpm === undefined) {
    throw new ToolError("« fixe », « nb_videos » et « cpm » sont requis (0 pour « aucun »).");
  }
  const termes: TermesBareme & { devise?: string } = {
    nom,
    fixe: c.fixe,
    nbVideos: c.nbVideos,
    cpm: c.cpm,
    seuilVuesMois: c.seuilVuesMois ?? 0,
    minVuesParVideo: c.minVuesParVideo ?? 0,
    ...(deviseBrute !== "" ? { devise: normalizeCurrency(deviseBrute)! } : {}),
  };
  if (args.simuler === true) {
    const vue = await ecrire(() =>
      ctx.runQuery(internal.mcpBaremesEdition.simulerCreation, { userId: cible.userId, projectId: cible.projectId, ...termes }),
    );
    return resultatEcriture(projet, "Simulation : rien n'a été écrit.", "Rien à défaire.", {
      simulation: vue,
      suite: "Pour écrire : rappelle creer_bareme sans « simuler ».",
    });
  }
  const r = await ecrire(() => ctx.runMutation(internal.mcpBaremesEdition.ecrireCreation, { ...cible, ...termes }));
  return resultatEcriture(projet, r.summary, OU_DEFAIRE_CREATION, { detail: r.bareme });
}

export async function appelerModifierBareme(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const bareme = texteArg(args, "bareme");
  const changements = changementsArgs(args);
  const nouveauNom = texteArg(args, "nouveau_nom");
  if (nouveauNom !== "") changements.nom = nouveauNom;
  if (args.simuler === true) {
    const vue = await ecrire(() =>
      ctx.runQuery(internal.mcpBaremesEdition.simulerModification, {
        userId: cible.userId,
        projectId: cible.projectId,
        ...(bareme !== "" ? { bareme } : {}),
        changements,
      }),
    );
    return resultatEcriture(projet, "Simulation : rien n'a été écrit.", "Rien à défaire.", {
      simulation: vue,
      ...(bareme !== "" ? { suite: "Pour écrire : rappelle modifier_bareme sans « simuler »." } : {}),
    });
  }
  if (bareme === "") throw new ToolError("« bareme » : le nom du barème à modifier (« simuler » sans lui liste les barèmes).");
  if (Object.keys(changements).length === 0) {
    throw new ToolError(
      "Rien à modifier : passe au moins un terme (nouveau_nom, fixe, nb_videos, cpm, seuil_vues_mois, min_vues_par_video).",
    );
  }
  const r = await ecrire(() => ctx.runMutation(internal.mcpBaremesEdition.ecrireModification, { ...cible, bareme, changements }));
  return resultatEcriture(projet, r.summary, OU_DEFAIRE_MODIFICATION, { detail: r.vue });
}
