/**
 * RÉÉCRITURE DE MISSIONS PAR L'ÉQUIPE — le plan, calculé sans rien écrire.
 *
 * POURQUOI. L'écran corrige un script brique par brique, dans SA campagne et
 * avec des briques ACTIVES (editScriptCombo). Il ne sait ni déplacer une mission
 * vers une autre campagne, ni lui donner une brique désactivée (gardée hors du
 * tirage des autres créatrices), ni changer l'échéance de production une fois la
 * mission créée. Annuler puis réassigner en ferait une partie, au prix d'un
 * email « nouvelle mission » par vidéo et d'une activation temporaire des
 * briques. Ce module fait ces gestes SUR PLACE, pour une liste NOMMÉE de
 * missions, sans email.
 *
 * Il se lance à la main (convex/missionOps.ts, via scripts/convex-prod.sh),
 * jamais depuis un écran. Le plan se lit d'abord à blanc : chaque mission y
 * montre son avant / après.
 *
 * GARDE-FOUS, tous bloquants — un seul échec et RIEN n'est écrit :
 *  - une mission est désignée par son id ET par la créatrice et la campagne
 *    qu'on lui attend : une erreur de copier-coller ne touche pas la mission
 *    d'une autre créatrice ;
 *  - une mission publiée ne se réécrit jamais (même verrou que l'écran,
 *    representativePostedAt) ; changer son script exige en plus qu'elle ne soit
 *    pas encore tournée (todo / in_progress) ;
 *  - une brique doit appartenir à la campagne visée, avec le bon rôle. Elle
 *    peut être désactivée : c'est précisément le geste que l'écran refuse ;
 *  - une correction de texte exige de trouver le texte à corriger.
 *
 * REJOUABLE : une brique déjà créée est retrouvée par son texte, une correction
 * déjà faite est sautée, une mission déjà dans l'état visé n'est pas réécrite.
 *
 * Le combo réécrit est marqué `comboImposed` — c'est une combinaison CHOISIE,
 * exactement comme le mode « Combinaison choisie » de l'assignation : elle ne
 * retire rien de la rotation automatique. Unicité et cooldown ne bloquent donc
 * pas ; leurs conflits sont rendus en AVERTISSEMENTS, à lire dans le plan.
 *
 * Module PUR (aucun import `_generated`) : testé par lib/mission-ops-plan.test.ts.
 */
import { shiftDay } from "./analyticsDates";
import { COMBO_FREEING_STATUSES } from "./comboFreeing";
import { parisDayOf, parisDayStart } from "./managerCpm";

const DAY_MS = 24 * 60 * 60 * 1000;

export type OpsBrickKind = "hook" | "flux" | "cta" | "notif";

export interface OpsBrick {
  _id: string;
  campaignId: string;
  kind: string;
  label: string;
  content: string;
  active: boolean;
  instruction?: string;
}

export interface OpsCampaign {
  _id: string;
  name: string;
  status: "active" | "archived";
}

export interface OpsScriptCombo {
  campaignId: string;
  hookBrickId: string;
  corpsBrickId?: string;
  fluxBrickId: string;
  ctaBrickId: string;
  assembledScript: string;
  editedOnce?: boolean;
  notifBrickId?: string;
  notifText?: string;
}

export interface OpsAssignment {
  _id: string;
  creatorId: string;
  status: string;
  dueDate: number;
  postDate?: number;
  comboKey?: string;
  comboImposed?: boolean;
  instructions?: string;
  overlayText?: string;
  publishedAt?: number;
  targets?: { publishedAt?: number }[];
  scriptCombo?: OpsScriptCombo;
}

export interface MissionOpsRequest {
  /** Briques à créer — retrouvées par leur texte si elles existent déjà. */
  bricksToCreate?: {
    campaignId: string;
    kind: OpsBrickKind;
    content: string;
    /**
     * Nom court INTERNE (analytics, sélecteurs de l'écran). Absent = le texte,
     * comme avant. Pour un flux long, le texte en libellé est illisible.
     */
    label?: string;
    instruction?: string;
    active: boolean;
  }[];
  /** Consigne posée sur une brique existante (lue en direct par les fiches). */
  brickInstructions?: { brickId: string; instruction: string }[];
  /** Correction du texte d'une brique de bibliothèque (label compris). */
  brickTextFixes?: { brickId: string; from: string; to: string }[];
  /**
   * Même correction dans le texte FIGÉ d'une mission. Seul ce texte change :
   * ni briques, ni comboKey — le script reste celui qui a été assigné.
   */
  frozenTextFixes?: {
    assignmentId: string;
    expectCreatorId: string;
    from: string;
    to: string;
  }[];
  assignmentRewrites?: {
    assignmentId: string;
    expectCreatorId: string;
    /** Campagne actuelle attendue (ou déjà la campagne cible, en rejeu). */
    expectCampaignId: string;
    /** Nouveau script : hook + flux + cta (+ notif), éventuellement d'une autre campagne. */
    combo?: {
      campaignId: string;
      hookBrickId: string;
      fluxBrickId: string;
      ctaBrickId: string;
      /** Notif désignée par id… */
      notifBrickId?: string;
      /** …ou par son texte, pour une notif créée dans le MÊME passage. */
      notifContent?: string;
    };
    /** Échéance de production = fin du jour de publication prévu (Paris). */
    dueOnPostDay?: boolean;
    /** Échéance de production = fin de ce jour, AAAA-MM-JJ (Paris). */
    dueDay?: string;
    clearInstructions?: boolean;
    clearOverlayText?: boolean;
  }[];
  archiveCampaignIds?: string[];
}

export interface PlannedBrickCreate {
  /** Référence provisoire (« new:0 »), remplacée par l'id réel à l'écriture. */
  ref: string;
  campaignId: string;
  kind: OpsBrickKind;
  label: string;
  content: string;
  instruction?: string;
  active: boolean;
}

export interface PlannedBrickPatch {
  id: string;
  set: { content?: string; label?: string; instruction?: string };
  before: { content: string; label: string; instruction: string | null };
}

/** Ce qu'une créatrice lit, avant et après — de quoi relire le plan. */
export interface MissionView {
  campaign: string;
  script: string;
  notif: string | null;
  dueDay: string;
  instructions: string | null;
  overlayText: string | null;
}

export type ClearableField = "instructions" | "overlayText";

export interface PlannedAssignmentPatch {
  id: string;
  set: {
    scriptCombo?: OpsScriptCombo;
    comboKey?: string;
    comboImposed?: true;
    dueDate?: number;
  };
  clear: ClearableField[];
  before: MissionView;
  after: MissionView;
}

export interface PlannedCampaignPatch {
  id: string;
  name: string;
  set: { status: "archived" };
}

export interface MissionOpsPlan {
  brickCreates: PlannedBrickCreate[];
  brickPatches: PlannedBrickPatch[];
  assignmentPatches: PlannedAssignmentPatch[];
  campaignPatches: PlannedCampaignPatch[];
  /** Gestes sans effet (déjà faits) — un second passage n'y trouve que ça. */
  skipped: string[];
  /** Conflits d'unicité / cooldown et restes à relire : ne bloquent pas. */
  warnings: string[];
}

/** Erreur de plan : rien n'est écrit, le message dit quelle ligne a cassé. */
export class MissionOpsError extends Error {}

function fail(message: string): never {
  throw new MissionOpsError(message);
}

/** Fin du jour de Paris (23:59:59), la forme d'une échéance posée par l'écran. */
export function endOfParisDay(day: string): number | null {
  // Valider AVANT de décaler : shiftDay lève sur une chaîne qui n'est pas un jour.
  if (parisDayStart(day) === null) return null;
  const nextMidnight = parisDayStart(shiftDay(day, 1));
  return nextMidnight === null ? null : nextMidnight - 1000;
}

function assemble(hook: string, flux: string, cta: string): string {
  // Même montage que l'assignation (convex/scripts.assembleNoLabels).
  return [hook, flux, cta].map((s) => s.trim()).join("\n\n");
}

function isPublished(a: OpsAssignment): boolean {
  if ((a.targets ?? []).some((t) => typeof t.publishedAt === "number")) return true;
  return typeof a.publishedAt === "number";
}

function sameCombo(x: OpsScriptCombo | undefined, y: OpsScriptCombo): boolean {
  if (!x) return false;
  return (
    x.campaignId === y.campaignId &&
    x.hookBrickId === y.hookBrickId &&
    x.fluxBrickId === y.fluxBrickId &&
    x.ctaBrickId === y.ctaBrickId &&
    x.corpsBrickId === undefined &&
    x.assembledScript === y.assembledScript &&
    x.notifBrickId === y.notifBrickId &&
    x.notifText === y.notifText
  );
}

export function planMissionOps(input: {
  bricks: readonly OpsBrick[];
  campaigns: readonly OpsCampaign[];
  assignments: readonly OpsAssignment[];
  cooldownDays: number;
  request: MissionOpsRequest;
}): MissionOpsPlan {
  const { request } = input;
  const plan: MissionOpsPlan = {
    brickCreates: [],
    brickPatches: [],
    assignmentPatches: [],
    campaignPatches: [],
    skipped: [],
    warnings: [],
  };

  const campaigns = new Map(input.campaigns.map((c) => [c._id, c]));
  const campaignName = (id: string) => campaigns.get(id)?.name ?? id;
  // Bibliothèque de TRAVAIL : les corrections et créations de ce passage y sont
  // visibles aussitôt, pour que les scripts remontés plus bas les lisent.
  const bricks = new Map(input.bricks.map((b) => [b._id, { ...b }]));
  const assignments = new Map(input.assignments.map((a) => [a._id, a]));

  // ─── 1. Briques à créer ────────────────────────────────────────────────────
  for (const [i, c] of (request.bricksToCreate ?? []).entries()) {
    if (!campaigns.has(c.campaignId)) fail(`Brique « ${c.content} » : campagne inconnue (${c.campaignId}).`);
    const content = c.content.trim();
    if (content.length === 0) fail("Brique à créer : texte vide.");
    const existing = [...bricks.values()].find(
      (b) => b.campaignId === c.campaignId && b.kind === c.kind && b.content.trim() === content,
    );
    if (existing) {
      plan.skipped.push(`Brique ${c.kind} « ${content} » déjà dans « ${campaignName(c.campaignId)} » (${existing._id}).`);
      continue;
    }
    const instruction = c.instruction?.trim() || undefined;
    const label = c.label?.trim() || content;
    const created: PlannedBrickCreate = {
      ref: `new:${i}`,
      campaignId: c.campaignId,
      kind: c.kind,
      label,
      content,
      ...(instruction ? { instruction } : {}),
      active: c.active,
    };
    plan.brickCreates.push(created);
    bricks.set(created.ref, {
      _id: created.ref,
      campaignId: c.campaignId,
      kind: c.kind,
      label,
      content,
      active: c.active,
      ...(instruction ? { instruction } : {}),
    });
  }

  // ─── 2. Consignes et corrections de briques ────────────────────────────────
  const brickPatches = new Map<string, PlannedBrickPatch>();
  const patchBrick = (id: string, set: PlannedBrickPatch["set"]) => {
    const b = bricks.get(id)!;
    const entry =
      brickPatches.get(id) ??
      { id, set: {}, before: { content: b.content, label: b.label, instruction: b.instruction ?? null } };
    entry.set = { ...entry.set, ...set };
    brickPatches.set(id, entry);
    bricks.set(id, { ...b, ...set });
  };

  for (const { brickId, instruction } of request.brickInstructions ?? []) {
    const b = bricks.get(brickId);
    if (!b) fail(`Consigne : brique inconnue (${brickId}).`);
    const text = instruction.trim();
    if (text.length === 0) fail(`Consigne vide pour « ${b.content} ».`);
    if (b.instruction === text) {
      plan.skipped.push(`Consigne déjà posée sur « ${b.content} ».`);
      continue;
    }
    patchBrick(brickId, { instruction: text });
  }

  for (const { brickId, from, to } of request.brickTextFixes ?? []) {
    const b = bricks.get(brickId);
    if (!b) fail(`Correction : brique inconnue (${brickId}).`);
    if (!b.content.includes(from)) {
      if (b.content.includes(to)) {
        plan.skipped.push(`« ${from} » déjà corrigé dans « ${b.content} ».`);
        continue;
      }
      fail(`Correction : « ${from} » introuvable dans la brique « ${b.content} ».`);
    }
    patchBrick(brickId, {
      content: b.content.split(from).join(to),
      ...(b.label.includes(from) ? { label: b.label.split(from).join(to) } : {}),
    });
  }
  plan.brickPatches = [...brickPatches.values()];

  // ─── 3. Missions ───────────────────────────────────────────────────────────
  const viewOf = (a: OpsAssignment): MissionView => ({
    campaign: a.scriptCombo ? campaignName(a.scriptCombo.campaignId) : "—",
    script: a.scriptCombo?.assembledScript ?? "",
    notif: a.scriptCombo?.notifText ?? null,
    dueDay: parisDayOf(a.dueDate),
    instructions: a.instructions ?? null,
    overlayText: a.overlayText ?? null,
  });
  const requireMission = (id: string, expectCreatorId: string, what: string): OpsAssignment => {
    const a = assignments.get(id);
    if (!a) fail(`${what} : mission inconnue dans ce projet (${id}).`);
    if (a.creatorId !== expectCreatorId) {
      fail(`${what} : la mission ${id} appartient à une autre créatrice (${a.creatorId}).`);
    }
    if (!a.scriptCombo) fail(`${what} : la mission ${id} n'a pas de script de campagne.`);
    if (isPublished(a)) fail(`${what} : la mission ${id} est déjà publiée — son script ne se réécrit plus.`);
    if (COMBO_FREEING_STATUSES.has(a.status)) {
      fail(`${what} : la mission ${id} est « ${a.status} » — rien à réécrire.`);
    }
    return a;
  };

  // État de travail par mission : les gestes sur une même mission se cumulent.
  const working = new Map<string, { before: OpsAssignment; now: OpsAssignment; clear: Set<ClearableField>; comboChanged: boolean; textFixed: boolean }>();
  const workOn = (a: OpsAssignment) => {
    const w = working.get(a._id) ?? { before: a, now: { ...a }, clear: new Set<ClearableField>(), comboChanged: false, textFixed: false };
    working.set(a._id, w);
    return w;
  };

  for (const fix of request.frozenTextFixes ?? []) {
    const a = requireMission(fix.assignmentId, fix.expectCreatorId, "Correction du texte figé");
    const w = workOn(a);
    const combo = w.now.scriptCombo!;
    if (!combo.assembledScript.includes(fix.from)) {
      if (combo.assembledScript.includes(fix.to)) {
        plan.skipped.push(`Mission ${a._id} : « ${fix.from} » déjà corrigé.`);
        continue;
      }
      fail(`Correction du texte figé : « ${fix.from} » introuvable dans la mission ${a._id}.`);
    }
    w.now = {
      ...w.now,
      scriptCombo: {
        ...combo,
        assembledScript: combo.assembledScript.split(fix.from).join(fix.to),
        editedOnce: true,
      },
    };
    w.textFixed = true;
  }

  const brickIn = (id: string, campaignId: string, kind: OpsBrickKind, mission: string) => {
    const b = bricks.get(id);
    if (!b) fail(`Mission ${mission} : brique ${kind} inconnue (${id}).`);
    if (b.campaignId !== campaignId) {
      fail(`Mission ${mission} : la brique « ${b.content.slice(0, 40)} » n'est pas dans « ${campaignName(campaignId)} ».`);
    }
    if (b.kind !== kind) fail(`Mission ${mission} : « ${b.content.slice(0, 40)} » est un ${b.kind}, pas un ${kind}.`);
    if (b.content.trim().length === 0) fail(`Mission ${mission} : la brique ${kind} ${id} est vide.`);
    return b;
  };

  for (const r of request.assignmentRewrites ?? []) {
    const a = requireMission(r.assignmentId, r.expectCreatorId, "Réécriture");
    const current = a.scriptCombo!.campaignId;
    if (current !== r.expectCampaignId && current !== r.combo?.campaignId) {
      fail(`Réécriture : la mission ${a._id} est dans « ${campaignName(current)} », pas dans « ${campaignName(r.expectCampaignId)} ».`);
    }
    const w = workOn(a);

    if (r.combo) {
      const c = r.combo;
      if (w.textFixed) fail(`Mission ${a._id} : correction de texte ET nouveau script — l'un écraserait l'autre.`);
      if (a.status !== "todo" && a.status !== "in_progress") {
        fail(`Mission ${a._id} : « ${a.status} » — la vidéo est déjà tournée, son script ne change plus.`);
      }
      const target = campaigns.get(c.campaignId);
      if (!target) fail(`Mission ${a._id} : campagne cible inconnue (${c.campaignId}).`);
      if (target.status !== "active") fail(`Mission ${a._id} : la campagne « ${target.name} » est archivée.`);
      const hook = brickIn(c.hookBrickId, c.campaignId, "hook", a._id);
      const flux = brickIn(c.fluxBrickId, c.campaignId, "flux", a._id);
      const cta = brickIn(c.ctaBrickId, c.campaignId, "cta", a._id);

      let notif: OpsBrick | null = null;
      if (c.notifBrickId !== undefined && c.notifContent !== undefined) {
        fail(`Mission ${a._id} : notif désignée deux fois (id et texte).`);
      }
      if (c.notifBrickId !== undefined) notif = brickIn(c.notifBrickId, c.campaignId, "notif", a._id);
      if (c.notifContent !== undefined) {
        const wanted = c.notifContent.trim();
        const matches = [...bricks.values()].filter(
          (b) => b.campaignId === c.campaignId && b.kind === "notif" && b.content.trim() === wanted,
        );
        if (matches.length !== 1) {
          fail(`Mission ${a._id} : ${matches.length} notif « ${wanted} » dans « ${target.name} » (il en faut exactement une).`);
        }
        notif = matches[0];
      }
      if (!notif && a.scriptCombo!.notifText !== undefined) {
        plan.warnings.push(`Mission ${a._id} : sa notif « ${a.scriptCombo!.notifText} » disparaît (aucune notif dans le nouveau script).`);
      }

      const combo: OpsScriptCombo = {
        campaignId: c.campaignId,
        hookBrickId: hook._id,
        fluxBrickId: flux._id,
        ctaBrickId: cta._id,
        assembledScript: assemble(hook.content, flux.content, cta.content),
        editedOnce: true,
        ...(notif ? { notifBrickId: notif._id, notifText: notif.content.trim() } : {}),
      };
      const comboKey = `${hook._id}:${flux._id}:${cta._id}`;
      if (!(sameCombo(a.scriptCombo, combo) && a.comboKey === comboKey && a.comboImposed === true)) {
        w.now = { ...w.now, scriptCombo: combo, comboKey, comboImposed: true };
        w.comboChanged = true;
      }

      // Unicité et cooldown : la combinaison est CHOISIE, donc rien ne bloque —
      // mais chaque conflit est dit, pour être relu avant d'écrire.
      for (const other of input.assignments) {
        if (other._id === a._id || other.comboKey !== comboKey) continue;
        if (COMBO_FREEING_STATUSES.has(other.status)) continue;
        const day = other.postDate !== undefined ? parisDayOf(other.postDate) : "sans date";
        if (other.creatorId === a.creatorId) {
          plan.warnings.push(`Mission ${a._id} : même script déjà servi à cette créatrice (${other._id}, ${other.status}, ${day}).`);
        } else if (
          a.postDate !== undefined &&
          other.postDate !== undefined &&
          Math.abs(other.postDate - a.postDate) <= Math.max(input.cooldownDays, 0) * DAY_MS
        ) {
          plan.warnings.push(`Mission ${a._id} : même script prévu le ${day} chez une autre créatrice (${other._id}) — délai entre deux usages.`);
        }
      }
    }

    if (r.dueOnPostDay && r.dueDay !== undefined) fail(`Mission ${a._id} : échéance donnée deux fois.`);
    let dueDay: string | null = null;
    if (r.dueOnPostDay) {
      if (a.postDate === undefined) fail(`Mission ${a._id} : pas de jour de publication prévu.`);
      dueDay = parisDayOf(a.postDate);
    } else if (r.dueDay !== undefined) {
      dueDay = r.dueDay;
    }
    if (dueDay !== null) {
      const due = endOfParisDay(dueDay);
      if (due === null) fail(`Mission ${a._id} : échéance invalide « ${dueDay} ».`);
      if (due !== a.dueDate) w.now = { ...w.now, dueDate: due };
    }

    if (r.clearInstructions && a.instructions !== undefined) w.clear.add("instructions");
    if (r.clearOverlayText && a.overlayText !== undefined) w.clear.add("overlayText");
  }

  for (const w of working.values()) {
    const { before, now } = w;
    const set: PlannedAssignmentPatch["set"] = {};
    if (w.comboChanged) {
      set.scriptCombo = now.scriptCombo;
      set.comboKey = now.comboKey;
      set.comboImposed = true;
    } else if (w.textFixed) {
      set.scriptCombo = now.scriptCombo;
    }
    if (now.dueDate !== before.dueDate) set.dueDate = now.dueDate;
    const clear = [...w.clear];
    if (Object.keys(set).length === 0 && clear.length === 0) {
      plan.skipped.push(`Mission ${before._id} : déjà dans l'état visé.`);
      continue;
    }
    const after: OpsAssignment = { ...now };
    for (const f of clear) delete after[f];
    plan.assignmentPatches.push({ id: before._id, set, clear, before: viewOf(before), after: viewOf(after) });
  }

  // ─── 4. Campagnes à archiver ───────────────────────────────────────────────
  for (const id of request.archiveCampaignIds ?? []) {
    const c = campaigns.get(id);
    if (!c) fail(`Archivage : campagne inconnue (${id}).`);
    if (c.status === "archived") {
      plan.skipped.push(`Campagne « ${c.name} » déjà archivée.`);
      continue;
    }
    plan.campaignPatches.push({ id, name: c.name, set: { status: "archived" } });
    const stillUsed = input.assignments.filter((a) => {
      const now = working.get(a._id)?.now ?? a;
      return now.scriptCombo?.campaignId === id && !isPublished(a) && !COMBO_FREEING_STATUSES.has(a.status);
    });
    if (stillUsed.length > 0) {
      plan.warnings.push(`Campagne « ${c.name} » archivée avec ${stillUsed.length} mission(s) non publiée(s) encore dessus.`);
    }
  }

  return plan;
}
