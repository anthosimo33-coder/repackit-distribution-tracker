/**
 * Helpers de statut compte (warmup / actif / shadowban / archived) + durées de
 * warmup par plateforme. Pure functions, testables Vitest (cf
 * compte-status.test.ts). Les fonctions temporelles acceptent un paramètre
 * `now` (défaut Date.now()) pour des tests déterministes.
 */
import { WARMUP_TARGET_DAYS, isWarmupComplete } from "./warmup";

export type CompteStatus = "warmup" | "actif" | "shadowban" | "archived";
export type Plateforme = "TikTok" | "Instagram" | "YouTube";

/**
 * Durée de warmup (en jours) par plateforme. DÉRIVÉE de lib/warmup
 * (WARMUP_TARGET_DAYS) — barème unique de toute l'app (P5). Le décompte affiché
 * (J+X/N) en dérive directement. Un compte peut surcharger sa durée via
 * warmupProtocol.targetDays (cf getEffectiveWarmupDuration).
 */
export const WARMUP_DURATION_BY_PLATFORM: Record<Plateforme, number> = {
  TikTok: WARMUP_TARGET_DAYS.tiktok,
  Instagram: WARMUP_TARGET_DAYS.instagram,
  YouTube: WARMUP_TARGET_DAYS.youtube,
};

/**
 * Durée de warmup EFFECTIVE d'un compte : surcharge admin
 * (warmupProtocol.targetDays) sinon défaut plateforme. À utiliser partout où le
 * décompte doit refléter le protocole réel du compte (badge, carte, colonne).
 */
export function getEffectiveWarmupDuration(c: {
  plateforme: Plateforme;
  warmupProtocol?: { targetDays?: number } | null;
}): number {
  return c.warmupProtocol?.targetDays ?? WARMUP_DURATION_BY_PLATFORM[c.plateforme];
}

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

export function isSelectableForPublication(status: CompteStatus): boolean {
  return status === "actif";
}

/**
 * Warmup terminé pour un compte donné. ⚠️ Chantier B — fondé sur les CHECKS
 * RÉELS (délègue à lib/warmup.isWarmupComplete), plus sur le calendaire. Gère la
 * surcharge targetDays via la durée effective. Garde-fou : un compte sans
 * warmupStartedAt n'est pas considéré en warmup.
 */
export function isWarmupCompleteForCompte(c: {
  plateforme: Plateforme;
  warmupStartedAt?: number;
  warmupProtocol?: { targetDays?: number; dailyChecks?: string[] } | null;
}): boolean {
  if (c.warmupStartedAt === undefined) return false;
  return isWarmupComplete(c);
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
export function getStatusBadge(c: {
  status?: CompteStatus;
  actif?: boolean;
  plateforme: Plateforme;
  warmupStartedAt?: number;
  warmupProtocol?: { targetDays?: number; dailyChecks?: string[] } | null;
}): StatusConfig {
  const status = getEffectiveStatus(c);
  if (status === "warmup" && c.warmupStartedAt !== undefined) {
    // ⚠️ Chantier B — décompte fondé sur les CHECKS RÉELS (pas le calendaire).
    // Durée effective = surcharge protocole sinon défaut plateforme.
    const target = getEffectiveWarmupDuration(c);
    const done = c.warmupProtocol?.dailyChecks?.length ?? 0;
    if (done >= target) {
      return WARMUP_DONE_CONFIG;
    }
    return {
      label: `Warmup J+${done}/${target}`,
      className: STATUS_CONFIG.warmup.className,
    };
  }
  return STATUS_CONFIG[status];
}
