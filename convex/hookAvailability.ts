/**
 * DISPONIBILITÉ d'un hook — de l'AFFICHAGE, pas une nouvelle règle.
 *
 * Module PUR (aucun import Convex) : testable en vitest via
 * `lib/hook-availability.test.ts`. Même arrangement que `convex/graduation.ts`.
 *
 * ── Le grain, et pourquoi ce n'est pas celui qu'on croit ─────────────────────
 * On voudrait lire « ce hook est-il libre pour ce COMPTE ». Ce n'est pas la
 * règle qui existe. Les deux règles réellement appliquées à l'assignation sont :
 *
 *  1. UNICITÉ À VIE — par (créateur, plateforme) et sur le COMBO entier
 *     (hook:flux:cta), pas sur le hook seul. Un même hook peut donc revenir
 *     légitimement chez la même créatrice dans un autre combo. Les combos
 *     IMPOSÉS (« Rejouer ce script ») en sont exclus.
 *     Cf lib/script-combo-uniqueness.ts.
 *  2. COOLDOWN — par comboKey à l'échelle du PROJET, fenêtre de quelques jours
 *     autour d'une date visée. Cf lib/scriptCombos.ts (PR #55).
 *
 * Ce module ne fait que LIRE ces deux règles et les rendre lisibles par hook.
 * Il n'en invente aucune, ne touche pas au tirage, et ne doit jamais servir à
 * décider une assignation — seulement à l'éclairer.
 *
 * Conséquence assumée sur les libellés : on dit « utilisé par [créatrice] sur
 * [plateforme] », jamais « utilisé sur [compte] ». Le compte n'est pas le grain
 * de la règle ; l'afficher laisserait croire à une contrainte qui n'existe pas.
 */

/** Un usage passé d'un hook, réduit à ce dont l'affichage a besoin. */
export type HookUsage = {
  /** Créatrice qui a reçu le combo contenant ce hook. */
  creatorId: string;
  creatorName: string;
  /** Plateformes ciblées par l'assignation. */
  platforms: string[];
  /** Date d'ancrage (publication prévue, à défaut réelle). null = aucune. */
  anchorAt: number | null;
  /** Combo IMPOSÉ : hors unicité à vie (mais occupe la fenêtre de cooldown). */
  comboImposed: boolean;
};

export type HookAvailability =
  | { kind: "free" }
  /** Unicité à vie : cette créatrice a déjà eu ce hook sur cette plateforme. */
  | {
      kind: "used";
      creatorName: string;
      platform: string;
      /** Date d'ancrage de l'usage, null si l'assignation n'en portait pas. */
      at: number | null;
    }
  /** Fenêtre de cooldown projet encore ouverte. */
  | { kind: "cooldown"; until: number };

/**
 * État d'un hook POUR UNE CRÉATRICE DONNÉE à une date visée.
 *
 * Ordre de priorité : l'unicité à vie d'abord (c'est un refus DÉFINITIF pour ce
 * couple créatrice×plateforme), le cooldown ensuite (un simple délai). Annoncer
 * « libre dans 2 jours » sur un hook qu'elle ne pourra jamais reprendre serait
 * un mensonge par omission.
 *
 * `targetAt` nul (pas de date visée) → pas de fenêtre de cooldown calculable,
 * seule l'unicité s'applique. C'est la même convention que
 * `comboKeysInCooldown`.
 */
export function hookAvailabilityFor(input: {
  usages: readonly HookUsage[];
  creatorId: string;
  /** Plateformes que l'assignation envisagée viserait. */
  platforms: readonly string[];
  targetAt: number | null;
  cooldownMs: number;
}): HookAvailability {
  const { usages, creatorId, platforms, targetAt, cooldownMs } = input;

  // 1) Unicité à vie — même créatrice, même plateforme, combo NON imposé.
  for (const u of usages) {
    if (u.comboImposed) continue;
    if (u.creatorId !== creatorId) continue;
    const collision = u.platforms.find((p) => platforms.includes(p));
    if (collision !== undefined) {
      return {
        kind: "used",
        creatorName: u.creatorName,
        platform: collision,
        at: u.anchorAt,
      };
    }
  }

  // 2) Cooldown projet — tous créateurs confondus, imposés COMPRIS (un combo
  //    imposé est une publication réelle, il sort le même jour que les autres).
  if (targetAt !== null) {
    let until: number | null = null;
    for (const u of usages) {
      if (u.anchorAt === null) continue;
      if (Math.abs(u.anchorAt - targetAt) >= cooldownMs) continue;
      const libreLe = u.anchorAt + cooldownMs;
      if (until === null || libreLe > until) until = libreLe;
    }
    // La date rendue est la PLUS TARDIVE : c'est celle à partir de laquelle le
    // hook est réellement libre. Rendre la plus proche promettrait une
    // disponibilité qu'un autre usage bloque encore.
    if (until !== null) return { kind: "cooldown", until };
  }

  return { kind: "free" };
}

/** Le hook est-il assignable à cette créatrice à cette date ? (filtre de la page) */
export function isHookAvailable(a: HookAvailability): boolean {
  return a.kind === "free";
}
