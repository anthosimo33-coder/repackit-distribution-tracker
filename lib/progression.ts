/**
 * Progression créatrice — VIEW-MODEL PUR (testé Vitest), consommé par la carte
 * Accueil, l'écran Progression et l'overlay de célébration.
 *
 * Règle A6 : un module `convex/` ne peut pas importer `lib/`. La query serveur
 * (`convex/progression.ts`) ne fait donc que COLLECTER les données brutes
 * (cumul, grille de paliers, unlocks persistés, nb posts) ; toute la mise en
 * forme (échelle, prochain palier, progression 0..1, victoires, emoji) vit ICI,
 * réutilisée côté client. On RÉUTILISE `evaluateBonusTiers`/`BonusTier` du moteur
 * (jamais de duplication de la logique paliers).
 *
 * ARGENT : ce module ne calcule AUCUN dollar dû. Le cash crédité vient des
 * `bonusUnlocks` persistés (serveur) ; ici on n'expose que de l'AFFICHAGE. Une
 * récompense NATURE (physique) est `kind: "item"` SANS montant $ — jamais
 * additionnée à des dollars.
 */
import { evaluateBonusTiers, type BonusTier } from "./pricing-engine";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Récompense d'un palier, prête à l'affichage. `item` = physique (jamais $). */
export type ProgressionReward =
  | { kind: "cash"; amount: number; emoji: string }
  | { kind: "item"; label: string; emoji: string };

/** Un unlock PERSISTÉ (brut serveur) — récompense figée au déblocage. */
export type ProgressionUnlock = {
  seuilVues: number;
  rewardType: "cash" | "nature";
  montant?: number;
  libelle?: string;
  unlockedAt: number;
};

/** Un barreau de l'échelle des récompenses du projet. */
export type LadderEntry = {
  threshold: number;
  reward: ProgressionReward;
  unlocked: boolean;
  /** Présent si un unlock persisté existe pour ce seuil (date de déblocage). */
  unlockedAt?: number;
};

/** Une victoire (badge léger) dérivée des données existantes. */
export type ProgressionVictory = {
  id: string;
  emoji: string;
  label: string;
  hint: string;
  achieved: boolean;
};

/** Entrée brute (serveur) du view-model. */
export type ProgressionInput = {
  cumulViews: number;
  tiers: BonusTier[];
  unlocks: ProgressionUnlock[];
  publishedPostsCount: number;
};

/** View-model complet de la progression. */
export type ProgressionView = {
  cumulViews: number;
  publishedPostsCount: number;
  ladder: LadderEntry[];
  /** Récompense du prochain palier non franchi, ou null si tout est débloqué. */
  nextReward: ProgressionReward | null;
  nextThreshold: number | null;
  /** Fraction 0..1 de la barre vers le prochain palier (1 si tout débloqué). */
  progressToNext: number;
  /** Vues restantes avant le prochain palier (0 si aucun). */
  remainingViews: number;
  /** Total $ des paliers CASH débloqués (persistés). Affichage seulement. */
  cashUnlockedTotal: number;
  /** Récompenses PHYSIQUES débloquées (jamais des dollars). */
  itemsUnlocked: { label: string; emoji: string; unlockedAt: number }[];
  victories: ProgressionVictory[];
};

const CASH_EMOJI = "💶";
const DEFAULT_ITEM_EMOJI = "🎁";

// Dérivation emoji d'une récompense physique depuis son libellé libre (le schéma
// ne stocke pas d'emoji — édition en admin = follow-up). Défaut 🎁.
const ITEM_EMOJI_RULES: { re: RegExp; emoji: string }[] = [
  { re: /iphone|smartphone|t[ée]l[ée]phone|pixel|galaxy/i, emoji: "📱" },
  { re: /macbook|laptop|ordi|imac|\bpc\b/i, emoji: "💻" },
  { re: /ipad|tablet/i, emoji: "📱" },
  { re: /airpod|casque|[ée]couteur|headphone/i, emoji: "🎧" },
  { re: /watch|montre/i, emoji: "⌚" },
  { re: /voiture|\bcar\b|tesla|v[ée]hicule|scooter|moto/i, emoji: "🚗" },
  { re: /voyage|trip|vacances|travel|s[ée]jour/i, emoji: "✈️" },
  { re: /console|playstation|\bps5\b|xbox|nintendo|switch/i, emoji: "🎮" },
  { re: /cam[ée]ra|gopro|objectif|appareil photo/i, emoji: "📷" },
  { re: /v[ée]lo|bike/i, emoji: "🚲" },
];

/** Emoji d'affichage d'une récompense physique (dérivé du libellé). */
export function rewardEmoji(libelle?: string): string {
  const s = (libelle ?? "").trim();
  if (!s) return DEFAULT_ITEM_EMOJI;
  for (const r of ITEM_EMOJI_RULES) if (r.re.test(s)) return r.emoji;
  return DEFAULT_ITEM_EMOJI;
}

/** Récompense d'affichage d'un palier (cash → $, nature → item physique). */
export function rewardOf(tier: {
  rewardType: "cash" | "nature";
  montant?: number;
  libelle?: string;
}): ProgressionReward {
  if (tier.rewardType === "cash") {
    return { kind: "cash", amount: round2(tier.montant ?? 0), emoji: CASH_EMOJI };
  }
  const label = (tier.libelle ?? "").trim() || "Récompense";
  return { kind: "item", label, emoji: rewardEmoji(tier.libelle) };
}

/** Clamp d'une fraction dans [0, 1] (NaN/Inf → 0). */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// Seuils GÉNÉRIQUES de victoires (badges) — distincts des paliers bonus du
// projet (qui, eux, viennent de la config, jamais en dur). Petit set volontaire.
const POST_MILESTONES = [1, 5, 10, 25] as const;
const VIEW_MILESTONES = [100_000, 1_000_000] as const;

/** Victoires (badges) dérivées à la lecture — aucune persistance. */
export function computeVictories(input: {
  cumulViews: number;
  publishedPostsCount: number;
  tiersUnlocked: number;
}): ProgressionVictory[] {
  const { cumulViews, publishedPostsCount, tiersUnlocked } = input;
  const out: ProgressionVictory[] = [];
  // Posts publiés.
  const postEmojis: Record<number, string> = {
    1: "🎬",
    5: "🎥",
    10: "📹",
    25: "🍿",
  };
  for (const m of POST_MILESTONES) {
    out.push({
      id: `posts-${m}`,
      emoji: postEmojis[m] ?? "🎬",
      label: m === 1 ? "Première vidéo publiée" : `${m} vidéos publiées`,
      hint: `${publishedPostsCount}/${m}`,
      achieved: publishedPostsCount >= m,
    });
  }
  // Vues cumulées (badges génériques).
  const viewEmojis: Record<number, string> = {
    100_000: "🔥",
    1_000_000: "🚀",
  };
  const viewLabels: Record<number, string> = {
    100_000: "100 k vues cumulées",
    1_000_000: "1 M de vues cumulées",
  };
  for (const m of VIEW_MILESTONES) {
    out.push({
      id: `views-${m}`,
      emoji: viewEmojis[m] ?? "🔥",
      label: viewLabels[m] ?? `${m} vues`,
      hint: "vues cumulées",
      achieved: cumulViews >= m,
    });
  }
  // Premier palier de récompense débloqué.
  out.push({
    id: "tier-1",
    emoji: "🏆",
    label: "Premier palier débloqué",
    hint: "récompenses",
    achieved: tiersUnlocked >= 1,
  });
  return out;
}

/**
 * Construit le view-model de progression à partir des données brutes serveur.
 * RÉUTILISE `evaluateBonusTiers` (moteur) pour crossed/nextTier/viewsToNext.
 */
export function buildProgression(input: ProgressionInput): ProgressionView {
  const cumulViews = Math.max(0, input.cumulViews);
  const sorted = [...input.tiers].sort((a, b) => a.seuilVues - b.seuilVues);
  const ev = evaluateBonusTiers(cumulViews, sorted);

  // Date de déblocage la plus PRÉCOCE par seuil (unlocks persistés).
  const unlockedAtByThreshold = new Map<number, number>();
  for (const u of input.unlocks) {
    const prev = unlockedAtByThreshold.get(u.seuilVues);
    if (prev === undefined || u.unlockedAt < prev) {
      unlockedAtByThreshold.set(u.seuilVues, u.unlockedAt);
    }
  }

  const ladder: LadderEntry[] = sorted.map((t) => {
    const unlockedAt = unlockedAtByThreshold.get(t.seuilVues);
    return {
      threshold: t.seuilVues,
      reward: rewardOf(t),
      unlocked: cumulViews >= t.seuilVues,
      ...(unlockedAt !== undefined ? { unlockedAt } : {}),
    };
  });

  // Progression vers le prochain palier : du seuil franchi le plus haut (ou 0)
  // jusqu'au prochain seuil.
  const next = ev.nextTier;
  const prevThreshold =
    ev.crossed.length > 0 ? ev.crossed[ev.crossed.length - 1].seuilVues : 0;
  const span = next ? next.seuilVues - prevThreshold : 0;
  const done = next ? cumulViews - prevThreshold : 0;
  const progressToNext = next ? clamp01(span > 0 ? done / span : 1) : 1;

  const cashUnlockedTotal = round2(
    input.unlocks
      .filter((u) => u.rewardType === "cash")
      .reduce((s, u) => s + (u.montant ?? 0), 0),
  );
  const itemsUnlocked = input.unlocks
    .filter((u) => u.rewardType === "nature")
    .map((u) => ({
      label: (u.libelle ?? "").trim() || "Récompense",
      emoji: rewardEmoji(u.libelle),
      unlockedAt: u.unlockedAt,
    }))
    .sort((a, b) => a.unlockedAt - b.unlockedAt);

  return {
    cumulViews,
    publishedPostsCount: Math.max(0, input.publishedPostsCount),
    ladder,
    nextReward: next ? rewardOf(next) : null,
    nextThreshold: next ? next.seuilVues : null,
    progressToNext,
    remainingViews: ev.viewsToNext ?? 0,
    cashUnlockedTotal,
    itemsUnlocked,
    victories: computeVictories({
      cumulViews,
      publishedPostsCount: input.publishedPostsCount,
      tiersUnlocked: ladder.filter((l) => l.unlocked).length,
    }),
  };
}
