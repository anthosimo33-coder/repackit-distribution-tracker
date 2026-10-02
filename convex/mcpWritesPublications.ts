/**
 * OUTILS MCP D'ÉCRITURE — les PUBLICATIONS (interrupteur « Peut modifier les
 * publications »).
 *
 *  - `confirmer_publication` : coller le lien d'un post à la place de la
 *    créatrice, EN SECOURS — le formulaire « Publier » de l'admin, droit
 *    `review.manage`. Même cœur : la créatrice est créditée à l'identique ;
 *  - `marquer_warmup` : la bascule chauffe ↔ promo d'un post du Tracker, droit
 *    `tracker.manage`. La réponse dit l'état FINAL (chauffe, rémunérée), parce
 *    qu'une rémunération réglée à la main ne suit pas la bascule.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { mcpWriteMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  ARG_PROJET,
  ecrire,
  ECRIT,
  journaliser,
  RefusEcriture,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { jourTexte, plierTexte } from "./mcpWriteArgs";
import { publicationParLien, trouverMission } from "./mcpWritesMissions";
import { confirmPublicationAsAdminCore } from "./assignments";
import { setPublicationWarmupCore } from "./publications";
import { representativePostedAt } from "./calendarStatus";
import { detectPostUrlPlatform } from "./postUrlShape";
import { isRemunerated } from "./remunerate";
import { parisDayStart } from "./managerCpm";
import { parisDayKey } from "./comptaMath";
import type { Plateforme } from "./platforms";

// ─── Déclaration des outils ─────────────────────────────────────────────────

export const OUTILS_ECRITURE_PUBLICATIONS: readonly McpTool[] = [
  {
    name: "confirmer_publication",
    title: "Coller le lien d'un post publié",
    description:
      "MODIFIE les publications : colle le lien d'un post à la place de la créatrice (elle a oublié, ou t'a envoyé le lien), comme le formulaire « Publier » de l'admin. La mission passe publiée, le suivi des vues démarre et la créatrice est créditée exactement comme si elle l'avait fait. Un lien par plateforme visée. La mission se désigne comme dans `planning` : créatrice + jour prévu (et compte, campagne ou morceau de script si besoin).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Nom de la créatrice, comme dans l'outil `planning`." },
        jour: { type: "string", description: "Jour PRÉVU de la mission, AAAA-MM-JJ (Paris), ou « sans date »." },
        compte: { type: "string", description: "Handle du compte visé, pour départager." },
        campagne: { type: "string", description: "Nom de la campagne, pour départager." },
        script: { type: "string", description: "Un morceau du texte du script, pour départager." },
        liens: {
          type: "array",
          description: "Lien du post publié, un par plateforme visée par la mission.",
          items: { type: "string" },
          minItems: 1,
          maxItems: 5,
        },
        publie_le: {
          type: "string",
          description: "Jour où le post est RÉELLEMENT sorti, AAAA-MM-JJ (défaut : aujourd'hui). Compte pour la paie : ne le devine pas.",
        },
        regulariser: {
          type: "boolean",
          description: "true = accepter une sortie ANTÉRIEURE à la création de la mission (post fait hors de l'app). Seulement après un refus qui le propose.",
        },
      },
      required: ["createatrice", "jour", "liens"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "marquer_warmup",
    title: "Marquer un post en chauffe ou en promo",
    description:
      "MODIFIE les publications : passe un post du Tracker en chauffe (warmup) ou en promo, désigné par son lien. Comme à l'écran : la chauffe sort le post des vues promo, et — sauf rémunération réglée à la main sur ce post — de la paie. Refusé si son cycle de paie est déjà payé. La réponse dit l'état final : chauffe oui/non, rémunéré oui/non.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        lien: { type: "string", description: "Lien du post (outils `meilleurs_posts`, `validation`)." },
        warmup: { type: "boolean", description: "true = chauffe, false = promo." },
      },
      required: ["lien", "warmup"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

// ─── Écritures ──────────────────────────────────────────────────────────────

export const ecrirePublication = mcpWriteMutation("review.manage", "publications")({
  args: {
    createatrice: v.string(),
    jour: v.union(v.string(), v.null()),
    compte: v.optional(v.string()),
    campagne: v.optional(v.string()),
    script: v.optional(v.string()),
    liens: v.array(v.string()),
    publieLe: v.optional(v.string()),
    regulariser: v.boolean(),
  },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, (x) => {
      const le = representativePostedAt(x);
      return le !== null ? `déjà publiée le ${jourTexte(parisDayKey(le))}` : null;
    });
    // Un lien par plateforme visée, comme les champs du formulaire.
    const visees = (m.a.targets ?? []).map((t) => t.platform);
    const urls: { platform: Plateforme; url: string }[] = [];
    for (const lien of a.liens) {
      const pf = detectPostUrlPlatform(lien) ?? (visees.length === 1 ? visees[0] : undefined);
      if (pf === undefined) {
        throw err(ERR.MCP_DESIGNATION, `Plateforme du lien « ${lien} » illisible : la mission vise ${visees.join(", ")}.`);
      }
      if (!visees.includes(pf)) {
        throw err(ERR.MCP_DESIGNATION, `Ce lien est un post ${pf}, mais la mission vise ${visees.join(", ")}.`);
      }
      if (urls.some((u) => u.platform === pf)) {
        throw err(ERR.MCP_DESIGNATION, `Deux liens ${pf} : un seul par plateforme.`);
      }
      urls.push({ platform: pf, url: lien });
    }
    const manquants = visees.filter((pf) => !urls.some((u) => u.platform === pf));
    if (manquants.length > 0) {
      throw err(ERR.MCP_DESIGNATION, `Il manque le lien ${manquants.join(", ")} : la mission vise ${visees.join(", ")}.`);
    }
    // Le formulaire : une date d'avant aujourd'hui est envoyée à midi (Paris) ;
    // aujourd'hui, rien — le serveur pose l'instant présent.
    const aujourdhui = parisDayKey(Date.now());
    const publishedAt =
      a.publieLe !== undefined && a.publieLe < aujourdhui ? parisDayStart(a.publieLe)! + 12 * 3_600_000 : undefined;
    await confirmPublicationAsAdminCore(ctx, {
      id: m.a._id,
      urls,
      ...(publishedAt !== undefined ? { publishedAt } : {}),
      ...(a.regulariser ? { allowBackdate: true } : {}),
    });
    const summary =
      `${m.libelle} : publiée — ${urls.map((u) => u.url).join(", ")}` +
      (publishedAt !== undefined ? ` (sortie le ${jourTexte(a.publieLe!)})` : "");
    await journaliser(ctx, { tool: "confirmer_publication", summary, section: "planning", path: "assignments" });
    return { summary };
  },
});

export const ecrireWarmup = mcpWriteMutation("tracker.manage", "publications")({
  args: { lien: v.string(), warmup: v.boolean() },
  handler: async (ctx, a) => {
    const pub = await publicationParLien(ctx, a.lien);
    const avant = { warmup: pub.isWarmup === true, remuneree: isRemunerated({ isWarmup: pub.isWarmup === true, remunere: pub.remunere }) };
    await setPublicationWarmupCore(ctx, pub._id, a.warmup);
    const apres = (await ctx.db.get(pub._id))!;
    const etat = {
      warmup: apres.isWarmup === true,
      remuneree: isRemunerated({ isWarmup: apres.isWarmup === true, remunere: apres.remunere }),
    };
    const quoi = `${pub.compte} (${pub.plateforme}) du ${jourTexte(parisDayKey(pub.datePubli))}`;
    const inchange = avant.warmup === etat.warmup;
    const summary =
      `${quoi} : ${etat.warmup ? "chauffe" : "promo"}, ${etat.remuneree ? "rémunéré" : "non rémunéré"}` +
      (inchange ? " (déjà dans cet état)" : "");
    if (!inchange) {
      await journaliser(ctx, { tool: "marquer_warmup", summary, section: "tracker", path: "dashboard" });
    }
    return {
      summary,
      inchange,
      // La rémunération posée à la main ÉPINGLE le post : la bascule ne la change pas.
      remunerationEpinglee: apres.remunere !== undefined,
    };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  confirmer_publication:
    "Une publication confirmée ne se dé-publie pas : un mauvais lien se corrige dans Assignments › la mission › « Corriger le lien ».",
  marquer_warmup: "Rappelle marquer_warmup avec l'état inverse, ou Tracker › le post › Warmup.",
};

async function appelerEcriturePublications(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name === "confirmer_publication") {
    const createatrice = texteArg(args, "createatrice");
    if (createatrice === "") throw new ToolError("« createatrice » : son nom, comme dans l'outil `planning`.");
    const j = texteArg(args, "jour");
    const jour = ["sans date", "aucun", "aucune"].includes(plierTexte(j))
      ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(j) && parisDayStart(j) !== null
        ? j
        : undefined;
    if (jour === undefined) throw new ToolError("« jour » : le jour PRÉVU de la mission, AAAA-MM-JJ, ou « sans date ».");
    const liens = textesArg(args, "liens");
    if (liens.length === 0) throw new ToolError("« liens » : le lien du post publié.");
    const publieLe = texteArg(args, "publie_le");
    if (publieLe !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(publieLe) || parisDayStart(publieLe) === null) {
        throw new ToolError("« publie_le » : un jour AAAA-MM-JJ.");
      }
      if (publieLe > parisDayKey(Date.now())) throw new ToolError("« publie_le » ne peut pas être dans le futur.");
    }
    const opt = (cle: string) => (texteArg(args, cle) === "" ? {} : { [cle]: texteArg(args, cle) });
    try {
      const r = await ecrire(() =>
        ctx.runMutation(internal.mcpWritesPublications.ecrirePublication, {
          ...cible,
          createatrice,
          jour,
          ...opt("compte"),
          ...opt("campagne"),
          ...opt("script"),
          liens,
          ...(publieLe !== "" ? { publieLe } : {}),
          regulariser: args.regulariser === true,
        }),
      );
      return resultatEcriture(projet, r.summary, OU_DEFAIRE[name]);
    } catch (e) {
      if (e instanceof RefusEcriture && e.code === ERR.PUBLISHED_AT_BEFORE_CREATION) {
        throw new ToolError(
          `${e.message} Si le post est vraiment sorti avant la création de la mission (fait hors de l'app), rappelle avec « regulariser: true » — après accord.`,
        );
      }
      throw e;
    }
  }
  if (name === "marquer_warmup") {
    const lien = texteArg(args, "lien");
    if (lien === "") throw new ToolError("« lien » : le lien du post.");
    if (typeof args.warmup !== "boolean") throw new ToolError("« warmup » : true = chauffe, false = promo.");
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesPublications.ecrireWarmup, { ...cible, lien, warmup: args.warmup as boolean }),
    );
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], {
      ...(r.inchange ? { inchange: true } : {}),
      ...(r.remunerationEpinglee
        ? { attention: "La rémunération de ce post a été réglée à la main : elle ne suit pas la chauffe (Tracker › le post › Rémunéré)." }
        : {}),
    });
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}

/** Le domaine « publications » : interrupteur « Peut modifier les publications ». */
export const DOMAINE_PUBLICATIONS: DomaineEcriture = {
  scope: "publications",
  outils: OUTILS_ECRITURE_PUBLICATIONS,
  appeler: appelerEcriturePublications,
};
