/**
 * OUTIL MCP D'ÉCRITURE — les BARÈMES (interrupteur « Barèmes », éteint par
 * défaut), droit `pricing.manage` : celui de l'écran Barèmes.
 *
 *  - `changer_bareme` : passe les vidéos d'une créatrice sur un autre barème à
 *    partir d'un jour, comme « Appliquer à ses vidéos » de l'écran. `simuler`
 *    montre la liste sans rien écrire (l'aperçu de l'écran).
 *
 * C'est de l'ARGENT : un interrupteur à lui, pour qu'ouvrir les missions à
 * Claude ne lui ouvre pas la paie. Le geste est celui de l'écran
 * (`changerBaremeCore`), journalisé avec chaque vidéo avant/après, et `defaire`
 * remet l'ancien barème de chaque vidéo tant qu'aucune n'a bougé ni n'est entrée
 * dans un cycle payé.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { creatorScopeFor, mcpPermissionQuery, mcpWriteMutation, type ProjectQueryCtx } from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  ARG_PROJET,
  designerOuRefuser,
  ECRIT,
  ecrire,
  etatsApres,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { jourTexte } from "./mcpWriteArgs";
import { resolveCreatorKind } from "./roles";
import { resolvePayCurrency } from "./payCurrency";
import type { PricingSnapshot } from "./pricing";
import { changerBaremeCore, planChangementBareme } from "./pricingReassign";
import { jourValide, type RefusBareme } from "./pricingReassignPlan";

/** Au-delà, le journal (chaque vidéo en entier, avant et après) déborderait. */
export const MAX_VIDEOS_PAR_APPEL = 60;

export const OUTILS_ECRITURE_BAREMES: readonly McpTool[] = [
  {
    name: "changer_bareme",
    title: "Changer le barème de vidéos déjà attribuées",
    description:
      "MODIFIE la paie : passe les vidéos d'une créatrice sur un autre barème à partir d'un jour — jour de publication, sinon jour prévu —, vidéos PUBLIÉES comprises, comme « Appliquer à ses vidéos » de l'écran Barèmes. Leur fixe, nombre de vidéos, CPM, condition de vues et bonus par vidéo deviennent ceux du barème. Jamais touchées, et listées avec la raison : les vidéos d'un cycle déjà PAYÉ, de défi, ou sans barème. La grille de paliers de la créatrice ne change pas. Aucun email. Appelle d'abord avec « simuler » et montre la liste ; puis écris avec « attendu » = le nombre de vidéos à changer annoncé. Journalisé ; `defaire` remet l'ancien barème de chaque vidéo.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Nom de la créatrice (outil `createatrices`)." },
        bareme: { type: "string", description: "Nom du barème à appliquer (outil `paiements` ou écran Barèmes)." },
        a_partir_du: { type: "string", description: "Premier jour concerné, AAAA-MM-JJ (Paris), inclus. Un jour passé est permis : c'est l'usage (« depuis son nouveau contrat »)." },
        jusqu_au: { type: "string", description: "Dernier jour concerné, AAAA-MM-JJ, inclus. Défaut : sans fin." },
        simuler: { type: "boolean", description: "true = n'écrit rien : montre chaque vidéo, son barème actuel et ce qui la laisse." },
        attendu: { type: "integer", description: "Le nombre de vidéos à changer annoncé par la simulation : un écart (vidéo publiée ou payée entre-temps) refuse l'écriture.", minimum: 0 },
      },
      required: ["createatrice", "bareme", "a_partir_du"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

const RAISON: Record<RefusBareme, string> = {
  cycle_paye: "laissée : son cycle de paie est payé (montant gelé)",
  defi: "laissée : vidéo de défi, payée par le barème du défi",
  hors_bareme: "laissée : pas de barème (payée autrement)",
  deja: "déjà sur ce barème",
};

const STATUTS: Record<string, string> = {
  todo: "à faire",
  in_progress: "en cours",
  video_submitted: "vidéo envoyée",
  video_rejected: "vidéo à refaire",
  to_publish: "à publier",
  published: "publiée",
  paid: "payée",
};

const demandeValidator = {
  createatrice: v.string(),
  bareme: v.string(),
  du: v.string(),
  au: v.optional(v.string()),
};
type Demande = { createatrice: string; bareme: string; du: string; au?: string };

/** La créatrice et le barème désignés par leur NOM, dans le périmètre de la personne. */
async function designer(ctx: ProjectQueryCtx, d: Demande) {
  const creatrices = filterByCreatorScope(
    await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    (c) => c._id,
    await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
  ).filter((c) => resolveCreatorKind(c.kind) === "partner");
  const creatrice = designerOuRefuser(creatrices, (c) => c.name, d.createatrice, "créatrices");
  const baremes = await ctx.db
    .query("pricings")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  const bareme = designerOuRefuser(baremes, (p) => p.name, d.bareme, "barèmes");
  return { creatrice, bareme };
}

/** Les termes d'un snapshot, dans la devise qu'il porte (résolue). */
function termes(s: PricingSnapshot, devise: string | null) {
  return {
    fixe: s.montantFixe,
    nbVideos: s.nbVideosCible,
    cpm: s.tauxCPM,
    ...(s.seuilVuesFixe ? { fixeConditionneA: `${s.seuilVuesFixe} vues` } : {}),
    devise,
  };
}

const jourDe = (ts: number) => jourTexte(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(ts));

/** Ce que la simulation et l'écriture montrent du plan. */
async function decrire(ctx: ProjectQueryCtx, d: Demande) {
  const { creatrice, bareme } = await designer(ctx, d);
  const plan = await planChangementBareme(ctx, {
    creatorId: creatrice._id,
    pricingId: bareme._id,
    du: d.du,
    ...(d.au !== undefined ? { au: d.au } : {}),
  });
  const project = await ctx.db.get(ctx.projectId);
  const devise = (s: PricingSnapshot) => resolvePayCurrency(s.currency, project?.payCurrency);
  const aChanger = plan.videos.filter((x) => x.refus === null);
  return {
    demande: { creatorId: creatrice._id, pricingId: bareme._id, du: d.du, ...(d.au !== undefined ? { au: d.au } : {}) },
    aChanger,
    vue: {
      createatrice: plan.creator.name,
      bareme: {
        nom: plan.pricing.name,
        ...termes(plan.cible, devise(plan.cible)),
        ...(plan.pricing.videoBonus && plan.pricing.videoBonus.tiers.length > 0
          ? {
              bonusParVideo: {
                cumulables: plan.pricing.videoBonus.cumulative,
                paliers: plan.pricing.videoBonus.tiers.map((t) => ({ vues: t.seuilVues, montant: t.montant })),
              },
            }
          : {}),
      },
      ...(plan.devise.compatible
        ? {}
        : {
            deviseIncompatible: `${plan.creator.name} est payée en ${(plan.devise.createatrice ?? "?").toUpperCase()}, ce barème est en ${(plan.devise.bareme ?? "?").toUpperCase()} : l'écriture sera refusée.`,
          }),
      aChanger: aChanger.length,
      laissees: plan.videos.length - aChanger.length,
      videos: plan.videos.map((x) => {
        const s = x.a.pricingSnapshot;
        return {
          jour: jourTexte(x.jour),
          statut: STATUTS[x.a.status] ?? x.a.status,
          ...(x.cycle ? { cycleDePaie: `${jourDe(x.cycle.start)} → ${jourDe(x.cycle.end)}` } : {}),
          baremeActuel: s ? (plan.noms.get(s.pricingId) ?? "barème supprimé") : null,
          ...(s ? { termesActuels: termes(s, devise(s)) } : {}),
          suite: x.refus === null ? `passe sur « ${plan.pricing.name} »` : RAISON[x.refus],
        };
      }),
    },
  };
}

export const simulerBareme = mcpPermissionQuery("pricing.manage")({
  args: demandeValidator,
  handler: async (ctx, d) => (await decrire(ctx, d)).vue,
});

export const ecrireBareme = mcpWriteMutation("pricing.manage", "baremes")({
  args: { ...demandeValidator, attendu: v.optional(v.number()) },
  handler: async (ctx, d) => {
    const { demande, aChanger, vue } = await decrire(ctx, d);
    if (aChanger.length > MAX_VIDEOS_PAR_APPEL) {
      throw err(
        ERR.MCP_DESIGNATION,
        `${aChanger.length} vidéos d'un coup : ${MAX_VIDEOS_PAR_APPEL} au plus par appel. Découpe la plage avec « jusqu_au ».`,
      );
    }
    const photos = await photographier(ctx, "assignments", aChanger.map((x) => x.a._id));
    // Le geste de l'écran, sur le même plan (même transaction : même liste).
    const r = await changerBaremeCore(ctx, { ...demande, ...(d.attendu !== undefined ? { attendu: d.attendu } : {}) });
    const plage = d.au ? `du ${jourTexte(d.du)} au ${jourTexte(d.au)}` : `à partir du ${jourTexte(d.du)}`;
    if (r.changements.length === 0) {
      return { summary: `${vue.createatrice} ${plage} : aucune vidéo à passer sur « ${vue.bareme.nom} » — rien n'a changé`, vue };
    }
    const summary =
      `${vue.createatrice} ${plage} : ${r.changements.length} vidéo(s) passée(s) sur « ${vue.bareme.nom} »` +
      (vue.laissees > 0 ? ` (${vue.laissees} laissée(s))` : "");
    await journaliser(ctx, {
      tool: "changer_bareme",
      summary,
      section: "pricing",
      path: "pricings",
      annulation: {
        type: "bareme",
        lignes: r.changements.map((c) => ({
          assignmentId: c.assignmentId,
          avant: JSON.stringify(c.avant),
          apres: JSON.stringify(c.apres),
        })),
      },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, vue };
  },
});

// ─── L'appel de l'outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE =
  "`defaire` remet l'ancien barème de chaque vidéo (tant qu'aucune n'a changé de barème ni n'est entrée dans un cycle payé) ; sinon écran Barèmes › le barème d'avant › « Appliquer à ses vidéos ».";

function jourArg(args: Record<string, unknown>, cle: string): string {
  const j = texteArg(args, cle);
  if (!jourValide(j)) throw new ToolError(`« ${cle} » : « ${j} » n'est pas un jour AAAA-MM-JJ.`);
  return j;
}

async function appelerEcritureBaremes(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name !== "changer_bareme") throw new ToolError(`Outil inconnu : ${name}.`);
  const createatrice = texteArg(args, "createatrice");
  const bareme = texteArg(args, "bareme");
  if (createatrice === "") throw new ToolError("« createatrice » : son nom, comme dans l'outil `createatrices`.");
  if (bareme === "") throw new ToolError("« bareme » : le nom du barème à appliquer.");
  const demande = {
    createatrice,
    bareme,
    du: jourArg(args, "a_partir_du"),
    ...(texteArg(args, "jusqu_au") !== "" ? { au: jourArg(args, "jusqu_au") } : {}),
  };
  if (args.simuler === true) {
    const vue = await ecrire(() =>
      ctx.runQuery(internal.mcpBaremes.simulerBareme, { userId: cible.userId, projectId: cible.projectId, ...demande }),
    );
    return resultatEcriture(projet, "Simulation : rien n'a été écrit.", "Rien à défaire.", {
      simulation: vue,
      suite: `Pour écrire : rappelle changer_bareme sans « simuler », avec attendu: ${vue.aChanger}.`,
    });
  }
  if (args.attendu !== undefined && (typeof args.attendu !== "number" || !Number.isInteger(args.attendu) || args.attendu < 0)) {
    throw new ToolError("« attendu » : un nombre entier de vidéos.");
  }
  const r = await ecrire(() =>
    ctx.runMutation(internal.mcpBaremes.ecrireBareme, {
      ...cible,
      ...demande,
      ...(typeof args.attendu === "number" ? { attendu: args.attendu } : {}),
    }),
  );
  return resultatEcriture(projet, r.summary, OU_DEFAIRE, { detail: r.vue });
}

/** Le domaine « baremes » : interrupteur « Peut modifier les barèmes ». */
export const DOMAINE_BAREMES: DomaineEcriture = {
  scope: "baremes",
  outils: OUTILS_ECRITURE_BAREMES,
  droits: { changer_bareme: "pricing.manage" },
  appeler: appelerEcritureBaremes,
};
