/**
 * DÉFAIRE une modification faite par Claude — `modifications` (le journal du
 * projet, numéroté) et `defaire` (rang + outil).
 *
 * Chaque écriture réversible a gardé au journal l'état d'AVANT et ce qu'elle a
 * ÉCRIT (convex/mcpAnnulation). Défaire, c'est restaurer l'avant par le MÊME
 * cœur que l'écran — et seulement si la base montre encore exactement l'après :
 * une valeur changée depuis (à l'écran, par une autre modification) n'est
 * jamais écrasée, le refus dit ce qu'il trouve.
 *
 * La garde est celle de l'écriture d'origine : le domaine de la modification
 * doit être autorisé pour CETTE connexion, et la personne doit avoir le droit
 * du bouton (`exigerEcritureMcp`). On ne défait que ses propres modifications
 * (le journal est par personne), sur 30 jours.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { PermissionId } from "./permissions";
import { exigerEcritureMcp, mcpWriteMutationDifferee, type McpWriteScope } from "./functions";
import { ERR, err } from "./errorCodes";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import { ARG_PROJET, ecrire, journaliser, resultatEcriture, texteArg, type CibleEcriture } from "./mcpWriteCommon";
import type { Annulation } from "./mcpAnnulation";
import { DOMAINES_ECRITURE } from "./mcpWriteDomains";
import {
  deleteAssignmentCore,
  setAssignmentTargetAccountCore,
  setAssignmentInstructionsCore,
  setAssignmentOverlayTextCore,
  setAssignmentPostDateCore,
  setAssignmentPostWindowCore,
} from "./assignments";
import { deleteBricksCore, deleteCampaignCore, setBricksActiveCore } from "./scripts";
import { addRadarAccountCore, removeRadarAccountCore, updateRadarAccountNoteCore } from "./radar";
import { deleteInspirationCore } from "./inspirations";
import type { Plateforme } from "./platforms";
import { setPublicationWarmupCore } from "./publications";
import {
  addComptaChargeCore,
  deleteAccountReadingCore,
  deleteComptaAccountCore,
  deleteComptaChargeCore,
  deleteProvisionUseCore,
  removeLineRuleCore,
  saveAccountReadingCore,
  setLineRuleCore,
  ventilateTransferCore,
} from "./compta";
import { representativePostedAt } from "./calendarStatus";

const FENETRE_MS = 30 * 86_400_000;
const LIMITE = 30;

// ─── Déclaration des outils ─────────────────────────────────────────────────

export const OUTILS_DEFAIRE: readonly McpTool[] = [
  {
    name: "modifications",
    title: "Modifications faites par Claude",
    description:
      "Le journal des modifications que Claude a faites pour toi sur ce projet (30 derniers jours), la plus récente d'abord : rang, quand, outil, ce qui a changé, et si elle se défait (ou pourquoi pas, ou quand elle l'a été). Le rang sert à `defaire`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        limite: { type: "integer", description: "Nombre de modifications listées (défaut 15).", minimum: 1, maximum: LIMITE },
      },
      additionalProperties: false,
    },
  },
  {
    name: "defaire",
    title: "Défaire une modification",
    description:
      "MODIFIE : défait une modification faite par Claude, désignée par son rang dans `modifications` ET son outil (garde-fou si le journal a bougé). Restaure l'état d'avant par le même chemin que l'écran — seulement si rien n'a changé depuis ; sinon le refus dit ce qu'il trouve. Un email déjà parti ne se rattrape pas : la réponse le rappelle.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        rang: { type: "integer", description: "Rang dans `modifications` (1 = la plus récente).", minimum: 1, maximum: LIMITE },
        outil: { type: "string", description: "L'outil de cette modification, tel que `modifications` le montre (ex. replanifier_mission)." },
      },
      required: ["rang", "outil"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
];

/** Pourquoi une modification ne se défait pas par Claude. */
const NON_DEFAISABLE: Record<string, string> = {
  annuler_mission: "un abandon ne se défait pas : réassigne (assigner_scripts, ou rejouer_script).",
  relancer: "l'email de relance est parti.",
  confirmer_publication: "une publication confirmée ne se dé-publie pas : un mauvais lien se corrige dans Assignments › la mission › « Corriger le lien ».",
  valider_video: "la créatrice a reçu la validation et peut publier.",
  refuser_video: "la créatrice a reçu le motif ; elle renverra une vidéo, à valider à son retour.",
  graduer_hook: "à défaire à l'écran : supprimer la copie dans les ouvertures prouvées, puis réactiver l'original.",
  envoyer_message_createatrice: "un message envoyé ne se reprend pas : écris-lui un nouveau message dans 3 jours.",
  defaire: "une annulation ne se défait pas : refais la modification.",
};

function pourquoiPas(l: Doc<"mcpWriteLog">): string {
  return NON_DEFAISABLE[l.tool] ?? "écrite avant que le Défaire existe : à défaire dans l'écran.";
}

/** Le domaine (interrupteur) et le droit (bouton) d'un outil d'écriture. */
function droitDe(tool: string): { scope: McpWriteScope; permission: PermissionId } | null {
  const d = DOMAINES_ECRITURE.find((x) => x.outils.some((t) => t.name === tool));
  const permission = d?.droits[tool];
  return d && permission ? { scope: d.scope, permission } : null;
}

// ─── Lecture du journal ─────────────────────────────────────────────────────

async function journalDuProjet(
  ctx: { db: QueryCtx["db"] },
  userId: Id<"users">,
  projectId: Id<"projects">,
  limite: number,
): Promise<Doc<"mcpWriteLog">[]> {
  const lignes = await ctx.db
    .query("mcpWriteLog")
    .withIndex("by_user_at", (q) => q.eq("userId", userId).gte("at", Date.now() - FENETRE_MS))
    .order("desc")
    .take(200);
  return lignes.filter((l) => l.projectId === projectId).slice(0, limite);
}

const instantParis = (ts: number) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);

/** `modifications` — le journal de la personne sur ce projet, numéroté. */
export const lireModifications = internalQuery({
  args: { userId: v.id("users"), projectId: v.id("projects"), limite: v.number() },
  handler: async (ctx, { userId, projectId, limite }) =>
    (await journalDuProjet(ctx, userId, projectId, limite)).map((l, i) => ({
      rang: i + 1,
      le: instantParis(l.at),
      outil: l.tool,
      fait: l.summary,
      via: l.via.name,
      etat:
        l.defaiteLe !== undefined
          ? `défaite le ${instantParis(l.defaiteLe)}`
          : l.annulation
            ? "se défait"
            : `ne se défait pas — ${pourquoiPas(l)}`,
    })),
});

// ─── Défaire ────────────────────────────────────────────────────────────────

type DefaireCtx = Parameters<typeof deleteAssignmentCore>[0];

const refus = (message: string) => err(ERR.MCP_UNDO_IMPOSSIBLE, message);

/** Les parts d'une ventilation, comparables quel que soit l'ordre des champs. */
const cleParts = (parts: readonly { id: string; amount: number; usage: string; note?: string; countedAs?: string }[] | null) =>
  JSON.stringify((parts ?? []).map((p) => [p.id, p.amount, p.usage, p.note ?? null, p.countedAs ?? null]));
const memePlage = (
  a: { startMin: number; endMin: number } | null | undefined,
  b: { startMin: number; endMin: number } | null | undefined,
) => (a ?? null) === null ? (b ?? null) === null : b != null && a!.startMin === b.startMin && a!.endMin === b.endMin;

/** Supprime les missions PAS COMMENCÉES (rien de produit, rien à perdre) ; garde les autres. */
async function supprimerNonCommencees(ctx: DefaireCtx, ids: readonly Id<"assignments">[]) {
  let supprimees = 0;
  const gardees: string[] = [];
  for (const id of ids) {
    const m = await ctx.db.get(id);
    if (!m) continue;
    if ((m.status === "todo" || m.status === "to_publish") && !m.submittedVideoStorageId && representativePostedAt(m) === null) {
      await deleteAssignmentCore(ctx, id);
      supprimees++;
    } else gardees.push(m.status);
  }
  return { supprimees, gardees };
}

/**
 * Restaure l'état d'avant d'UNE modification. Rend ce qui a été fait (une ou
 * deux phrases) ; lève un refus lisible si la base n'est plus dans l'état écrit.
 */
async function annuler(ctx: DefaireCtx, a: Annulation): Promise<string> {
  switch (a.type) {
    case "experienceCreee":
    case "missionsCreees": {
      const { supprimees, gardees } = await supprimerNonCommencees(ctx, a.assignmentIds);
      if (a.type === "experienceCreee" && supprimees > 0) {
        await ctx.db.patch(a.experienceId, { statut: "annulee" });
      }
      if (supprimees === 0) {
        throw refus(
          gardees.length === 0
            ? "Ces missions n'existent plus."
            : `Rien supprimé : ${gardees.length} mission(s) déjà commencée(s) (${gardees.join(", ")}) — abandonne-les plutôt (annuler_mission).`,
        );
      }
      return (
        `${supprimees} mission(s) supprimée(s), leurs scripts redeviennent disponibles` +
        (gardees.length > 0 ? ` ; ${gardees.length} gardée(s), déjà commencée(s) (${gardees.join(", ")})` : "") +
        ". L'email « nouvelle mission » était déjà parti."
      );
    }
    case "compteCible": {
      const m = await ctx.db.get(a.assignmentId);
      if (!m || m.status === "cancelled") throw refus("Cette mission n'existe plus, ou a été abandonnée.");
      const cible = (m.targets ?? []).find((t) => t.platform === a.platform);
      if (!cible || cible.accountId !== a.apres) throw refus("Le compte de cette cible a changé depuis : rien n'a été écrasé.");
      await setAssignmentTargetAccountCore(ctx, { id: m._id, platform: a.platform as Plateforme, accountId: a.avant });
      const ancien = await ctx.db.get(a.avant);
      return `Compte d'origine remis${ancien ? ` (${ancien.handle})` : ""}.`;
    }
    case "campagneCreee": {
      if (!(await ctx.db.get(a.campaignId))) throw refus("Cette campagne a déjà été supprimée.");
      const { deleted } = await deleteCampaignCore(ctx, a.campaignId);
      return `Campagne supprimée, avec ses ${deleted} brique(s).`;
    }
    case "veilleSuivi": {
      // Retiré puis re-suivi depuis (par `defaire` de ne_plus_suivre, ou à
      // l'écran) : même handle, autre id — c'est toujours « ce » compte suivi.
      const compte =
        (await ctx.db.get(a.accountId)) ??
        (a.handle === undefined
          ? null
          : await ctx.db
              .query("radarAccounts")
              .withIndex("by_project_handle", (q) => q.eq("projectId", ctx.projectId).eq("handle", a.handle!))
              .first());
      if (!compte) throw refus("Ce compte n'est déjà plus suivi.");
      await removeRadarAccountCore(ctx, compte._id);
      return "Compte retiré de la veille, avec les vidéos relevées.";
    }
    case "veilleRetire": {
      await addRadarAccountCore(ctx, a.handle, a.note ?? undefined);
      return "Compte suivi à nouveau : un nouveau relevé est lancé (les vidéos relevées avant le retrait sont perdues).";
    }
    case "veilleNote": {
      const compte = await ctx.db.get(a.accountId);
      if (!compte) throw refus("Ce compte n'est plus suivi.");
      if ((compte.note ?? null) !== a.apres) throw refus("La note a changé depuis : rien n'a été écrasé.");
      await updateRadarAccountNoteCore(ctx, a.accountId, a.avant ?? undefined);
      return "Note d'origine remise.";
    }
    case "inspirationCreee": {
      if (!(await ctx.db.get(a.inspirationId))) throw refus("Cette inspiration a déjà été supprimée.");
      await deleteInspirationCore(ctx, a.inspirationId);
      return "Inspiration retirée de la bibliothèque.";
    }
    case "planning": {
      const m = await ctx.db.get(a.assignmentId);
      if (!m || m.status === "cancelled") throw refus("Cette mission n'existe plus, ou a été abandonnée.");
      if (representativePostedAt(m) !== null) throw refus("Cette mission a été publiée depuis : sa date ne bouge plus.");
      if (a.jour && (m.postDate ?? null) !== a.jour.apres) throw refus("Le jour de cette mission a changé depuis : rien n'a été écrasé.");
      if (a.plage && !memePlage(m.postWindow, a.plage.apres)) throw refus("La plage horaire a changé depuis : rien n'a été écrasé.");
      if (a.jour) await setAssignmentPostDateCore(ctx, m._id, a.jour.avant ?? undefined);
      if (a.plage) await setAssignmentPostWindowCore(ctx, m._id, a.plage.avant ?? undefined);
      return "Jour et plage d'origine remis.";
    }
    case "consigne": {
      const m = await ctx.db.get(a.assignmentId);
      if (!m) throw refus("Cette mission n'existe plus.");
      if (a.consigne && (m.instructions ?? null) !== a.consigne.apres) throw refus("La consigne a changé depuis : rien n'a été écrasé.");
      if (a.incruste && (m.overlayText ?? null) !== a.incruste.apres) throw refus("Le texte à incruster a changé depuis : rien n'a été écrasé.");
      if (a.consigne) await setAssignmentInstructionsCore(ctx, m._id, a.consigne.avant ?? undefined);
      if (a.incruste) await setAssignmentOverlayTextCore(ctx, m._id, a.incruste.avant ?? undefined);
      return "Consigne d'origine remise.";
    }
    case "briquesCreees": {
      const existantes = (await Promise.all(a.brickIds.map((id) => ctx.db.get(id)))).filter(
        (b): b is Doc<"scriptBricks"> => b !== null,
      );
      if (existantes.length === 0) throw refus("Ces hooks ont déjà été supprimés.");
      // Un hook déjà TIRÉ dans une mission ne se supprime pas : son texte y vit.
      const ids = new Set<string>(existantes.map((b) => b._id));
      const servis = new Set<string>();
      for (const m of await ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()) {
        for (const id of [m.scriptCombo?.hookBrickId, m.scriptCombo?.fluxBrickId, m.scriptCombo?.ctaBrickId]) {
          if (id && ids.has(id)) servis.add(id);
        }
      }
      if (servis.size > 0) {
        const noms = existantes.filter((b) => servis.has(b._id)).map((b) => `« ${b.label} »`);
        throw refus(`Déjà tiré(s) dans une mission : ${noms.join(", ")}. Désactive-les plutôt (activer_briques).`);
      }
      const { deleted } = await deleteBricksCore(ctx, existantes.map((b) => b._id));
      return `${deleted} hook(s) supprimé(s).`;
    }
    case "briquesActives": {
      const docs = await Promise.all(a.briques.map((b) => ctx.db.get(b.brickId)));
      const changees = a.briques.filter((b, i) => docs[i] === null || docs[i]!.active !== a.apres);
      if (changees.length > 0) throw refus(`${changees.length} brique(s) supprimée(s) ou rebasculée(s) depuis : rien n'a été écrasé.`);
      for (const etat of [true, false]) {
        const ids = a.briques.filter((b) => b.avant === etat).map((b) => b.brickId);
        if (ids.length > 0) await setBricksActiveCore(ctx, { ids, active: etat });
      }
      return `${a.briques.length} brique(s) remise(s) dans leur état d'avant.`;
    }
    case "warmup": {
      const pub = await ctx.db.get(a.publicationId);
      if (!pub) throw refus("Ce post n'existe plus.");
      if ((pub.isWarmup === true) !== a.apres) throw refus("Ce post a été rebasculé depuis : rien n'a été écrasé.");
      await setPublicationWarmupCore(ctx, pub._id, a.avant === true);
      // « Non qualifié » n'est pas « promo » : le cœur stocke `false`, on rend
      // l'absence d'origine (même rémunération : seule `=== true` compte).
      if (a.avant === null) await ctx.db.patch(pub._id, { isWarmup: undefined });
      return a.avant === true ? "Remis en chauffe." : a.avant === false ? "Remis en promo." : "Remis comme avant : non qualifié.";
    }
    case "ventilation": {
      const ligne = await ctx.db.get(a.lineId);
      if (!ligne) throw refus("Ce virement n'existe plus.");
      if (cleParts(ligne.parts ?? null) !== cleParts(a.apres)) throw refus("La ventilation de ce virement a changé depuis : rien n'a été écrasé.");
      await ventilateTransferCore(ctx, { lineId: a.lineId, parts: a.avant.parts ?? [] });
      if (a.avant.usage !== null || a.avant.note !== null) {
        await ctx.db.patch(a.lineId, {
          ...(a.avant.usage !== null ? { usage: a.avant.usage } : {}),
          ...(a.avant.note !== null ? { note: a.avant.note } : {}),
        });
      }
      return a.avant.parts === null && a.avant.usage === null ? "Ventilation effacée, comme avant." : "Ventilation d'origine remise.";
    }
    case "releve": {
      const compte = await ctx.db.get(a.accountId);
      if (!compte) throw refus("Ce compte n'existe plus.");
      const releves = await ctx.db
        .query("comptaAccountReadings")
        .withIndex("by_account_day", (q) => q.eq("accountId", a.accountId))
        .collect();
      const releve = releves.find((r) => r.day === a.day);
      if (!releve || releve.amount !== a.apres) throw refus("Ce relevé a changé depuis : rien n'a été écrasé.");
      if (a.compteCree && releves.length === 1) {
        await deleteComptaAccountCore(ctx, a.accountId);
        return `Compte « ${compte.name} » retiré (il était né de ce relevé).`;
      }
      if (a.avant !== null) {
        await saveAccountReadingCore(ctx, { accountId: a.accountId, destinations: a.destinationsAvant, day: a.day, amount: a.avant });
        return "Relevé d'origine remis.";
      }
      await deleteAccountReadingCore(ctx, releve._id);
      await ctx.db.patch(a.accountId, { destinations: a.destinationsAvant });
      return "Relevé retiré.";
    }
    case "misDeCote": {
      if (!(await ctx.db.get(a.useId))) throw refus("Ce « marqué payé » a déjà été annulé.");
      await deleteProvisionUseCore(ctx, a.useId);
      return "« Marqué payé » annulé : l'argent revient dans le mis de côté.";
    }
    case "chargeAjoutee": {
      if (!(await ctx.db.get(a.chargeId))) throw refus("Cette charge a déjà été supprimée.");
      await deleteComptaChargeCore(ctx, { chargeId: a.chargeId });
      return "Charge supprimée.";
    }
    case "chargeSupprimee": {
      await addComptaChargeCore(ctx, a.charge);
      return "Charge recréée.";
    }
    case "regle": {
      const etat = await ctx.db
        .query("comptaState")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .first();
      const actuelle = etat?.rules.find((r) => r.lineType === a.lineType)?.bucket ?? null;
      if (actuelle !== a.apres) throw refus("Le classement de ce type a changé depuis : rien n'a été écrasé.");
      if (a.avant === null) await removeLineRuleCore(ctx, a.lineType);
      else await setLineRuleCore(ctx, { lineType: a.lineType, bucket: a.avant });
      return a.avant === null ? "Type remis en « non classé »." : "Classement d'origine remis.";
    }
  }
}

export const ecrireDefaire = mcpWriteMutationDifferee()({
  args: { rang: v.number(), outil: v.string() },
  handler: async (ctx, { rang, outil }) => {
    const journal = await journalDuProjet(ctx, ctx.userId, ctx.projectId, LIMITE);
    const l = journal[rang - 1];
    if (!l) throw refus(`Pas de modification n°${rang} sur ce projet (30 derniers jours) : relis \`modifications\`.`);
    if (l.tool !== outil) {
      throw refus(`La n°${rang} est « ${l.tool} » (${l.summary}), pas « ${outil} » : le journal a bougé, relis \`modifications\`.`);
    }
    if (l.defaiteLe !== undefined) throw refus(`Déjà défaite le ${instantParis(l.defaiteLe)}.`);
    if (!l.annulation) throw refus(`« ${l.summary} » ne se défait pas : ${pourquoiPas(l)}`);
    const droit = droitDe(l.tool);
    if (!droit) throw refus("Outil inconnu au journal.");
    // La garde de l'écriture d'origine : son domaine, son bouton.
    const via = await exigerEcritureMcp(ctx, droit.scope, droit.permission);
    const fait = await annuler(ctx, l.annulation);
    await ctx.db.patch(l._id, { defaiteLe: Date.now() });
    const summary = `Défait : ${l.summary} — ${fait}`;
    await journaliser(
      { db: ctx.db, userId: ctx.userId, projectId: ctx.projectId, via },
      { tool: "defaire", summary, section: l.section, ...(l.month ? { month: l.month } : {}), ...(l.path ? { path: l.path } : {}) },
    );
    return { summary };
  },
});

// ─── L'appel des outils ─────────────────────────────────────────────────────

export const NOMS_DEFAIRE = new Set(OUTILS_DEFAIRE.map((t) => t.name));

export async function appelerDefaire(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name === "modifications") {
    const limite = typeof args.limite === "number" ? args.limite : 15;
    const liste = await ctx.runQuery(internal.mcpDefaire.lireModifications, {
      userId: cible.userId,
      projectId: cible.projectId,
      limite,
    });
    return textResult(
      JSON.stringify(
        {
          projet,
          modifications: liste,
          lecture: "Pour défaire : `defaire` avec le rang ET l'outil. Seules tes modifications, par Claude, sur 30 jours.",
        },
        null,
        1,
      ),
    );
  }
  if (name === "defaire") {
    const outil = texteArg(args, "outil");
    if (typeof args.rang !== "number" || outil === "") throw new ToolError("« rang » et « outil », tels que `modifications` les montre.");
    const r = await ecrire(() => ctx.runMutation(internal.mcpDefaire.ecrireDefaire, { ...cible, rang: args.rang as number, outil }));
    return resultatEcriture(projet, r.summary, "Une annulation ne se défait pas : refais la modification si besoin.");
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}
