/**
 * NOUVEAU RADAR — vidéos devenues INVISIBLES sur TikTok : règles pures.
 *
 * Le 10/11/2026, « Regarder une par une » montrait « Video currently unavailable »
 * et, dessous, une vidéo sans rapport (TikTok remplit son lecteur d'une suggestion).
 * Le compte était passé en privé depuis le relevé. Ce jour-là, 127 des 1 906
 * vidéos signalées n'étaient plus visibles, presque toutes d'un seul réseau :
 * FollowSpy (84 sur 107) et FollowOtter (18 sur 21), 22 comptes passés en privé.
 * Le Radar ne le voyait pas : le relevé d'un compte privé n'échoue pas, il ne
 * ramène juste rien de neuf.
 *
 * Le contrôle lit la page publique de la vidéo (convex/tiktokPublicPage, déjà en
 * prod pour les relevés de vues, sans crédit) : TikTok y dit s'il sert la vidéo,
 * et sinon pourquoi. Les tâches et les écritures sont dans convex/radarAvailability.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Pourquoi une vidéo n'est plus visible :
 *  - private : le compte est passé en privé (toutes ses vidéos avec) ;
 *  - region : TikTok ne la sert pas dans notre région ;
 *  - removed : supprimée ;
 *  - review : en cours de vérification, ou refusée par TikTok ;
 *  - restricted : réservée aux amis de l'auteur, ou à lui seul ;
 *  - other : TikTok refuse sans motif connu.
 */
export const UNAVAILABLE_REASONS = ["private", "region", "removed", "review", "restricted", "other"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/**
 * Le motif d'un refus. Le MESSAGE d'abord : TikTok sert le même code 10204 pour
 * « supprimée », « réservée aux amis » et « en vérification », et joint parfois
 * deux motifs (« author_secret,cross_border_violation ») — le compte privé
 * l'emporte, il vaut pour toutes ses vidéos.
 */
export function reasonOf(statusCode: number, statusMsg: string): UnavailableReason {
  const m = statusMsg.toLowerCase();
  if (m.includes("author_secret")) return "private";
  if (m.includes("cross_border")) return "region";
  if (m.includes("delete") || m.includes("doesn't exist")) return "removed";
  if (m.includes("reviewing") || m.includes("audit_not_pass")) return "review";
  if (m.includes("self_see") || m.includes("friend_see")) return "restricted";
  if (statusCode === 10222) return "private";
  if (statusCode === 10231) return "region";
  return "other";
}

/** Ce qu'un contrôle a constaté. « unknown » : page illisible, on ne conclut rien. */
export type CheckOutcome = { kind: "visible" } | { kind: "unavailable"; reason: UnavailableReason } | { kind: "unknown" };

/** Du résultat de la lecture de la page (tiktokPublicPage) au constat. */
export function outcomeOf(r: { kind: "stats" } | { kind: "refused"; statusCode: number; statusMsg: string } | { kind: "unreadable" }): CheckOutcome {
  if (r.kind === "stats") return { kind: "visible" };
  if (r.kind === "refused") return { kind: "unavailable", reason: reasonOf(r.statusCode, r.statusMsg) };
  return { kind: "unknown" };
}

/** On contrôle les vidéos publiées depuis 8 jours : la fenêtre d'Aujourd'hui (7 jours) et un jour de marge. */
export const CHECK_WINDOW_MS = 8 * DAY;
/** Une vidéo visible est recontrôlée au bout de 2 jours ; une invisible chaque jour (un compte peut redevenir public). */
export const RECHECK_VISIBLE_MS = 48 * HOUR;
export const RECHECK_UNAVAILABLE_MS = 24 * HOUR;
/**
 * Pages lues par passage, toutes les 2 heures : 40 × 11 passages = 440 par jour,
 * pour ~100 vidéos neuves et ~275 recontrôles. Même prudence que le relevé de
 * vues (pause de 1,5 à 3 s, arrêt après 5 pages illisibles), qui lit les mêmes
 * pages depuis les mêmes serveurs et sert à la paie. Toutes les 2 heures plutôt
 * que chaque heure : chaque passage relit les signaux de la fenêtre, et la base
 * se paie à la lecture.
 */
export const CHECKS_PER_RUN = 40;
/** Ouverte dans le lecteur : un contrôle tout de suite, sauf si elle vient d'être contrôlée. */
export const ON_VIEW_FRESH_MS = HOUR;

/**
 * Un vrai identifiant de vidéo TikTok est un grand nombre. Tout le reste (les
 * vidéos semées par les tests, un identifiant abîmé) n'est jamais lu sur TikTok :
 * la page d'un identifiant inventé répond « n'existe pas », et le contrôle
 * marquerait « supprimée » une vidéo qui n'a jamais existé.
 */
export const isTikTokVideoId = (videoId: string): boolean => /^\d{15,}$/.test(videoId);

type Checkable = { platform: string; publishedAt: number; checkedAt?: number | null; unavailable?: { reason: UnavailableReason } | null };

/** La vidéo est-elle à contrôler ? TikTok seulement, dans la fenêtre, et pas contrôlée récemment. */
export function isDue(s: Checkable, now: number): boolean {
  if (s.platform !== "tiktok" || now - s.publishedAt > CHECK_WINDOW_MS) return false;
  if (s.checkedAt === undefined || s.checkedAt === null) return true;
  return now - s.checkedAt >= (s.unavailable ? RECHECK_UNAVAILABLE_MS : RECHECK_VISIBLE_MS);
}

/**
 * Les vidéos d'un passage : jamais contrôlées d'abord (les plus fortes en tête :
 * ce sont elles qu'Aujourd'hui montre), puis les contrôles les plus anciens. UNE
 * par compte : si le compte est privé, le constat vaut pour toutes ses vidéos
 * (radarAvailability.applyCheck le propage), inutile de les lire une à une.
 */
export function pickDue<T extends Checkable & { handle: string; score: number }>(rows: readonly T[], now: number, limit: number): T[] {
  const due = rows.filter((r) => isDue(r, now));
  const never = due.filter((r) => r.checkedAt === undefined || r.checkedAt === null).sort((a, b) => b.score - a.score);
  const again = due.filter((r) => r.checkedAt !== undefined && r.checkedAt !== null).sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...never, ...again]) {
    const k = r.handle.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

const PARIS_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });
/** L'heure qu'il est à Paris (0 à 23). */
export const parisHourOf = (ts: number): number => Number(PARIS_HOUR.format(new Date(ts)));

/**
 * Pas de contrôle à 23 h ni à minuit, heure de Paris : le relevé de vues des
 * créatrices (23 h 30) lit les mêmes pages, et lui sert à la paie.
 */
export function quietHour(parisHour: number): boolean {
  return parisHour === 23 || parisHour === 0;
}

/** Comptes privés d'un même réseau à partir desquels on prévient : un compte isolé n'est pas un événement. */
export const DARK_MIN_ACCOUNTS = 5;

/**
 * Le réseau d'une app est-il passé en privé, et faut-il le dire ? Appelé à chaque
 * passage avec le nombre de comptes privés (`n`), celui du passage précédent
 * (`seen`) et celui de la dernière alerte (`alerted`).
 *  - À partir de 5 comptes, UNE alerte — mais seulement quand le nombre n'a pas
 *    bougé depuis le passage précédent : le contrôle découvre une vague compte
 *    par compte (5, puis 10, puis 22), et trois alertes pour la même vague
 *    seraient du bruit. On attend qu'elle soit comptée, on annonce le vrai nombre.
 *  - De nouveau seulement si le nombre a doublé depuis l'alerte.
 *  - Revenu sous le seuil (les comptes sont redevenus publics), on oublie
 *    l'alerte : une prochaine vague préviendra.
 */
export function darkStep(n: number, seen: number | undefined, alerted: number | undefined): { alert: boolean; seen: number | undefined; alerted: number | undefined } {
  if (n < DARK_MIN_ACCOUNTS) return { alert: false, seen: n > 0 ? n : undefined, alerted: undefined };
  const alert = seen === n && (alerted === undefined || n >= 2 * alerted);
  return { alert, seen: n, alerted: alert ? n : alerted };
}
