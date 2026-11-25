/**
 * OUTIL MCP D'ÉCRITURE — la BIBLIOTHÈQUE d'inspirations (interrupteur
 * « Inspirations » de « Connecter Claude »).
 *
 *  - `ajouter_inspiration` : une vidéo ou un compte dans la bibliothèque
 *    d'inspirations (droit `library.manage`), réutilisable ensuite comme vidéo
 *    exemple à l'assignation. Une inspiration se désigne par son lien.
 *
 * Les comptes suivis du Radar (`suivre_compte`, `ne_plus_suivre`,
 * `noter_compte_suivi`) ont quitté Jarvia avec lui le 20/11/2026 : la veille de
 * comptes vit désormais dans Kopycat. Le domaine garde sa clé `veille`, déjà
 * enregistrée dans les réglages d'accès MCP.
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
  etatsCrees,
  journaliser,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { cleDeLienPost } from "./mcpWriteArgs";
import { createInspirationCore } from "./inspirations";
import { detectPostUrlPlatform, isAccountOnlyUrl } from "./postUrlShape";

// ─── Déclaration des outils ─────────────────────────────────────────────────

export const OUTILS_ECRITURE_VEILLE: readonly McpTool[] = [
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
  if (name === "ajouter_inspiration") {
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

/** Le domaine « veille » : interrupteur « Inspirations ». */
export const DOMAINE_VEILLE: DomaineEcriture = {
  scope: "veille",
  outils: OUTILS_ECRITURE_VEILLE,
  droits: {
    ajouter_inspiration: "library.manage",
  },
  appeler: appelerEcritureVeille,
};
