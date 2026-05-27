/**
 * Helpers de statut compte (warmup / actif / shadowban / archived) + durées de
 * warmup par plateforme. Pure functions, testables Vitest (cf
 * compte-status.test.ts). Les fonctions temporelles acceptent un paramètre
 * `now` (défaut Date.now()) pour des tests déterministes.
 */
export type CompteStatus = "warmup" | "actif" | "shadowban" | "archived";
export type Plateforme = "TikTok" | "Instagram" | "YouTube";

const DAY_MS = 86_400_000;

/**
 * Durée de warmup (en jours) par plateforme. Source unique côté UI ; le
 * décompte affiché (J+X/N) en dérive directement.
 */
export const WARMUP_DURATION_BY_PLATFORM: Record<Plateforme, number> = {
  TikTok: 7,
  Instagram: 14,
  YouTube: 3,
};

export interface StatusConfig {
  label: string;
  /**
   * Classes Tailwind du badge (border/bg/text), cohérentes avec les badges
   * inline préexistants de /comptes. Décision #10 :
   * warmup=amber, actif=emerald, shadowban=rose, archived=slate.
   */
  className: string;
}

export const STATUS_CONFIG: Record<CompteStatus, StatusConfig> = {
  warmup: {
    label: "Warmup",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  actif: {
    label: "Actif",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  shadowban: {
    label: "Shadowban",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  archived: {
    label: "Archivé",
    className: "border-slate-200 bg-slate-50 text-slate-500",
  },
};

/**
 * Badge d'un warmup arrivé à terme : bleu d'attention « À valider » (invite à
 * passer le compte en actif). Distinct de l'amber du warmup en cours.
 */
export const WARMUP_DONE_CONFIG: StatusConfig = {
  label: "À valider",
  className: "border-blue-200 bg-blue-50 text-blue-700",
};

export function getWarmupDuration(plateforme: Plateforme): number {
  return WARMUP_DURATION_BY_PLATFORM[plateforme];
}

export function getWarmupDaysElapsed(
  warmupStartedAt: number,
  now: number = Date.now(),
): number {
  return Math.floor((now - warmupStartedAt) / DAY_MS);
}

export function getWarmupDaysRemaining(
  warmupStartedAt: number,
  plateforme: Plateforme,
  now: number = Date.now(),
): number {
  return Math.max(
    0,
    getWarmupDuration(plateforme) - getWarmupDaysElapsed(warmupStartedAt, now),
  );
}

export function isWarmupComplete(
  warmupStartedAt: number,
  plateforme: Plateforme,
  now: number = Date.now(),
): boolean {
  return (
    getWarmupDaysElapsed(warmupStartedAt, now) >= getWarmupDuration(plateforme)
  );
}

export function isSelectableForPublication(status: CompteStatus): boolean {
  return status === "actif";
}

export function formatWarmupBadge(
  warmupStartedAt: number,
  plateforme: Plateforme,
  now: number = Date.now(),
): string {
  const elapsed = getWarmupDaysElapsed(warmupStartedAt, now);
  return `J+${elapsed}/${getWarmupDuration(plateforme)}`;
}

/**
 * Coercion legacy → statut effectif pour les rows non encore migrées
 * (status undefined). ⚠️ Dupliqué côté serveur (convex/comptes.ts
 * effectiveStatus) : Convex ne peut pas importer lib/. Garder les deux en
 * phase. Règle : actif === false → "archived", sinon "actif".
 */
export function getEffectiveStatus(c: {
  status?: CompteStatus;
  actif?: boolean;
}): CompteStatus {
  return c.status ?? (c.actif === false ? "archived" : "actif");
}

/**
 * Descripteur de badge prêt à rendre (label + className). Centralise la logique
 * « warmup en cours (J+X/N) vs warmup terminé (À valider) vs statut simple »
 * pour que le JSX reste trivial dans /comptes ET la vue détail — pas de
 * duplication de cette décision d'affichage.
 */
export function getStatusBadge(
  c: {
    status?: CompteStatus;
    actif?: boolean;
    plateforme: Plateforme;
    warmupStartedAt?: number;
  },
  now: number = Date.now(),
): StatusConfig {
  const status = getEffectiveStatus(c);
  if (status === "warmup" && c.warmupStartedAt !== undefined) {
    if (isWarmupComplete(c.warmupStartedAt, c.plateforme, now)) {
      return WARMUP_DONE_CONFIG;
    }
    return {
      label: `Warmup ${formatWarmupBadge(c.warmupStartedAt, c.plateforme, now)}`,
      className: STATUS_CONFIG.warmup.className,
    };
  }
  return STATUS_CONFIG[status];
}
