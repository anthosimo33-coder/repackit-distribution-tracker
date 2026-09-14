import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { winnerSlots, type WinnerRule } from "@/convex/challengeScore";
import { formatMoney } from "@/lib/format-rate";

/**
 * Libellés partagés des défis — CÔTÉ ÉQUIPE.
 *
 * Depuis septembre 2026 l'espace d'équipe est traduit : ce module rend donc des
 * CLÉS (`admin.challenges.*`) ou prend la langue en paramètre, jamais une phrase
 * française. Les libellés CRÉATRICE, eux, vivent dans `messages/{fr,en}.json` et
 * ne passent pas par ici.
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

/** « 100 000 vues » — séparateur de la langue, jamais un nombre brut collé. */
export function formatViews(n: number, locale: string = "fr-FR"): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(n)));
}

/** Clé de libellé du mode : `admin.challenges.mode.<clé>`. */
export function modeKey(mode: string): "single" | "cumul" {
  return mode === "single" ? "single" : "cumul";
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
  rule: WinnerRule | undefined,
  currency: string | null | undefined,
  copy: RewardCopy,
): string {
  const base =
    reward.type === "cash"
      ? formatMoney(reward.amount ?? 0, currency, copy.locale)
      : (reward.libelle ?? copy.natureDefault);
  if (!rule) return base;
  return winnerSlots(rule) === 1 ? base : copy.perWinner(base);
}

/** Ce que l'écran passe pour rendre une récompense dans sa langue. */
export type RewardCopy = {
  locale: string;
  natureDefault: string;
  perWinner: (base: string) => string;
};

/** Clé + paramètre du libellé de règle : `admin.challenges.winnerRule.<clé>`. */
export function winnerRuleKey(rule: WinnerRule): { key: "first" | "topN" | "all"; n?: number } {
  switch (rule.kind) {
    case "first":
      return { key: "first" };
    case "topN":
      return { key: "topN", n: rule.n };
    case "all":
      return { key: "all" };
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

/** Clé de libellé du statut : `admin.challenges.status.<clé>`. */
export function statusKey(status: string): "draft" | "active" | "closed" {
  if (status === "draft") return "draft";
  return status === "active" ? "active" : "closed";
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

/** Unité + compte de l'échéance : la phrase vit dans `admin.challenges.deadline`. */
export function deadlineParts(
  deadline: number,
  now: number,
): { unit: "over" | "d" | "h"; count: number } {
  const ms = deadline - now;
  if (ms <= 0) return { unit: "over", count: 0 };
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return { unit: "d", count: days };
  return { unit: "h", count: Math.max(1, Math.floor(ms / 3_600_000)) };
}
