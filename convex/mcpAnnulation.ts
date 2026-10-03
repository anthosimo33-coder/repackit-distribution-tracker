/**
 * DE QUOI DÉFAIRE une modification faite par Claude — gardé au journal
 * (`mcpWriteLog.annulation`) au moment même où elle est écrite.
 *
 * Chaque type porte l'état d'AVANT et ce qui a été ÉCRIT (`apres`). L'outil
 * `defaire` (convex/mcpDefaire) ne restaure l'avant que si la base montre
 * encore exactement l'après : une valeur changée depuis — à l'écran ou par une
 * autre modification — n'est jamais écrasée, le refus le dit.
 *
 * Absent = la modification ne se défait pas par Claude (un email parti, une
 * publication confirmée, un abandon) : le journal dit où agir à l'écran.
 *
 * Module de VALIDATEURS seulement : importé par convex/schema.ts.
 */

import { v, type Infer } from "convex/values";

const plage = v.object({ startMin: v.number(), endMin: v.number() });

const part = v.object({
  id: v.string(),
  amount: v.number(),
  usage: v.string(),
  note: v.optional(v.string()),
  countedAs: v.optional(v.string()),
});

export const annulationValidator = v.union(
  // ── Missions ──────────────────────────────────────────────────────────────
  /** assigner_scripts, rejouer_script : les missions créées. */
  v.object({ type: v.literal("missionsCreees"), assignmentIds: v.array(v.id("assignments")) }),
  /** lancer_experience : l'expérience et ses missions. */
  v.object({
    type: v.literal("experienceCreee"),
    experienceId: v.id("hookExperiments"),
    assignmentIds: v.array(v.id("assignments")),
  }),
  /** changer_compte_cible : le compte d'une cible, avant et après. */
  v.object({
    type: v.literal("compteCible"),
    assignmentId: v.id("assignments"),
    platform: v.string(),
    avant: v.id("comptes"),
    apres: v.id("comptes"),
  }),
  /** replanifier_mission : jour, plage et/ou échéance de production, avant et après. */
  v.object({
    type: v.literal("planning"),
    assignmentId: v.id("assignments"),
    jour: v.optional(v.object({ avant: v.union(v.number(), v.null()), apres: v.union(v.number(), v.null()) })),
    plage: v.optional(v.object({ avant: v.union(plage, v.null()), apres: v.union(plage, v.null()) })),
    echeance: v.optional(v.object({ avant: v.number(), apres: v.number() })),
  }),
  /** consigne_mission : consigne et/ou texte à incruster, avant et après. */
  v.object({
    type: v.literal("consigne"),
    assignmentId: v.id("assignments"),
    consigne: v.optional(v.object({ avant: v.union(v.string(), v.null()), apres: v.union(v.string(), v.null()) })),
    incruste: v.optional(v.object({ avant: v.union(v.string(), v.null()), apres: v.union(v.string(), v.null()) })),
  }),
  // ── Scripts ───────────────────────────────────────────────────────────────
  /** creer_campagne : la campagne créée (et ses briques). */
  v.object({ type: v.literal("campagneCreee"), campaignId: v.id("scriptCampaigns") }),
  /** ajouter_hooks, ajouter_flux_cta : les briques créées. */
  v.object({ type: v.literal("briquesCreees"), brickIds: v.array(v.id("scriptBricks")) }),
  /** activer_briques : les briques réellement basculées, et leur état d'avant. */
  v.object({
    type: v.literal("briquesActives"),
    apres: v.boolean(),
    briques: v.array(v.object({ brickId: v.id("scriptBricks"), avant: v.boolean() })),
  }),
  // ── Publications ──────────────────────────────────────────────────────────
  /** marquer_warmup : `null` = « non qualifié » (champ absent), pas « promo ». */
  v.object({
    type: v.literal("warmup"),
    publicationId: v.id("publications"),
    avant: v.union(v.boolean(), v.null()),
    apres: v.boolean(),
  }),
  // ── Veille & bibliothèque ─────────────────────────────────────────────────
  /**
   * suivre_compte : le compte suivi (ses vidéos relevées partent avec). Le
   * handle sert si le compte a été retiré puis re-suivi depuis (nouvel id).
   */
  v.object({ type: v.literal("veilleSuivi"), accountId: v.id("radarAccounts"), handle: v.optional(v.string()) }),
  /** ne_plus_suivre : de quoi le suivre à nouveau. */
  v.object({ type: v.literal("veilleRetire"), handle: v.string(), note: v.union(v.string(), v.null()) }),
  /** noter_compte_suivi : la note, avant et après. */
  v.object({
    type: v.literal("veilleNote"),
    accountId: v.id("radarAccounts"),
    avant: v.union(v.string(), v.null()),
    apres: v.union(v.string(), v.null()),
  }),
  /** ajouter_inspiration : l'inspiration créée. */
  v.object({ type: v.literal("inspirationCreee"), inspirationId: v.id("inspirations") }),
  // ── Compta ────────────────────────────────────────────────────────────────
  /** ventiler_virement : la ventilation (et l'annotation d'avant les parts). */
  v.object({
    type: v.literal("ventilation"),
    lineId: v.id("whopLedgerLines"),
    avant: v.object({
      parts: v.union(v.array(part), v.null()),
      usage: v.union(v.string(), v.null()),
      note: v.union(v.string(), v.null()),
    }),
    apres: v.union(v.array(part), v.null()),
  }),
  /** relever_solde : le relevé du jour, les destinations, et si le compte est né là. */
  v.object({
    type: v.literal("releve"),
    accountId: v.id("comptaAccounts"),
    compteCree: v.boolean(),
    day: v.string(),
    avant: v.union(v.number(), v.null()),
    apres: v.number(),
    destinationsAvant: v.array(v.string()),
  }),
  /** marquer_mis_de_cote_paye : la ligne créée. */
  v.object({ type: v.literal("misDeCote"), useId: v.id("comptaProvisionUses") }),
  /** ajouter_charge : la charge créée. */
  v.object({ type: v.literal("chargeAjoutee"), chargeId: v.id("comptaCharges") }),
  /** supprimer_charge : de quoi la recréer. */
  v.object({
    type: v.literal("chargeSupprimee"),
    charge: v.object({
      day: v.string(),
      label: v.string(),
      category: v.string(),
      amount: v.number(),
      currency: v.string(),
      recurring: v.boolean(),
    }),
  }),
  /** classer_type_whop : la colonne d'avant (`null` = non classé) et celle posée. */
  v.object({ type: v.literal("regle"), lineType: v.string(), avant: v.union(v.string(), v.null()), apres: v.string() }),
);

export type Annulation = Infer<typeof annulationValidator>;
