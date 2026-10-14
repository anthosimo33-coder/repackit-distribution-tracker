/**
 * OUTILS MCP D'ÉCRITURE — les SCRIPTS (interrupteur « Peut modifier les
 * scripts »), droit `scripts.manage` : celui de l'écran d'une campagne.
 *
 *  - `ajouter_hooks` : des hooks écrits par Claude, créés DÉSACTIVÉS par défaut
 *    — aucun tirage ne les sert avant qu'une personne les ait relus ;
 *  - `ajouter_notifs` : des notifs (texte affiché à l'écran comme une
 *    notification), désactivées par défaut elles aussi ;
 *  - `modifier_briques` : le TEXTE de briques existantes (et consigne,
 *    direction, exemples d'un hook libre) — le geste « Modifier » de l'écran ;
 *  - `activer_briques` : allumer ou éteindre des briques en une fois (le banc
 *    de montage) ;
 *  - `graduer_hook` : le bouton « Graduer » (copie dans les ouvertures prouvées
 *    + désactivation de l'original, dans la même transaction).
 *
 * Une brique se désigne par son LIBELLÉ, tel que l'outil `scripts` le montre, ou
 * par un morceau de son texte.
 *
 * Le même interrupteur ouvre les outils des SCÉNARIOS de conversation
 * (convex/mcpScenarios) : même droit, même écran de campagne.
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
  etatsApres,
  etatsCrees,
  jsonCanonique,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
  type EcritureCtx,
} from "./mcpWriteCommon";
import { designer, roleBriqueDepuis } from "./mcpWriteArgs";
import {
  createBrickCore,
  createCampaignCore,
  graduateHookCore,
  hookLabelOf,
  setBricksActiveCore,
  updateBrickCore,
} from "./scripts";
import { enDur, VARIABLES, variablesInconnues } from "./scenarioFiche";
import { plierTexte } from "./mcpWriteArgs";
import { hookIdentityKey, PROVEN_CAMPAIGN_NAME } from "./graduation";
import { MAX_AUTRES_EXEMPLES } from "./hookLibre";
import { isNotifEnabled } from "./scriptNotif";
import { appelerEcritureScenarios, NOMS_ECRITURE_SCENARIOS, OUTILS_ECRITURE_SCENARIOS } from "./mcpScenarios";

// ─── Déclaration des outils ─────────────────────────────────────────────────

const ARG_CAMPAGNE = { type: "string", description: "Nom de la campagne, comme dans l'outil `scripts`." } as const;

export const OUTILS_ECRITURE_SCRIPTS: readonly McpTool[] = [
  {
    name: "ajouter_hooks",
    title: "Ajouter des hooks à une campagne",
    description:
      "MODIFIE les scripts : ajoute des hooks (phrases d'ouverture) à une campagne. Ils sont créés DÉSACTIVÉS par défaut : aucun tirage ne les sert tant qu'une personne ne les a pas relus et activés (écran de la campagne, ou `activer_briques`). Un hook dont le texte existe déjà dans la campagne, actif ou non, n'est pas recréé. Son libellé court est le début du texte (60 caractères), comme à l'import de la bibliothèque. Un hook LIBRE est une direction plutôt qu'une phrase : `texte` devient l'exemple principal, la créatrice tourne sa propre formulation, et les vues restent comptées sur ce hook.",
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
              texte: { type: "string", description: "Le texte du hook, tel que la créatrice le dira — l'exemple principal si le hook est libre." },
              consigne: { type: "string", description: "Consigne de tournage lue sous ce hook (facultatif)." },
              libre: {
                type: "boolean",
                description: "true = hook LIBRE : la créatrice reformule avec ses mots. Implicite dès qu'une `direction` ou des `exemples` sont donnés.",
              },
              direction: { type: "string", description: "Hook libre : l'idée à garder, lue au-dessus des exemples (facultatif)." },
              exemples: {
                type: "array",
                description: `Hook libre : d'autres formulations pour l'inspirer, ${MAX_AUTRES_EXEMPLES} au plus (en plus de \`texte\`).`,
                maxItems: MAX_AUTRES_EXEMPLES,
                items: { type: "string" },
              },
              autres_exemples: {
                type: "array",
                description: "Ancien nom de `exemples`, accepté aussi.",
                maxItems: MAX_AUTRES_EXEMPLES,
                items: { type: "string" },
              },
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
    name: "ajouter_flux_cta",
    title: "Ajouter des flux ou des CTA",
    description:
      "MODIFIE les scripts : ajoute des briques de corps (flux) ou de fin (cta) à une campagne, créées DÉSACTIVÉES par défaut comme les hooks. Une brique dont le texte existe déjà dans la campagne, pour ce rôle, n'est pas recréée.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: ARG_CAMPAGNE,
        role: { type: "string", description: "flux ou cta." },
        briques: {
          type: "array",
          description: "Les briques, 20 au plus.",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              texte: { type: "string", description: "Le texte, tel que la créatrice le dira." },
              consigne: { type: "string", description: "Consigne de tournage (facultatif)." },
            },
            required: ["texte"],
            additionalProperties: false,
          },
        },
        actives: { type: "boolean", description: "true = les créer ACTIVES. Défaut : désactivées." },
      },
      required: ["campagne", "role", "briques"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "ajouter_notifs",
    title: "Ajouter des notifs à une campagne",
    description:
      "MODIFIE les scripts : ajoute des notifs à une campagne — le texte que la créatrice affiche à l'écran comme une notification, une par vidéo, tiré en rotation. Créées DÉSACTIVÉES par défaut, comme les hooks. Une notif dont le texte existe déjà dans la campagne n'est pas recréée. Elles ne partent que si la campagne a « Notif dans la vidéo » allumée (écran de la campagne).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: ARG_CAMPAGNE,
        notifs: {
          type: "array",
          description: "Les notifs, 20 au plus.",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              texte: { type: "string", description: "Le texte de la notif, tel qu'il s'affiche." },
              consigne: { type: "string", description: "Consigne lue sous la notif (facultatif)." },
            },
            required: ["texte"],
            additionalProperties: false,
          },
        },
        actives: { type: "boolean", description: "true = les créer ACTIVES. Défaut : désactivées." },
      },
      required: ["campagne", "notifs"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "modifier_briques",
    title: "Modifier le texte de briques",
    description: `MODIFIE les scripts : remplace le texte de briques EXISTANTES d'une campagne (hook, flux, cta, notif) — et, au besoin, leur consigne de tournage, leur libellé court, et pour un hook libre sa direction et ses autres exemples. Comme « Modifier » à l'écran : les statistiques restent attachées à la brique ; les missions DÉJÀ assignées gardent leur texte, les prochaines tirent le nouveau. Une brique se désigne par son libellé (outil \`scripts\`) ou par un morceau de son texte ; tout ou rien (une brique introuvable ou ambiguë : rien ne change). Variables permises, remplies avec la fiche de la conversation tirée : ${VARIABLES.map((x) => `{${x}}`).join(", ")}. La réponse signale une durée ou une relation encore écrite en dur. Se défait.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: ARG_CAMPAGNE,
        briques: {
          type: "array",
          description: "Les briques à modifier, 20 au plus.",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              brique: { type: "string", description: "Libellé de la brique (outil `scripts`) ou un morceau de son texte actuel." },
              role: { type: "string", description: "hook, flux, cta ou notif — pour départager." },
              texte: { type: "string", description: "Le nouveau texte, entier." },
              consigne: { type: "string", description: "La nouvelle consigne de tournage ; \"\" la retire." },
              libelle: { type: "string", description: "Nouveau libellé court (facultatif)." },
              direction: { type: "string", description: "Hook libre : la nouvelle direction ; \"\" la retire." },
              exemples: {
                type: "array",
                description: `Hook libre : les autres formulations, ${MAX_AUTRES_EXEMPLES} au plus (remplace la liste ; [] la vide).`,
                maxItems: MAX_AUTRES_EXEMPLES,
                items: { type: "string" },
              },
            },
            required: ["brique"],
            additionalProperties: false,
          },
        },
      },
      required: ["campagne", "briques"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "creer_campagne",
    title: "Créer une campagne de scripts",
    description:
      "MODIFIE les scripts : crée une campagne et ses briques — hooks (ouvertures), flux (corps), cta (fins). Toutes les briques sont créées DÉSACTIVÉES par défaut : la campagne n'entre dans aucun tirage tant qu'une personne ne les a pas relues et activées. Il faut au moins un hook, un flux et un cta actifs pour qu'un script se monte (hook + flux + cta).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        nom: { type: "string", description: "Nom de la campagne (unique dans le projet)." },
        hooks: { type: "array", description: "Textes des hooks, 20 au plus.", items: { type: "string" }, maxItems: 20 },
        flux: { type: "array", description: "Textes des flux, 20 au plus.", items: { type: "string" }, maxItems: 20 },
        ctas: { type: "array", description: "Textes des cta, 20 au plus.", items: { type: "string" }, maxItems: 20 },
        actives: { type: "boolean", description: "true = briques ACTIVES dès la création. Défaut : désactivées." },
      },
      required: ["nom"],
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
    hooks: v.array(
      v.object({
        texte: v.string(),
        consigne: v.optional(v.string()),
        libre: v.optional(v.boolean()),
        direction: v.optional(v.string()),
        autresExemples: v.optional(v.array(v.string())),
      }),
    ),
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
        ...(h.libre ? { libre: true, direction: h.direction, autresExemples: h.autresExemples } : {}),
        active: a.actifs,
      });
      crees.push(id);
      ajoutes.push(h.libre ? `${label} (libre)` : label);
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
        etats: await etatsCrees(ctx, "scriptBricks", crees),
      });
    }
    return { summary, ajoutes, doublons };
  },
});

/** Le texte d'une brique, pour reconnaître un doublon (accents, casse, blancs). */
const identite = (role: string, texte: string) => (role === "hook" ? hookIdentityKey(texte) : plierTexte(texte));

export const ecrireFluxCta = mcpWriteMutation("scripts.manage", "scripts")({
  args: {
    campagne: v.string(),
    role: v.union(v.literal("flux"), v.literal("cta")),
    briques: v.array(v.object({ texte: v.string(), consigne: v.optional(v.string()) })),
    actives: v.boolean(),
  },
  handler: async (ctx, a) => {
    const campagne = await campagneDe(ctx, a.campagne);
    const existantes = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign_kind", (q) => q.eq("campaignId", campagne._id).eq("kind", a.role))
      .collect();
    const vus = new Set(existantes.map((b) => identite(a.role, b.content)));
    const crees: Id<"scriptBricks">[] = [];
    const doublons: string[] = [];
    for (const b of a.briques) {
      const texte = b.texte.trim();
      if (texte === "") continue;
      if (vus.has(identite(a.role, texte))) {
        doublons.push(texte);
        continue;
      }
      vus.add(identite(a.role, texte));
      crees.push(
        await createBrickCore(ctx, {
          campaignId: campagne._id,
          kind: a.role,
          label: hookLabelOf(texte),
          content: texte,
          ...(b.consigne?.trim() ? { instruction: b.consigne } : {}),
          active: a.actives,
        }),
      );
    }
    const n = crees.length;
    const summary =
      `« ${campagne.name} » : ${n} ${a.role} ajouté${n > 1 ? "s" : ""}` +
      (n > 0 ? ` (${a.actives ? "actif" : "désactivé"}${n > 1 ? "s" : ""})` : "") +
      (doublons.length > 0 ? `, ${doublons.length} déjà présent${doublons.length > 1 ? "s" : ""}` : "");
    if (n > 0) {
      await journaliser(ctx, {
        tool: "ajouter_flux_cta",
        summary,
        section: "campaign",
        path: `scripts/${campagne._id}`,
        annulation: { type: "briquesCreees", brickIds: crees },
        etats: await etatsCrees(ctx, "scriptBricks", crees),
      });
    }
    return { summary, doublons };
  },
});

export const ecrireNotifs = mcpWriteMutation("scripts.manage", "scripts")({
  args: {
    campagne: v.string(),
    notifs: v.array(v.object({ texte: v.string(), consigne: v.optional(v.string()) })),
    actives: v.boolean(),
  },
  handler: async (ctx, a) => {
    const campagne = await campagneDe(ctx, a.campagne);
    const existantes = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign_kind", (q) => q.eq("campaignId", campagne._id).eq("kind", "notif"))
      .collect();
    const vus = new Set(existantes.map((b) => plierTexte(b.content)));
    const crees: Id<"scriptBricks">[] = [];
    const doublons: string[] = [];
    for (const n of a.notifs) {
      const texte = n.texte.trim();
      if (texte === "") continue;
      if (vus.has(plierTexte(texte))) {
        doublons.push(texte);
        continue;
      }
      vus.add(plierTexte(texte));
      crees.push(
        await createBrickCore(ctx, {
          campaignId: campagne._id,
          kind: "notif",
          label: hookLabelOf(texte),
          content: texte,
          ...(n.consigne?.trim() ? { instruction: n.consigne } : {}),
          active: a.actives,
        }),
      );
    }
    const k = crees.length;
    const summary =
      `« ${campagne.name} » : ${k} notif${k > 1 ? "s" : ""} ajoutée${k > 1 ? "s" : ""}` +
      (k > 0 ? ` (${a.actives ? "active" : "désactivée"}${k > 1 ? "s" : ""})` : "") +
      (doublons.length > 0 ? `, ${doublons.length} déjà présente${doublons.length > 1 ? "s" : ""}` : "");
    if (k > 0) {
      await journaliser(ctx, {
        tool: "ajouter_notifs",
        summary,
        section: "campaign",
        path: `scripts/${campagne._id}`,
        annulation: { type: "briquesCreees", brickIds: crees },
        etats: await etatsCrees(ctx, "scriptBricks", crees),
      });
    }
    return { summary, doublons, notifAllumee: isNotifEnabled(campagne) };
  },
});

/** Ce qu'une modification de brique écrit — et ce que `defaire` remet. */
type EtatBrique = {
  content: string;
  label: string;
  instruction: string | null;
  libre: boolean;
  direction: string | null;
  autresExemples: string[];
};
const etatDe = (b: Doc<"scriptBricks">): EtatBrique => ({
  content: b.content,
  label: b.label,
  instruction: b.instruction ?? null,
  libre: b.libre === true,
  direction: b.direction ?? null,
  autresExemples: b.autresExemples ?? [],
});

export const ecrireModificationBriques = mcpWriteMutation("scripts.manage", "scripts")({
  args: {
    campagne: v.string(),
    briques: v.array(
      v.object({
        brique: v.string(),
        role: v.optional(v.union(v.literal("hook"), v.literal("flux"), v.literal("cta"), v.literal("notif"))),
        texte: v.optional(v.string()),
        consigne: v.optional(v.string()),
        libelle: v.optional(v.string()),
        direction: v.optional(v.string()),
        exemples: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const campagne = await campagneDe(ctx, a.campagne);
    const toutes = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campagne._id))
      .collect();
    // Tout ou rien : on désigne et on vérifie TOUT avant d'écrire.
    const problemes: string[] = [];
    const choix: { brique: Doc<"scriptBricks">; demande: (typeof a.briques)[number] }[] = [];
    for (const d of a.briques) {
      const r = briqueDe(d.role ? toutes.filter((b) => b.kind === d.role) : toutes, d.brique);
      if (!r.ok) {
        problemes.push(r.probleme);
        continue;
      }
      if (choix.some((c) => c.brique._id === r.brique._id)) problemes.push(`« ${d.brique} » : désignée deux fois`);
      else if (d.texte !== undefined && d.texte.trim() === "") problemes.push(`« ${d.brique} » : texte vide`);
      else if ((d.direction !== undefined || d.exemples !== undefined) && r.brique.kind !== "hook") {
        problemes.push(`« ${d.brique} » : direction et exemples ne valent que pour un hook`);
      } else if ([d.texte, d.consigne, d.libelle, d.direction, d.exemples].every((x) => x === undefined)) {
        problemes.push(`« ${d.brique} » : rien à modifier`);
      } else choix.push({ brique: r.brique, demande: d });
    }
    if (problemes.length > 0) {
      throw err(
        ERR.MCP_DESIGNATION,
        `Rien n'a changé dans « ${campagne.name} » — ${problemes.join(" ; ")}. Précise le libellé (outil \`scripts\`) ou « role ».`,
      );
    }
    const photos = await photographier(ctx, "scriptBricks", choix.map((c) => c.brique._id));
    const lignes: { brickId: Id<"scriptBricks">; avant: EtatBrique; apres: EtatBrique }[] = [];
    const alertes: string[] = [];
    for (const { brique, demande } of choix) {
      const direction = demande.direction?.trim();
      const exemples = demande.exemples?.map((e) => e.trim()).filter((e) => e !== "");
      // Une direction ou des exemples donnés rendent le hook libre (comme ajouter_hooks).
      const devientLibre = brique.kind === "hook" && ((direction ?? "") !== "" || (exemples?.length ?? 0) > 0);
      await updateBrickCore(ctx, {
        id: brique._id,
        ...(demande.texte !== undefined ? { content: demande.texte.trim() } : {}),
        ...(demande.libelle !== undefined && demande.libelle.trim() !== "" ? { label: demande.libelle.trim() } : {}),
        ...(demande.consigne !== undefined ? { instruction: demande.consigne.trim() === "" ? null : demande.consigne } : {}),
        ...(direction !== undefined ? { direction: direction === "" ? null : direction } : {}),
        ...(exemples !== undefined ? { autresExemples: exemples } : {}),
        ...(devientLibre && !brique.libre ? { libre: true } : {}),
      });
      const apres = (await ctx.db.get(brique._id))!;
      if (jsonCanonique(etatDe(apres)) === jsonCanonique(etatDe(brique))) continue;
      lignes.push({ brickId: brique._id, avant: etatDe(brique), apres: etatDe(apres) });
      const textes = [apres.content, apres.direction ?? "", ...(apres.autresExemples ?? [])];
      const durs = [...new Set(textes.flatMap(enDur))];
      const inconnues = [...new Set(textes.flatMap(variablesInconnues))];
      if (apres.kind !== "notif" && durs.length > 0) {
        alertes.push(`${apres.kind} « ${apres.label} » : « ${durs.join(" », « ")} » écrit en dur — utilise {duree} / {DUREE} ou {relation}.`);
      }
      if (inconnues.length > 0) {
        alertes.push(`${apres.kind} « ${apres.label} » : variable inconnue ${inconnues.map((x) => `{${x}}`).join(", ")} — elle resterait telle quelle.`);
      }
    }
    if (lignes.length === 0) return { summary: `« ${campagne.name} » : rien n'a changé (mêmes textes).`, alertes, inchange: true };
    const summary =
      `« ${campagne.name} » : ${lignes.length} brique${lignes.length > 1 ? "s" : ""} modifiée${lignes.length > 1 ? "s" : ""} — ` +
      lignes
        .map((l) => {
          const b = choix.find((c) => c.brique._id === l.brickId)!.brique;
          return `${b.kind} « ${l.apres.label} »`;
        })
        .join(", ");
    await journaliser(ctx, {
      tool: "modifier_briques",
      summary,
      section: "campaign",
      path: `scripts/${campagne._id}`,
      annulation: { type: "briquesModifiees", briques: lignes },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, alertes, inchange: false };
  },
});

export const ecrireCampagne = mcpWriteMutation("scripts.manage", "scripts")({
  args: {
    nom: v.string(),
    hooks: v.array(v.string()),
    flux: v.array(v.string()),
    ctas: v.array(v.string()),
    actives: v.boolean(),
  },
  handler: async (ctx, a) => {
    const nom = a.nom.trim();
    const toutes = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    if (toutes.some((c) => plierTexte(c.name) === plierTexte(nom))) {
      throw err(ERR.MCP_DESIGNATION, `Une campagne « ${nom} » existe déjà : choisis un autre nom, ou ajoute-lui des briques.`);
    }
    const campaignId = await createCampaignCore(ctx, { name: nom });
    const compte: Record<"hook" | "flux" | "cta", number> = { hook: 0, flux: 0, cta: 0 };
    const briquesCreees: Id<"scriptBricks">[] = [];
    for (const [role, textes] of [["hook", a.hooks], ["flux", a.flux], ["cta", a.ctas]] as const) {
      const vus = new Set<string>();
      for (const brut of textes) {
        const texte = brut.trim();
        if (texte === "" || vus.has(identite(role, texte))) continue;
        vus.add(identite(role, texte));
        briquesCreees.push(await createBrickCore(ctx, { campaignId, kind: role, label: hookLabelOf(texte), content: texte, active: a.actives }));
        compte[role]++;
      }
    }
    const summary =
      `Campagne « ${nom} » créée : ${compte.hook} hook(s), ${compte.flux} flux, ${compte.cta} cta` +
      (compte.hook + compte.flux + compte.cta > 0 ? (a.actives ? ", actifs" : ", désactivés") : "");
    await journaliser(ctx, {
      tool: "creer_campagne",
      summary,
      section: "campaign",
      path: `scripts/${campaignId}`,
      annulation: { type: "campagneCreee", campaignId },
      etats: [...(await etatsCrees(ctx, "scriptCampaigns", [campaignId])), ...(await etatsCrees(ctx, "scriptBricks", briquesCreees))],
    });
    return { summary };
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
    const photos = await photographier(ctx, "scriptBricks", basculees.map((b) => b._id));
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
        etats: await etatsApres(ctx, photos),
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
    const photos = await photographier(ctx, "scriptBricks", [r.brique._id]);
    const g = await graduateHookCore(ctx, r.brique._id);
    const summary =
      g.outcome === "graduated"
        ? `« ${r.brique.label} » copié dans « ${g.targetCampaignName} », désactivé dans « ${campagne.name} »`
        : `« ${r.brique.label} » était déjà dans « ${g.targetCampaignName} » : désactivé dans « ${campagne.name} »`;
    await journaliser(ctx, {
      tool: "graduer_hook",
      summary,
      section: "campaign",
      path: `scripts/${campagne._id}`,
      etats: [
        ...(await etatsApres(ctx, photos)),
        ...(g.outcome === "graduated" ? await etatsCrees(ctx, "scriptBricks", [g.targetBrickId]) : []),
      ],
    });
    return { summary };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  ajouter_flux_cta: "`defaire`, ou Scripts › la campagne › supprime les briques ajoutées (désactivées, elles ne sortent dans aucun tirage).",
  creer_campagne: "`defaire` (tant qu'aucune mission ne l'utilise), ou Scripts › la campagne › supprimer.",
  ajouter_hooks: "Scripts › la campagne › supprime les hooks ajoutés (désactivés, ils ne sortent dans aucun tirage).",
  ajouter_notifs: "`defaire` (tant qu'aucune mission ne les a reçues), ou Scripts › la campagne › onglet Notif.",
  modifier_briques: "`defaire` (tant que personne ne les a remodifiées), ou Scripts › la campagne › la brique › Modifier.",
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
  if (name === "creer_campagne") {
    const nom = texteArg(args, "nom");
    if (nom === "") throw new ToolError("« nom » : le nom de la nouvelle campagne.");
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesScripts.ecrireCampagne, {
        ...cible,
        nom,
        hooks: textesArg(args, "hooks"),
        flux: textesArg(args, "flux"),
        ctas: textesArg(args, "ctas"),
        actives: args.actives === true,
      }),
    );
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name]);
  }
  const campagne = texteArg(args, "campagne");
  if (campagne === "") throw new ToolError("« campagne » : le nom de la campagne (outil `scripts`).");
  let r: { summary: string; doublons?: string[]; notifAllumee?: boolean };
  if (name === "ajouter_flux_cta") {
    const role = roleBriqueDepuis(args.role);
    if (role !== "flux" && role !== "cta") throw new ToolError("« role » : flux ou cta (les hooks : ajouter_hooks).");
    const briques = (Array.isArray(args.briques) ? args.briques : []).map((b, i) => {
      const o = (typeof b === "object" && b !== null ? b : {}) as Record<string, unknown>;
      const texte = typeof o.texte === "string" ? o.texte.trim() : "";
      if (texte === "") throw new ToolError(`Brique ${i + 1} : « texte » vide.`);
      return { texte, ...(typeof o.consigne === "string" && o.consigne.trim() !== "" ? { consigne: o.consigne.trim() } : {}) };
    });
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesScripts.ecrireFluxCta, { ...cible, campagne, role, briques, actives: args.actives === true }),
    );
  } else if (name === "ajouter_hooks") {
    const hooks = (Array.isArray(args.hooks) ? args.hooks : []).map((h, i) => {
      const o = (typeof h === "object" && h !== null ? h : {}) as Record<string, unknown>;
      const texte = typeof o.texte === "string" ? o.texte.trim() : "";
      if (texte === "") throw new ToolError(`Hook ${i + 1} : « texte » vide.`);
      const direction = typeof o.direction === "string" ? o.direction.trim() : "";
      // `exemples` (nom de la spec) ou `autres_exemples` (premier nom) : les deux.
      const exemples = o.exemples ?? o.autres_exemples;
      const autresExemples = Array.isArray(exemples)
        ? exemples.filter((e): e is string => typeof e === "string" && e.trim() !== "")
        : [];
      // Une direction ou des exemples n'ont de sens que sur un hook libre :
      // les donner suffit à le rendre libre.
      const libre = o.libre === true || direction !== "" || autresExemples.length > 0;
      return {
        texte,
        ...(typeof o.consigne === "string" && o.consigne.trim() !== "" ? { consigne: o.consigne.trim() } : {}),
        ...(libre
          ? {
              libre: true,
              ...(direction !== "" ? { direction } : {}),
              ...(autresExemples.length > 0 ? { autresExemples } : {}),
            }
          : {}),
      };
    });
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesScripts.ecrireHooks, { ...cible, campagne, hooks, actifs: args.actifs === true }),
    );
  } else if (name === "ajouter_notifs") {
    const notifs = (Array.isArray(args.notifs) ? args.notifs : []).map((n, i) => {
      const o = (typeof n === "object" && n !== null ? n : {}) as Record<string, unknown>;
      const texte = typeof o.texte === "string" ? o.texte.trim() : "";
      if (texte === "") throw new ToolError(`Notif ${i + 1} : « texte » vide.`);
      return { texte, ...(typeof o.consigne === "string" && o.consigne.trim() !== "" ? { consigne: o.consigne.trim() } : {}) };
    });
    if (notifs.length === 0) throw new ToolError("« notifs » : au moins une notif.");
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesScripts.ecrireNotifs, { ...cible, campagne, notifs, actives: args.actives === true }),
    );
  } else if (name === "modifier_briques") {
    const roles = new Set(["hook", "flux", "cta", "notif"]);
    const briques = (Array.isArray(args.briques) ? args.briques : []).map((b, i) => {
      const o = (typeof b === "object" && b !== null ? b : {}) as Record<string, unknown>;
      const brique = typeof o.brique === "string" ? o.brique.trim() : "";
      if (brique === "") throw new ToolError(`Brique ${i + 1} : « brique » (son libellé ou un morceau de son texte).`);
      const role = typeof o.role === "string" && o.role.trim() !== "" ? (roleBriqueDepuis(o.role) ?? o.role.trim()) : undefined;
      if (role !== undefined && !roles.has(role)) throw new ToolError(`Brique ${i + 1} : « role » = hook, flux, cta ou notif.`);
      const str = (k: string) => (typeof o[k] === "string" ? { [k]: o[k] as string } : {});
      return {
        brique,
        ...(role ? { role: role as "hook" | "flux" | "cta" | "notif" } : {}),
        ...str("texte"),
        ...str("consigne"),
        ...str("libelle"),
        ...str("direction"),
        ...(Array.isArray(o.exemples) ? { exemples: o.exemples.filter((e): e is string => typeof e === "string") } : {}),
      };
    });
    if (briques.length === 0) throw new ToolError("« briques » : au moins une brique à modifier.");
    const m = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesScripts.ecrireModificationBriques, { ...cible, campagne, briques }),
    );
    return resultatEcriture(projet, m.summary, m.inchange ? "Rien à défaire." : OU_DEFAIRE[name], {
      ...(m.alertes.length > 0 ? { attention: m.alertes } : {}),
      aSavoir: "Les missions déjà assignées gardent leur texte ; les prochaines assignations tirent le nouveau.",
    });
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
  return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], {
    ...(r.doublons && r.doublons.length > 0 ? { dejaPresents: r.doublons } : {}),
    ...(r.notifAllumee === false
      ? { attention: "La notif est éteinte sur cette campagne : ces notifs ne partiront qu'une fois « Notif dans la vidéo » allumée (écran de la campagne)." }
      : {}),
  });
}

const OUTILS_DOMAINE_SCRIPTS = [...OUTILS_ECRITURE_SCRIPTS, ...OUTILS_ECRITURE_SCENARIOS];

/** Le domaine « scripts » : interrupteur « Peut modifier les scripts » — briques ET scénarios. */
export const DOMAINE_SCRIPTS: DomaineEcriture = {
  scope: "scripts",
  outils: OUTILS_DOMAINE_SCRIPTS,
  droits: Object.fromEntries(OUTILS_DOMAINE_SCRIPTS.map((t) => [t.name, "scripts.manage" as const])),
  appeler: (ctx, name, args, cible, projet) =>
    NOMS_ECRITURE_SCENARIOS.has(name)
      ? appelerEcritureScenarios(ctx, name, args, cible, projet)
      : appelerEcritureScripts(ctx, name, args, cible, projet),
};
