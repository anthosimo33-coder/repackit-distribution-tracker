/**
 * OUTILS MCP D'ÉCRITURE — les SCRIPTS (interrupteur « Peut modifier les
 * scripts »), droit `scripts.manage` : celui de l'écran d'une campagne.
 *
 *  - `ajouter_hooks` : des hooks écrits par Claude, créés DÉSACTIVÉS par défaut
 *    — aucun tirage ne les sert avant qu'une personne les ait relus ;
 *  - `activer_briques` : allumer ou éteindre des briques en une fois (le banc
 *    de montage) ;
 *  - `graduer_hook` : le bouton « Graduer » (copie dans les ouvertures prouvées
 *    + désactivation de l'original, dans la même transaction).
 *
 * Une brique se désigne par son LIBELLÉ, tel que l'outil `scripts` le montre, ou
 * par un morceau de son texte.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mcpWriteMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  AJOUTE,
  ARG_PROJET,
  designerOuRefuser,
  ecrire,
  ECRIT,
  journaliser,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
  type EcritureCtx,
} from "./mcpWriteCommon";
import { designer, roleBriqueDepuis } from "./mcpWriteArgs";
import { createBrickCore, graduateHookCore, hookLabelOf, setBricksActiveCore } from "./scripts";
import { hookIdentityKey, PROVEN_CAMPAIGN_NAME } from "./graduation";

// ─── Déclaration des outils ─────────────────────────────────────────────────

const ARG_CAMPAGNE = { type: "string", description: "Nom de la campagne, comme dans l'outil `scripts`." } as const;

export const OUTILS_ECRITURE_SCRIPTS: readonly McpTool[] = [
  {
    name: "ajouter_hooks",
    title: "Ajouter des hooks à une campagne",
    description:
      "MODIFIE les scripts : ajoute des hooks (phrases d'ouverture) à une campagne. Ils sont créés DÉSACTIVÉS par défaut : aucun tirage ne les sert tant qu'une personne ne les a pas relus et activés (écran de la campagne, ou `activer_briques`). Un hook dont le texte existe déjà dans la campagne, actif ou non, n'est pas recréé. Son libellé court est le début du texte (60 caractères), comme à l'import de la bibliothèque.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: ARG_CAMPAGNE,
        hooks: {
          type: "array",
          description: "Les hooks, 20 au plus.",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              texte: { type: "string", description: "Le texte du hook, tel que la créatrice le dira." },
              consigne: { type: "string", description: "Consigne de tournage lue sous ce hook (facultatif)." },
            },
            required: ["texte"],
            additionalProperties: false,
          },
        },
        actifs: {
          type: "boolean",
          description: "true = les créer ACTIFS, donc tirables tout de suite. Défaut : désactivés.",
        },
      },
      required: ["campagne", "hooks"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "activer_briques",
    title: "Activer ou désactiver des briques",
    description:
      "MODIFIE les scripts : active ou désactive des briques (hooks, flux, cta) d'une campagne, toutes ou aucune. Une brique désactivée ne sort plus au tirage ; les missions déjà assignées gardent leur texte. Les briques se désignent par leur libellé (comme dans l'outil `scripts`) ou par un morceau de leur texte.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: ARG_CAMPAGNE,
        briques: {
          type: "array",
          description: "Libellés ou morceaux de texte des briques, 50 au plus.",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
        },
        role: { type: "string", description: "hook, flux ou cta — pour départager deux briques au libellé proche." },
        actif: { type: "boolean", description: "true = activer, false = désactiver." },
      },
      required: ["campagne", "briques", "actif"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "graduer_hook",
    title: "Graduer un hook",
    description: `MODIFIE les scripts : gradue un hook qui a fait ses preuves, comme le bouton « Graduer ». Il est COPIÉ dans la campagne « ${PROVEN_CAMPAIGN_NAME} » et DÉSACTIVÉ dans sa campagne d'origine, en une fois. S'il y est déjà, l'original est seulement désactivé.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: { type: "string", description: "Campagne d'origine du hook (ex. le LAB)." },
        hook: { type: "string", description: "Libellé du hook (outil `scripts`) ou morceau de son texte." },
      },
      required: ["campagne", "hook"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

// ─── Désigner une campagne, une brique ──────────────────────────────────────

async function campagneDe(ctx: EcritureCtx, nom: string): Promise<Doc<"scriptCampaigns">> {
  const toutes = await ctx.db
    .query("scriptCampaigns")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  return designerOuRefuser(toutes, (c) => c.name, nom, "campagnes");
}

/**
 * Une brique par son libellé (ce que l'outil `scripts` montre), sinon par un
 * morceau de son texte. `null` + le problème, pour les refus groupés.
 */
function briqueDe(
  briques: readonly Doc<"scriptBricks">[],
  demande: string,
): { ok: true; brique: Doc<"scriptBricks"> } | { ok: false; probleme: string } {
  const parLibelle = designer(briques, (b) => b.label, demande);
  if (parLibelle.ok) return { ok: true, brique: parLibelle.item };
  const candidats =
    parLibelle.candidats.length > 0 ? parLibelle.candidats : (() => {
      const parTexte = designer(briques, (b) => b.content, demande);
      return parTexte.ok ? [parTexte.item] : parTexte.candidats;
    })();
  if (candidats.length === 1) return { ok: true, brique: candidats[0] };
  return {
    ok: false,
    probleme:
      candidats.length === 0
        ? `« ${demande} » : aucune brique`
        : `« ${demande} » : plusieurs briques (${candidats.slice(0, 6).map((b) => `${b.kind} « ${b.label} »`).join(", ")})`,
  };
}

// ─── Écritures ──────────────────────────────────────────────────────────────

export const ecrireHooks = mcpWriteMutation("scripts.manage", "scripts")({
  args: {
    campagne: v.string(),
    hooks: v.array(v.object({ texte: v.string(), consigne: v.optional(v.string()) })),
    actifs: v.boolean(),
  },
  handler: async (ctx, a) => {
    const campagne = await campagneDe(ctx, a.campagne);
    const existants = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign_kind", (q) => q.eq("campaignId", campagne._id).eq("kind", "hook"))
      .collect();
    // La même identité de texte que la graduation (emojis, ponctuation, casse) :
    // un hook déjà là, même éteint, n'est pas recréé.
    const vus = new Set(existants.map((b) => hookIdentityKey(b.content)));
    const ajoutes: string[] = [];
    const crees: Id<"scriptBricks">[] = [];
    const doublons: string[] = [];
    for (const h of a.hooks) {
      const texte = h.texte.trim();
      if (texte === "") continue;
      const cle = hookIdentityKey(texte);
      if (vus.has(cle)) {
        doublons.push(texte);
        continue;
      }
      vus.add(cle);
      const label = hookLabelOf(texte);
      const id = await createBrickCore(ctx, {
        campaignId: campagne._id,
        kind: "hook",
        label,
        content: texte,
        ...(h.consigne?.trim() ? { instruction: h.consigne } : {}),
        active: a.actifs,
      });
      crees.push(id);
      ajoutes.push(label);
    }
    const summary =
      `« ${campagne.name} » : ${ajoutes.length} hook${ajoutes.length > 1 ? "s" : ""} ajouté${ajoutes.length > 1 ? "s" : ""}` +
      (ajoutes.length > 0 ? ` (${a.actifs ? "actif" : "désactivé"}${ajoutes.length > 1 ? "s" : ""})` : "") +
      (doublons.length > 0 ? `, ${doublons.length} déjà présent${doublons.length > 1 ? "s" : ""}` : "");
    if (ajoutes.length > 0) {
      await journaliser(ctx, {
        tool: "ajouter_hooks",
        summary,
        section: "campaign",
        path: `scripts/${campagne._id}`,
        annulation: { type: "briquesCreees", brickIds: crees },
      });
    }
    return { summary, ajoutes, doublons };
  },
});

export const ecrireActivation = mcpWriteMutation("scripts.manage", "scripts")({
  args: {
    campagne: v.string(),
    briques: v.array(v.string()),
    role: v.optional(v.union(v.literal("hook"), v.literal("flux"), v.literal("cta"))),
    actif: v.boolean(),
  },
  handler: async (ctx, a) => {
    const campagne = await campagneDe(ctx, a.campagne);
    const briques = (
      await ctx.db
        .query("scriptBricks")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campagne._id))
        .collect()
    ).filter((b) => (a.role === undefined || b.kind === a.role) && (b.kind === "hook" || b.kind === "flux" || b.kind === "cta"));
    // Tout ou rien, comme le lot de l'écran : on désigne TOUT avant d'écrire.
    const choisies = new Map<string, Doc<"scriptBricks">>();
    const problemes: string[] = [];
    for (const demande of a.briques) {
      const r = briqueDe(briques, demande);
      if (r.ok) choisies.set(r.brique._id, r.brique);
      else problemes.push(r.probleme);
    }
    if (problemes.length > 0) {
      throw err(
        ERR.MCP_DESIGNATION,
        `Rien n'a changé dans « ${campagne.name} » — ${problemes.join(" ; ")}. Précise le libellé (outil \`scripts\`) ou « role ».`,
      );
    }
    const ids = [...choisies.keys()] as Id<"scriptBricks">[];
    const basculees = [...choisies.values()].filter((b) => b.active !== a.actif);
    const { touched } = await setBricksActiveCore(ctx, { ids, active: a.actif });
    const libelles = [...choisies.values()].map((b) => `${b.kind} « ${b.label} »`);
    const deja = ids.length - touched;
    const summary =
      `« ${campagne.name} » : ${touched} brique${touched > 1 ? "s" : ""} ${a.actif ? "activée" : "désactivée"}${touched > 1 ? "s" : ""}` +
      (deja > 0 ? ` (${deja} l'étai${deja > 1 ? "en" : ""}t déjà)` : "") +
      ` — ${libelles.join(", ")}`;
    if (touched > 0) {
      await journaliser(ctx, {
        tool: "activer_briques",
        summary,
        section: "campaign",
        path: `scripts/${campagne._id}`,
        annulation: {
          type: "briquesActives",
          apres: a.actif,
          briques: basculees.map((b) => ({ brickId: b._id, avant: b.active })),
        },
      });
    }
    return { summary };
  },
});

export const ecrireGraduation = mcpWriteMutation("scripts.manage", "scripts")({
  args: { campagne: v.string(), hook: v.string() },
  handler: async (ctx, a) => {
    const campagne = await campagneDe(ctx, a.campagne);
    const hooks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign_kind", (q) => q.eq("campaignId", campagne._id).eq("kind", "hook"))
      .collect();
    const r = briqueDe(hooks, a.hook);
    if (!r.ok) throw err(ERR.MCP_DESIGNATION, `${r.probleme} parmi les hooks de « ${campagne.name} ».`);
    const g = await graduateHookCore(ctx, r.brique._id);
    const summary =
      g.outcome === "graduated"
        ? `« ${r.brique.label} » copié dans « ${g.targetCampaignName} », désactivé dans « ${campagne.name} »`
        : `« ${r.brique.label} » était déjà dans « ${g.targetCampaignName} » : désactivé dans « ${campagne.name} »`;
    await journaliser(ctx, { tool: "graduer_hook", summary, section: "campaign", path: `scripts/${campagne._id}` });
    return { summary };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  ajouter_hooks: "Scripts › la campagne › supprime les hooks ajoutés (désactivés, ils ne sortent dans aucun tirage).",
  activer_briques: "Rappelle activer_briques avec l'état inverse, ou Scripts › la campagne › le banc de montage.",
  graduer_hook: `Scripts › « ${PROVEN_CAMPAIGN_NAME} » › supprime la copie, puis réactive l'original dans sa campagne.`,
};

async function appelerEcritureScripts(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const campagne = texteArg(args, "campagne");
  if (campagne === "") throw new ToolError("« campagne » : le nom de la campagne (outil `scripts`).");
  let r: { summary: string; doublons?: string[] };
  if (name === "ajouter_hooks") {
    const hooks = (Array.isArray(args.hooks) ? args.hooks : []).map((h, i) => {
      const o = (typeof h === "object" && h !== null ? h : {}) as Record<string, unknown>;
      const texte = typeof o.texte === "string" ? o.texte.trim() : "";
      if (texte === "") throw new ToolError(`Hook ${i + 1} : « texte » vide.`);
      return { texte, ...(typeof o.consigne === "string" && o.consigne.trim() !== "" ? { consigne: o.consigne.trim() } : {}) };
    });
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesScripts.ecrireHooks, { ...cible, campagne, hooks, actifs: args.actifs === true }),
    );
  } else if (name === "activer_briques") {
    if (typeof args.actif !== "boolean") throw new ToolError("« actif » : true pour activer, false pour désactiver.");
    const roleBrut = texteArg(args, "role");
    const role = roleBrut === "" ? undefined : roleBriqueDepuis(roleBrut);
    if (role === null) throw new ToolError("« role » : hook, flux ou cta.");
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesScripts.ecrireActivation, {
        ...cible,
        campagne,
        briques: textesArg(args, "briques"),
        ...(role ? { role } : {}),
        actif: args.actif as boolean,
      }),
    );
  } else if (name === "graduer_hook") {
    const hook = texteArg(args, "hook");
    if (hook === "") throw new ToolError("« hook » : son libellé (outil `scripts`) ou un morceau de son texte.");
    r = await ecrire(() => ctx.runMutation(internal.mcpWritesScripts.ecrireGraduation, { ...cible, campagne, hook }));
  } else {
    throw new ToolError(`Outil inconnu : ${name}.`);
  }
  return resultatEcriture(
    projet,
    r.summary,
    OU_DEFAIRE[name],
    r.doublons && r.doublons.length > 0 ? { dejaPresents: r.doublons } : {},
  );
}

/** Le domaine « scripts » : interrupteur « Peut modifier les scripts ». */
export const DOMAINE_SCRIPTS: DomaineEcriture = {
  scope: "scripts",
  outils: OUTILS_ECRITURE_SCRIPTS,
  droits: Object.fromEntries(OUTILS_ECRITURE_SCRIPTS.map((t) => [t.name, "scripts.manage" as const])),
  appeler: appelerEcritureScripts,
};
