/**
 * CONVERSATION — à l'assignation, on choisit un THÈME (fenêtre « Assigner »,
 * outil MCP `assigner_scripts`) : chaque vidéo reçoit une conversation WhatsApp
 * GÉNÉRÉE depuis un scénario de ce thème (convex/scenarios), que la créatrice
 * télécharge à son prénom et importe dans l'app à l'écran.
 *
 * Tout scénario du thème est tiré, sauf ARCHIVÉ (les missions qui l'ont reçu
 * gardent le leur). Rien à régler sur la campagne.
 *
 * Tirage HORS combo (la clé de combo, l'unicité, le cooldown ne bougent pas),
 * en rotation équilibrée — la mécanique de la notif (convex/scriptNotif) : le
 * scénario le moins servi À CETTE CRÉATRICE d'abord, puis le moins servi sur la
 * campagne, puis le plus ancien. Seul l'id du scénario est posé, sur
 * `assignments.scenarioId` (hors du combo, cf schema).
 *
 * Module PUR (aucun import `_generated`). Garde : lib/script-conversation.test.ts.
 */
import { pickNotifs, type NotifUsage } from "./scriptNotif";

/** Clé de comparaison d'un thème : ni la casse ni les espaces autour ne comptent. */
export function cleTheme(theme: string): string {
  return theme.trim().toLocaleLowerCase("fr");
}

export interface ScenarioLike {
  _id: string;
  theme: string;
  statut: string;
  createdAt: number;
}

/**
 * Les scénarios TIRABLES dans des thèmes : tous sauf les archivés, du plus
 * ancien au plus récent (l'ordre départage la rotation).
 */
export function scenariosTirables<T extends ScenarioLike>(
  scenarios: readonly T[],
  themes: readonly string[],
): T[] {
  const cles = new Set(themes.map(cleTheme));
  return scenarios
    .filter((s) => s.statut !== "archive" && cles.has(cleTheme(s.theme)))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * La GRAINE d'une mission (FNV-1a 32 bits de son id) : chaque mission a SA
 * conversation — deux vidéos du même scénario chez la même créatrice ne
 * reçoivent pas le même remplissage —, et la même mission retélécharge
 * toujours la même.
 */
export function graineMission(assignmentId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < assignmentId.length; i++) {
    h ^= assignmentId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Forme minimale d'une assignation pour le comptage d'usage. */
export interface ScenarioUsageRow {
  creatorId: string;
  status: string;
  scriptCombo?: { campaignId: string } | null;
  scenarioId?: string;
}

/**
 * Compte les scénarios DÉJÀ servis sur la campagne — même règle que les notifs
 * (statuts libérants exclus : refus, abandon).
 */
export function scenarioUsageOf(
  rows: readonly ScenarioUsageRow[],
  input: { campaignId: string; creatorId: string; freeingStatuses: ReadonlySet<string> },
): NotifUsage {
  const creator = new Map<string, number>();
  const campaign = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of rows) {
    if (!r.scenarioId || r.scriptCombo?.campaignId !== input.campaignId) continue;
    if (input.freeingStatuses.has(r.status)) continue;
    bump(campaign, r.scenarioId);
    if (r.creatorId === input.creatorId) bump(creator, r.scenarioId);
  }
  return { creator, campaign };
}

/** Tire `count` scénarios, un par vidéo — la rotation des notifs, à l'identique. */
export function pickScenarios<T extends ScenarioLike>(
  scenarios: readonly T[],
  usage: NotifUsage,
  count: number,
): T[] {
  return pickNotifs(scenarios, usage, count);
}
