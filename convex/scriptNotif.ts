/**
 * NOTIF — la brique OPTIONNELLE d'une campagne de scripts : le texte de la
 * notification qui s'affiche à l'écran dans la vidéo.
 *
 * POURQUOI UNE BRIQUE. La notif se choisissait au jugé. En faire une brique la
 * rend MESURABLE comme un hook : chaque vidéo porte une notif précise, ses vues
 * remontent par brique dans l'analytics, et à 50 posts (seuil « jugeable ») on
 * SAIT laquelle fait les vues au lieu de deviner.
 *
 * TIRÉE HORS DU COMBO, volontairement. Le combo hook × flux × description garde
 * sa clé à 3 segments : unicité à vie, cooldown et capacité du catalogue sont
 * INCHANGÉS. En faire une 4e pièce aurait (1) laissé une créatrice retourner le
 * même texte avec seule la notif changée, et (2) produit une clé à 4 segments,
 * celle de l'ancien format « hook:corps:flux:cta » que parseComboKey lit déjà.
 *
 * ROTATION ÉQUILIBRÉE. La notif la moins servie À CETTE CRÉATRICE d'abord (sinon
 * l'effet créatrice — énorme sur les vues — se confondrait avec l'effet notif),
 * puis la moins servie sur la campagne (pour que chaque notif atteigne vite ses
 * 50 posts), puis l'ordre de la liste. Déterministe, sans aléatoire.
 *
 * Module PUR (aucun import `_generated`) : partagé tel quel par le serveur et
 * les tests `lib/` — aucune réplique A6 à tenir. Garde : lib/script-notif.test.ts.
 */

/** Réglage PAR CAMPAGNE. Absent = désactivé : les campagnes existantes ne
 *  bougent pas (0 migration). */
export function isNotifEnabled(
  campaign: { notifEnabled?: boolean } | null | undefined,
): boolean {
  return campaign?.notifEnabled === true;
}

export interface NotifBrickLike {
  _id: string;
  kind: string;
  active: boolean;
  content: string;
  order?: number;
  createdAt: number;
}

/**
 * Les notifs TIRABLES : actives, de kind "notif", au texte non vide (une notif
 * vide afficherait un encart vide à la créatrice), dans l'ordre de la liste.
 */
export function drawableNotifs<T extends NotifBrickLike>(bricks: readonly T[]): T[] {
  return bricks
    .filter((b) => b.kind === "notif" && b.active && b.content.trim().length > 0)
    .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

/** Forme minimale d'une assignation pour le comptage d'usage. */
export interface NotifUsageRow {
  creatorId: string;
  status: string;
  scriptCombo?: { campaignId: string; notifBrickId?: string } | null;
}

export interface NotifUsage {
  /** Usages par notif CHEZ la créatrice tirée. */
  creator: Map<string, number>;
  /** Usages par notif sur toute la campagne. */
  campaign: Map<string, number>;
}

/**
 * Compte les notifs DÉJÀ servies sur la campagne. Les statuts `freeingStatuses`
 * (vidéo refusée, abandon) n'ont jamais produit de post : ils ne comptent pas,
 * comme pour l'unicité des combos.
 */
export function notifUsageOf(
  rows: readonly NotifUsageRow[],
  input: {
    campaignId: string;
    creatorId: string;
    freeingStatuses: ReadonlySet<string>;
  },
): NotifUsage {
  const creator = new Map<string, number>();
  const campaign = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of rows) {
    const notifId = r.scriptCombo?.notifBrickId;
    if (!notifId || r.scriptCombo?.campaignId !== input.campaignId) continue;
    if (input.freeingStatuses.has(r.status)) continue;
    bump(campaign, notifId);
    if (r.creatorId === input.creatorId) bump(creator, notifId);
  }
  return { creator, campaign };
}

/**
 * Tire `count` notifs, une par vidéo, en rotation équilibrée (cf en-tête). Les
 * compteurs avancent à chaque tirage : 3 vidéos et 3 notifs ⇒ 3 notifs
 * différentes. Aucune notif tirable ⇒ tableau vide (à l'appelant de refuser).
 * N'altère pas `usage`.
 */
export function pickNotifs<T extends NotifBrickLike>(
  notifs: readonly T[],
  usage: NotifUsage,
  count: number,
): T[] {
  if (notifs.length === 0 || count <= 0) return [];
  const creator = new Map(usage.creator);
  const campaign = new Map(usage.campaign);
  const out: T[] = [];
  for (let step = 0; step < count; step++) {
    let best = notifs[0];
    for (const n of notifs) {
      const dc = (creator.get(n._id) ?? 0) - (creator.get(best._id) ?? 0);
      if (dc < 0) {
        best = n;
        continue;
      }
      if (dc === 0 && (campaign.get(n._id) ?? 0) < (campaign.get(best._id) ?? 0)) {
        best = n;
      }
    }
    out.push(best);
    creator.set(best._id, (creator.get(best._id) ?? 0) + 1);
    campaign.set(best._id, (campaign.get(best._id) ?? 0) + 1);
  }
  return out;
}
