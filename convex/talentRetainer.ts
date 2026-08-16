/**
 * FORFAIT MENSUEL D'UN TALENT — les mois dus, et rien d'autre.
 *
 * Module PUR (aucun import `_generated`) → importable serveur, client et `lib/`
 * pour les tests. Même patron que `convex/accountPhase.ts` et
 * `convex/calendarStatus.ts`.
 *
 * ─── LA RÈGLE, EN UNE PHRASE ─────────────────────────────────────────────────
 * Forfait au MOIS CALENDAIRE, mois d'entrée ET mois de sortie payés EN ENTIER.
 * Aucun prorata, nulle part. Conséquence assumée : un talent activé le 28 et
 * arrêté le 3 du mois suivant doit DEUX mois pleins pour SEPT jours couverts
 * (les deux bornes comptent — elle était active le 28 et le 3). Ce n'est pas un
 * cas particulier à corriger, c'est la règle appliquée honnêtement : l'écran de
 * paie l'affiche en toutes lettres, avec le montant, pour que la décision se
 * prenne avant le virement et non après.
 *
 * ─── POURQUOI PAS LES CYCLES J+30 ────────────────────────────────────────────
 * Le forfait a été déployé un temps en cycles de 30 jours fixes. 365 / 30 =
 * 12,17 échéances par an, soit UN MOIS DE FORFAIT OFFERT chaque année et par
 * talent. C'est l'arbitrage B3, qui disait le mois calendaire depuis le début et
 * que le code avait contredit ; l'audit prod du 2026-08-15 (0 ancre, 0 forfait,
 * 0 ligne payée) a permis de revenir sans rien migrer.
 *
 * ─── ⚠️ LE MOIS EST CELUI DE PARIS ───────────────────────────────────────────
 * `payments.periodOf` est en UTC et le RESTE : elle clé les lignes d'accrual des
 * partenaires, on n'y touche pas. Mais sur un forfait au mois, une activation le
 * 1er à 00h30 Paris tombe en UTC dans le mois PRÉCÉDENT — et par la règle « mois
 * d'entrée payé en entier », c'est un mois entier offert pour trente minutes.
 *
 * Deux clés « YYYY-MM » coexistent donc : UTC pour les partenaires, PARIS pour
 * le forfait talent. Elles ne se croisent jamais — un talent n'a que des lignes
 * `retainer`, un partenaire n'en a aucune.
 *
 * `timeZone: "Europe/Paris"` avec des parties NUMÉRIQUES est prouvé dans le
 * runtime Convex (correctif #52). Ce sont les NOMS de mois qui ne le sont pas :
 * le libellé humain passe par une table en dur, comme `accountPhase`.
 */

/** Formateur épinglé Paris, construit UNE fois. "en-CA" rend "YYYY-MM-DD". */
const PARIS_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Mois calendaire PARIS d'un instant → « YYYY-MM ». */
export function parisMonthKey(ms: number): string {
  return PARIS_YMD.format(new Date(ms)).slice(0, 7);
}

/** Mois suivant une clé « YYYY-MM ». Passage d'année inclus. */
export function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12
    ? `${y + 1}-01`
    : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const MOIS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

/** « 2026-08 » → « août 2026 ». Table en dur : l'ICU du runtime n'est pas garanti. */
export function monthLabelFr(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const nom = MOIS_FR[m - 1];
  return nom ? `${nom} ${y}` : key;
}

/**
 * Bornes de sécurité du parcours de mois. Un `startAt` aberrant (fiche corrompue,
 * date saisie à la main) produirait sinon une boucle de plusieurs milliers
 * d'itérations et autant de lignes de paie fantômes.
 */
export const MAX_MONTHS_DUE = 240; // 20 ans

/**
 * Les mois DUS, du mois d'activation au mois d'arrêt (ou au mois courant si le
 * talent est toujours actif), **bornes incluses**.
 *
 * C'est ici, et nulle part ailleurs, que vivent les deux arbitrages :
 *   - le mois d'ENTRÉE est dû en entier, quel que soit le jour d'activation ;
 *   - le mois de SORTIE est dû en entier, quel que soit le jour d'arrêt.
 *
 * `startAt` absent (talent jamais activé) ⇒ aucun mois. `endAt` antérieur à
 * `startAt` (bascule incohérente) ⇒ le seul mois d'entrée, jamais une liste vide
 * ni une boucle infinie.
 */
export function monthsDue(input: {
  /** Instant d'activation du talent (`creators.payStartAt`). */
  startAt: number | null | undefined;
  /** Instant d'arrêt (`creators.payEndAt`), ou null s'il est toujours actif. */
  endAt: number | null | undefined;
  /** Horloge injectée. */
  now: number;
}): string[] {
  const { startAt, endAt, now } = input;
  if (startAt === null || startAt === undefined) return [];
  const premier = parisMonthKey(startAt);
  const dernier = parisMonthKey(
    endAt !== null && endAt !== undefined ? Math.max(endAt, startAt) : now,
  );
  const out: string[] = [];
  let k = premier;
  while (k <= dernier && out.length < MAX_MONTHS_DUE) {
    out.push(k);
    k = nextMonthKey(k);
  }
  // `startAt` dans le futur (horloge décalée, antidatage) : le mois d'entrée est
  // dû quand même — fermé par défaut, jamais une liste vide qui ferait croire
  // qu'on ne doit rien.
  return out.length > 0 ? out : [premier];
}

/** Jours calendaires réellement couverts, bornes incluses — pour le récap. */
export function daysCovered(input: {
  startAt: number | null | undefined;
  endAt: number | null | undefined;
  now: number;
}): number | null {
  const { startAt, endAt, now } = input;
  if (startAt === null || startAt === undefined) return null;
  const fin = endAt !== null && endAt !== undefined ? Math.max(endAt, startAt) : now;
  const jour = (ms: number) => {
    const [y, m, d] = PARIS_YMD.format(new Date(ms)).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((jour(fin) - jour(startAt)) / 86_400_000) + 1;
}

/** Fiche réduite à ce que le forfait regarde. */
export interface TalentRetainerFiche {
  kind?: "partner" | "talent" | "clipper";
  monthlyRetainer?: number;
}

/**
 * Montant mensuel d'un talent, ou `null` — hors population talent, forfait
 * absent, nul ou négatif.
 *
 * ⚠️ Lu LIVE tant que le mois n'est pas payé, FIGÉ au paiement (la ligne
 * `retainer` est écrite dans `payments.lineItems`, relue verbatim ensuite).
 * Conséquence voulue : passer une fiche de 300 à 400 € applique 400 € au mois
 * courant s'il est encore dû et aux suivants ; un mois déjà payé ne bouge
 * jamais. Même principe que `pricingSnapshot` sur les publications.
 */
export function retainerAmountFor(
  creator: TalentRetainerFiche,
): number | null {
  if ((creator.kind ?? "partner") !== "talent") return null;
  const m = creator.monthlyRetainer;
  if (typeof m !== "number" || !Number.isFinite(m) || m <= 0) return null;
  return Math.round(m * 100) / 100;
}
