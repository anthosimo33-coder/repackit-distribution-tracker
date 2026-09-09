/**
 * ÉTAT DE CHAUFFE D'UN COMPTE, pour l'AFFICHAGE — pur, testé, client seul.
 *
 * L'écran Comptes ne connaissait qu'un état : « en warmup ». Sur le parc réel,
 * ça mettait dans le même sac `@Sophia_secretacc1` — 3 checks sur 3, qui attend
 * juste une validation — et `@sofiamatcha22`, démarré depuis 26 JOURS avec zéro
 * check, qui publie déjà des posts rémunérés. Le second est un problème, le
 * premier une formalité, et rien ne les séparait.
 *
 * ⚠️ CE MODULE NE CALCULE AUCUNE CONFORMITÉ. `missedDays` (lib/warmup, répliqué
 * A6, qui alimente le digest ops et les notifications Telegram) reste la seule
 * autorité sur les jours manqués, et il n'est pas touché. On ne fait ici que
 * CLASSER, et on ajoute une grandeur qui manquait à l'exploitation : l'ÂGE réel
 * du démarrage.
 *
 * Pourquoi l'âge, alors que `missedDays` existe : il est plafonné à
 * `targetDays`. Un warmup de 3 jours bloqué depuis 26 jours affiche donc « 3
 * jours manqués », exactement comme un warmup bloqué depuis 3 jours. Le plafond
 * est juste pour la conformité — on ne doit pas 26 checks — et aveugle pour
 * qui doit décider quoi relancer en premier.
 */

import {
  checkedToday,
  daysElapsed,
  missedDays,
  warmupProgress,
  type CreatorZone,
} from "./warmup";

export type WarmupStateKind =
  /** Le compte n'est pas en chauffe. */
  | "none"
  /** Les checks sont complets : la chauffe attend une validation admin. */
  | "aValider"
  /** En cours, et le check du jour est déjà posé. Rien à faire aujourd'hui. */
  | "aJour"
  /** En cours, le check du jour reste à poser. */
  | "duJour"
  /** La chauffe aurait dû être finie : elle traîne. */
  | "enSouffrance";

export type WarmupState = {
  kind: WarmupStateKind;
  /** Prochain check à faire, 1-indexé et clampé (cf warmupProgress). */
  day: number;
  targetDays: number;
  /** Checks réellement posés. */
  checks: number;
  /**
   * Jours écoulés depuis le démarrage. `null` quand la chauffe n'a jamais été
   * démarrée — un compte marqué « warmup » sans `warmupStartedAt` est un état
   * réel du parc, pas une anomalie à masquer.
   */
  age: number | null;
  /** Jours manqués au sens conformité — plafonné, cf `missedDays`. */
  manques: number;
};

export type WarmupCompteLike = {
  status?: string;
  actif?: boolean;
  plateforme: string;
  warmupStartedAt?: number;
  warmupProtocol?: { targetDays?: number; dailyChecks?: string[] } | null;
  /** Durée EFFECTIVE servie par le serveur — jamais recalculée ici. */
  targetDays: number;
  /** Fuseau de la créatrice, servi par le serveur. `null` ⇒ UTC, jamais Paris. */
  creatorTimezone?: string | null;
};

/**
 * Classe un compte. `now` est OBLIGATOIRE : une horloge implicite ferait entrer
 * celle du navigateur de l'équipe là où c'est le jour de la créatrice qui
 * compte (cf. la règle des trois horloges du dépôt).
 */
export function warmupStateOf(c: WarmupCompteLike, now: number): WarmupState {
  const checks = c.warmupProtocol?.dailyChecks ?? [];
  const targetDays = c.targetDays;
  const progress = warmupProgress(checks.length, targetDays);
  const age =
    c.warmupStartedAt === undefined
      ? null
      : Math.max(0, daysElapsed(c.warmupStartedAt, now));
  const base = {
    day: progress.day,
    targetDays,
    checks: checks.length,
    age,
    manques:
      c.warmupStartedAt === undefined
        ? 0
        : missedDays(c.warmupStartedAt, checks, targetDays, now),
  };

  const statut = c.status ?? (c.actif === false ? "archived" : "actif");
  if (statut !== "warmup") return { ...base, kind: "none" };
  if (progress.complete) return { ...base, kind: "aValider" };

  // EN SOUFFRANCE : la chauffe a dépassé sa durée sans être finie. On compare
  // l'âge à la durée cible, pas les jours manqués — c'est le dépassement qui
  // dit « ça traîne », et lui n'est pas plafonné.
  if (age !== null && age > targetDays) return { ...base, kind: "enSouffrance" };

  // Une chauffe jamais démarrée n'est pas « en retard » : elle n'a pas commencé.
  // Elle réclame quand même le premier check.
  const faitAujourdHui =
    c.warmupStartedAt !== undefined &&
    checkedToday(checks, now, (c.creatorTimezone ?? null) as CreatorZone);
  return { ...base, kind: faitAujourdHui ? "aJour" : "duJour" };
}

/** Les états qui réclament un geste aujourd'hui, du plus urgent au moins. */
export const WARMUP_A_TRAITER: WarmupStateKind[] = [
  "enSouffrance",
  "duJour",
  "aValider",
];

/**
 * Ordre de traitement : ce qui traîne le plus vient en premier. À égalité de
 * gravité, le plus vieux démarrage d'abord — c'est celui qu'on a le plus laissé
 * filer.
 */
export function compareUrgence(a: WarmupState, b: WarmupState): number {
  const rang = (s: WarmupState) => {
    const i = WARMUP_A_TRAITER.indexOf(s.kind);
    return i === -1 ? WARMUP_A_TRAITER.length : i;
  };
  const d = rang(a) - rang(b);
  if (d !== 0) return d;
  return (b.age ?? -1) - (a.age ?? -1);
}
