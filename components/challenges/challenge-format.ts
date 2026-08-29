import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { winnerSlots, type WinnerRule } from "@/convex/challengeScore";
import { formatMoney } from "@/lib/format-rate";

/**
 * Libellés partagés des défis — CÔTÉ ADMIN uniquement.
 *
 * Les écrans admin ne sont pas traduits (convention du dépôt : l'i18n couvre le
 * parcours créateur). Les libellés créatrice vivent dans `messages/{fr,en}.json`
 * et ne passent JAMAIS par ce module — sans quoi une chaîne française
 * remonterait dans l'espace d'une créatrice anglophone, ce que la garde i18n ne
 * verrait pas (elle surveille les composants du portail, pas ce fichier).
 */

export type ChallengeReward = {
  type: "cash" | "nature";
  amount?: number;
  libelle?: string;
  coutReel?: number;
};

export type ChallengeListRow = FunctionReturnType<
  typeof api.challenges.listChallenges
>[number];

/** « 100 000 vues » — séparateur français, jamais un nombre brut collé. */
export function formatViews(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.round(n)));
}

export function modeLabel(mode: string): string {
  return mode === "single" ? "Une seule vidéo" : "Cumulé";
}

export function modeHelp(mode: string): string {
  return mode === "single"
    ? "Une seule de ses vidéos doit atteindre la barre."
    : "La somme des vues de ses vidéos du défi.";
}

/**
 * ⚠️ DEUX PIÈGES dans cette fonction, et ils sont indépendants.
 *
 * 1. Le montant est PAR GAGNANTE. Le libellé le dit explicitement dès qu'il peut
 *    y avoir plus d'une gagnante — « 200 $ » seul se lit spontanément comme une
 *    enveloppe à partager, et c'est exactement l'inverse.
 * 2. La DEVISE vient de la donnée (`projects.payCurrency`), jamais d'un symbole
 *    écrit ici. Une prime de défi est payée à la créatrice : elle est donc dans
 *    la devise de SA paie — des dollars chez Snytch. Écrire « € » aurait affiché
 *    des euros sur une paie en dollars ; c'est le garde `currency-hardcode` qui
 *    l'a attrapé, pas une relecture.
 */
export function rewardLabel(
  reward: ChallengeReward,
  rule?: WinnerRule,
  currency?: string | null,
): string {
  const base =
    reward.type === "cash"
      ? formatMoney(reward.amount ?? 0, currency)
      : (reward.libelle ?? "Récompense en nature");
  if (!rule) return base;
  return winnerSlots(rule) === 1 ? base : `${base} par gagnante`;
}

export function winnerRuleLabel(rule: WinnerRule): string {
  switch (rule.kind) {
    case "first":
      return "La première";
    case "topN":
      return `Les ${rule.n} premières`;
    case "all":
      return "Toutes celles qui franchissent";
  }
}

/** Coût TOTAL engagé si toutes les places sont prises. `null` = non chiffrable. */
export function maxCommitment(
  reward: ChallengeReward,
  rule: WinnerRule,
): number | null {
  const slots = winnerSlots(rule);
  if (!Number.isFinite(slots)) return null; // « toutes » : plafond inconnu
  const unit = reward.type === "cash" ? reward.amount : reward.coutReel;
  // Une nature sans coût réel n'est pas chiffrable — on rend null et l'écran
  // affiche un tiret. Un 0 se lirait « gratuit ».
  if (typeof unit !== "number") return null;
  return unit * slots;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "active":
      return "En cours";
    default:
      return "Clos";
  }
}

export function statusTone(status: string): string {
  switch (status) {
    case "draft":
      return "bg-slate-100 text-slate-600";
    case "active":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-slate-200 text-slate-500";
  }
}

/** « dans 3 j », « aujourd'hui », « terminé ». */
export function deadlineLabel(deadline: number, now: number): string {
  const ms = deadline - now;
  if (ms <= 0) return "terminé";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `dans ${days} j`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `dans ${hours} h`;
}
