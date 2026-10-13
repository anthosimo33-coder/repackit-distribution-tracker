/**
 * CONVERSATION — la brique OPTIONNELLE d'une campagne de scripts : la conv que
 * la créatrice importe à l'écran dans l'app (export WhatsApp, captures), et
 * l'écran choc qu'elle filme. Fichiers à télécharger depuis sa mission.
 *
 * MÊME MÉCANIQUE QUE LA NOTIF (convex/scriptNotif), réutilisée telle quelle :
 * tirée HORS combo (la clé de combo, l'unicité, le cooldown ne bougent pas),
 * une par vidéo, en rotation équilibrée — la moins servie À CETTE CRÉATRICE
 * d'abord, puis la moins servie sur la campagne, puis l'ordre de la liste.
 * Mesurée par brique dans l'analytics (seuil « jugeable » = 50 posts).
 *
 * DIFFÉRENCE : rien n'est figé à l'assignation. Une notif est un texte recopié
 * dans la fiche ; une conversation est un jeu de FICHIERS lus en direct sur la
 * brique — remplacer un export raté répare les missions déjà assignées. Seul
 * l'id de la brique est posé, sur `assignments.conversationBrickId` (hors du
 * combo, cf schema).
 *
 * Module PUR (aucun import `_generated`). Garde : lib/script-conversation.test.ts.
 */
import {
  notifUsageOf,
  pickNotifs,
  type NotifBrickLike,
  type NotifUsage,
} from "./scriptNotif";

/** Réglage PAR CAMPAGNE. Absent = désactivé (0 migration). */
export function isConversationEnabled(
  campaign: { conversationEnabled?: boolean } | null | undefined,
): boolean {
  return campaign?.conversationEnabled === true;
}

export interface ConversationBrickLike extends NotifBrickLike {
  conversationFiles?: readonly unknown[];
  scenarioId?: string;
}

/**
 * Les conversations TIRABLES : actives, de kind "conversation", et qui ont de
 * quoi importer — un scénario ACTIF (`scenariosActifs`, ids des scénarios au
 * statut « actif ») ou au moins un fichier déposé. Une brique reliée à un
 * scénario archivé ou en brouillon ne part pas, même si elle porte encore des
 * fichiers : c'est le scénario qui décide. Dans l'ordre de la liste.
 */
export function drawableConversations<T extends ConversationBrickLike>(
  bricks: readonly T[],
  scenariosActifs: ReadonlySet<string> = new Set(),
): T[] {
  return bricks
    .filter(
      (b) =>
        b.kind === "conversation" &&
        b.active &&
        (b.scenarioId !== undefined
          ? scenariosActifs.has(b.scenarioId)
          : (b.conversationFiles?.length ?? 0) > 0),
    )
    .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
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
export interface ConversationUsageRow {
  creatorId: string;
  status: string;
  scriptCombo?: { campaignId: string } | null;
  conversationBrickId?: string;
}

/**
 * Compte les conversations DÉJÀ servies sur la campagne — même règle que les
 * notifs (statuts libérants exclus : refus, abandon). Le comptage est celui de
 * notifUsageOf, appliqué au champ de la conversation.
 */
export function conversationUsageOf(
  rows: readonly ConversationUsageRow[],
  input: { campaignId: string; creatorId: string; freeingStatuses: ReadonlySet<string> },
): NotifUsage {
  return notifUsageOf(
    rows.map((r) => ({
      creatorId: r.creatorId,
      status: r.status,
      scriptCombo: r.scriptCombo
        ? { campaignId: r.scriptCombo.campaignId, notifBrickId: r.conversationBrickId }
        : null,
    })),
    input,
  );
}

/** Tire `count` conversations, une par vidéo — la rotation des notifs, à l'identique. */
export function pickConversations<T extends ConversationBrickLike>(
  conversations: readonly T[],
  usage: NotifUsage,
  count: number,
): T[] {
  return pickNotifs(conversations, usage, count);
}
