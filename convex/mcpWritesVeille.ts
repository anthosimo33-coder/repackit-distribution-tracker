/**
 * OUTILS MCP D'ÉCRITURE — la VEILLE et la BIBLIOTHÈQUE (interrupteur « Peut
 * modifier la veille »).
 *
 *  - `suivre_compte`, `ne_plus_suivre`, `noter_compte_suivi` : les comptes
 *    TikTok suivis par Radar (droit `radar.use`). Suivre lance un relevé Apify
 *    — payant —, comme le bouton ;
 *  - `ajouter_inspiration` : une vidéo ou un compte dans la bibliothèque
 *    d'inspirations (droit `library.manage`), réutilisable ensuite comme vidéo
 *    exemple à l'assignation.
 *
 * Un compte suivi se désigne par son handle (avec ou sans @), comme l'outil
 * `veille` le montre ; une inspiration par son lien.
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
  designerOuRefuser,
  ecrire,
  ECRIT,
  EFFACE,
  etatsApres,
  etatsCrees,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { cleDeLienPost } from "./mcpWriteArgs";
import { addRadarAccountCore, removeRadarAccountCore, updateRadarAccountNoteCore } from "./radar";
import { createInspirationCore } from "./inspirations";
import { detectPostUrlPlatform, isAccountOnlyUrl } from "./postUrlShape";

// ─── Déclaration des outils ─────────────────────────────────────────────────

const ARG_COMPTE = { type: "string", description: "Handle TikTok du compte suivi (avec ou sans @), comme dans l'outil `veille`." } as const;

export const OUTILS_ECRITURE_VEILLE: readonly McpTool[] = [
  {
    name: "suivre_compte",
    title: "Suivre un compte TikTok (Radar)",
    description:
      "MODIFIE la veille : ajoute un compte TikTok aux comptes suivis par Radar, comme le bouton « Suivre ». Lance tout de suite un relevé de ses vidéos par Apify — PAYANT (environ 25 vidéos par relevé, puis à chaque relevé planifié) : dis-le avant. Accepte un @handle, un handle ou une URL de profil.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        compte: { type: "string", description: "@handle, handle ou URL de profil TikTok." },
        note: { type: "string", description: "Pourquoi le suivre (facultatif)." },
      },
      required: ["compte"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "ne_plus_suivre",
    title: "Ne plus suivre un compte (Radar)",
    description:
      "MODIFIE la veille : retire un compte des comptes suivis, comme « Ne plus suivre ». Ses vidéos déjà relevées sont SUPPRIMÉES avec lui ; le suivre à nouveau relance un relevé payant.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, compte: ARG_COMPTE },
      required: ["compte"],
      additionalProperties: false,
    },
    annotations: EFFACE,
  },
  {
    name: "noter_compte_suivi",
    title: "Noter un compte suivi",
    description: "MODIFIE la veille : pose, change ou efface (texte vide) la note d'un compte suivi.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        compte: ARG_COMPTE,
        note: { type: "string", description: "La note. Vide = l'effacer." },
      },
      required: ["compte", "note"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "ajouter_inspiration",
    title: "Ajouter une inspiration",
    description:
      "MODIFIE la bibliothèque : ajoute une vidéo (ou un compte) TikTok, Instagram ou YouTube aux inspirations, désignée par son lien — la vignette se récupère seule. Une inspiration vidéo se réutilise ensuite comme « vidéo exemple » à l'assignation. Un lien déjà dans la bibliothèque n'est pas recréé.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        lien: { type: "string", description: "Lien de la vidéo ou du profil." },
        titre: { type: "string", description: "Titre court (facultatif)." },
        notes: { type: "string", description: "Ce qui est à reprendre de cette vidéo (facultatif)." },
        tags: { type: "array", description: "Étiquettes (facultatif).", items: { type: "string" }, maxItems: 10 },
      },
      required: ["lien"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
];

// ─── Écritures ──────────────────────────────────────────────────────────────

async function compteSuivi(ctx: Parameters<typeof removeRadarAccountCore>[0], demande: string) {
  const comptes = await ctx.db
    .query("radarAccounts")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  return designerOuRefuser(comptes, (c) => c.handle, demande, "comptes suivis");
}

export const ecrireSuivi = mcpWriteMutation("radar.use", "veille")({
  args: { compte: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { accountId, warning } = await addRadarAccountCore(ctx, a.compte, a.note);
    const compte = (await ctx.db.get(accountId))!;
    const summary = `@${compte.handle} suivi${a.note?.trim() ? ` — « ${a.note.trim()} »` : ""}`;
    await journaliser(ctx, {
      tool: "suivre_compte",
      summary,
      section: "radar",
      path: "radar",
      annulation: { type: "veilleSuivi", accountId, handle: compte.handle },
      etats: await etatsCrees(ctx, "radarAccounts", [accountId]),
    });
    return { summary, avertissement: warning };
  },
});

export const ecrireRetraitSuivi = mcpWriteMutation("radar.use", "veille")({
  args: { compte: v.string() },
  handler: async (ctx, a) => {
    const compte = await compteSuivi(ctx, a.compte);
    const videos = (
      await ctx.db
        .query("radarVideos")
        .withIndex("by_radarAccount", (q) => q.eq("radarAccountId", compte._id))
        .collect()
    ).length;
    const photos = await photographier(ctx, "radarAccounts", [compte._id]);
    await removeRadarAccountCore(ctx, compte._id);
    const summary = `@${compte.handle} n'est plus suivi (${videos} vidéo${videos > 1 ? "s" : ""} relevée${videos > 1 ? "s" : ""} supprimée${videos > 1 ? "s" : ""})`;
    await journaliser(ctx, {
      tool: "ne_plus_suivre",
      summary,
      section: "radar",
      path: "radar",
      annulation: { type: "veilleRetire", handle: compte.handle, note: compte.note ?? null },
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

export const ecrireNoteSuivi = mcpWriteMutation("radar.use", "veille")({
  args: { compte: v.string(), note: v.string() },
  handler: async (ctx, a) => {
    const compte = await compteSuivi(ctx, a.compte);
    const photos = await photographier(ctx, "radarAccounts", [compte._id]);
    await updateRadarAccountNoteCore(ctx, compte._id, a.note);
    const apres = (await ctx.db.get(compte._id))!.note ?? null;
    const summary = `@${compte.handle} : ${apres === null ? "note effacée" : `note « ${apres} »`}`;
    await journaliser(ctx, {
      tool: "noter_compte_suivi",
      summary,
      section: "radar",
      path: "radar",
      annulation: { type: "veilleNote", accountId: compte._id, avant: compte.note ?? null, apres },
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

export const ecrireInspiration = mcpWriteMutation("library.manage", "veille")({
  args: {
    lien: v.string(),
    plateforme: v.union(v.literal("TikTok"), v.literal("Instagram"), v.literal("YouTube")),
    type: v.union(v.literal("video"), v.literal("account")),
    titre: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    const cle = cleDeLienPost(a.lien);
    const deja = (
      await ctx.db
        .query("inspirations")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).find((i) => cleDeLienPost(i.url) === cle);
    if (deja) {
      throw err(ERR.MCP_DESIGNATION, `Déjà dans la bibliothèque${deja.titre ? ` (« ${deja.titre} »)` : ""} : rien n'a été ajouté.`);
    }
    const inspirationId = await createInspirationCore(ctx, {
      url: a.lien,
      type: a.type,
      plateforme: a.plateforme,
      ...(a.titre ? { titre: a.titre } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
      tags: a.tags,
    });
    const summary = `${a.type === "video" ? "Vidéo" : "Compte"} ${a.plateforme} ajouté${a.type === "video" ? "e" : ""} aux inspirations${a.titre ? ` — « ${a.titre} »` : ""}`;
    await journaliser(ctx, {
      tool: "ajouter_inspiration",
      summary,
      section: "inspirations",
      path: "inspirations",
      annulation: { type: "inspirationCreee", inspirationId },
      etats: await etatsCrees(ctx, "inspirations", [inspirationId]),
    });
    return { summary };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  suivre_compte: "`defaire`, ou Radar › le compte › « Ne plus suivre ». Le relevé déjà lancé est payé.",
  ne_plus_suivre: "`defaire` le suit à nouveau (nouveau relevé payant) ; les vidéos relevées avant sont perdues.",
  noter_compte_suivi: "`defaire`, ou Radar › le compte › note.",
  ajouter_inspiration: "`defaire`, ou Inspirations › la vidéo › supprimer.",
};

const PLATEFORMES_INSPIRATION = ["TikTok", "Instagram", "YouTube"] as const;

async function appelerEcritureVeille(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  let r: { summary: string; avertissement?: string | null };
  if (name === "suivre_compte") {
    const compte = texteArg(args, "compte");
    if (compte === "") throw new ToolError("« compte » : un @handle, un handle ou une URL de profil TikTok.");
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesVeille.ecrireSuivi, {
        ...cible,
        compte,
        ...(texteArg(args, "note") ? { note: texteArg(args, "note") } : {}),
      }),
    );
  } else if (name === "ne_plus_suivre") {
    r = await ecrire(() => ctx.runMutation(internal.mcpWritesVeille.ecrireRetraitSuivi, { ...cible, compte: texteArg(args, "compte") }));
  } else if (name === "noter_compte_suivi") {
    if (typeof args.note !== "string") throw new ToolError("« note » : le texte (vide = l'effacer).");
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesVeille.ecrireNoteSuivi, { ...cible, compte: texteArg(args, "compte"), note: args.note as string }),
    );
  } else if (name === "ajouter_inspiration") {
    const lien = texteArg(args, "lien");
    if (cleDeLienPost(lien) === null) throw new ToolError("« lien » : le lien de la vidéo ou du profil.");
    const pf = detectPostUrlPlatform(lien);
    const plateforme = PLATEFORMES_INSPIRATION.find((p) => p === pf);
    if (!plateforme) throw new ToolError("Les inspirations viennent de TikTok, Instagram ou YouTube.");
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesVeille.ecrireInspiration, {
        ...cible,
        lien,
        plateforme,
        type: isAccountOnlyUrl(lien, plateforme) ? "account" : "video",
        ...(texteArg(args, "titre") ? { titre: texteArg(args, "titre") } : {}),
        ...(texteArg(args, "notes") ? { notes: texteArg(args, "notes") } : {}),
        tags: textesArg(args, "tags"),
      }),
    );
  } else {
    throw new ToolError(`Outil inconnu : ${name}.`);
  }
  return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], r.avertissement ? { avertissement: r.avertissement } : {});
}

/** Le domaine « veille » : interrupteur « Peut modifier la veille ». */
export const DOMAINE_VEILLE: DomaineEcriture = {
  scope: "veille",
  outils: OUTILS_ECRITURE_VEILLE,
  droits: {
    suivre_compte: "radar.use",
    ne_plus_suivre: "radar.use",
    noter_compte_suivi: "radar.use",
    ajouter_inspiration: "library.manage",
  },
  appeler: appelerEcritureVeille,
};
