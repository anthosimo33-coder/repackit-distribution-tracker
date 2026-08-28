/**
 * Helpers de statut compte (warmup / actif / shadowban / archived) + durées de
 * warmup par plateforme. Pure functions, testables Vitest (cf
 * compte-status.test.ts). Les fonctions temporelles acceptent un paramètre
 * `now` (défaut Date.now()) pour des tests déterministes.
 */
import {
  warmupTargetDaysOf,
  isWarmupComplete,
  effectiveTargetDays,
  type WarmupTargetDays,
} from "./warmup";

export type CompteStatus = "warmup" | "actif" | "shadowban" | "archived";
export type Plateforme = "TikTok" | "Instagram" | "YouTube";

/**
 * Durée de warmup (en jours) par plateforme. DÉRIVÉE de lib/warmup
 * (WARMUP_TARGET_DAYS) — barème unique de toute l'app (P5). Le décompte affiché
 * (J+X/N) en dérive directement. Un compte peut surcharger sa durée via
 * warmupProtocol.targetDays (cf getEffectiveWarmupDuration).
 */
/**
 * Barème de DERNIER RECOURS, sous forme capitalisée. Ce n'est PAS « le barème
 * de l'app » : chaque projet a le sien (`projects.warmupTargetDays`). Ne l'employer
 * que là où aucun projet n'est atteignable, et jamais pour figer un warmup.
 */
export const WARMUP_DURATION_FALLBACK: Record<Plateforme, number> = (() => {
  const d = warmupTargetDaysOf({});
  return { TikTok: d.tiktok, Instagram: d.instagram, YouTube: d.youtube };
})();

/**
 * Durée de warmup EFFECTIVE d'un compte : surcharge admin
 * (warmupProtocol.targetDays) sinon défaut plateforme. À utiliser partout où le
 * décompte doit refléter le protocole réel du compte (badge, carte, colonne).
 */
export function getEffectiveWarmupDuration(
  c: {
    plateforme: Plateforme;
    warmupProtocol?: { targetDays?: number } | null;
  },
  days: WarmupTargetDays = warmupTargetDaysOf({}),
): number {
  return effectiveTargetDays(
    { plateforme: c.plateforme, warmupProtocol: c.warmupProtocol ?? undefined },
    days,
  );
}

export interface StatusConfig {
  /** Clé i18n, pas un libellé : cette table est rendue en FR et en EN. */
  labelKey: string;
  /**
   * Variante MINUSCULE, pour les phrases où le statut est incrusté
   * (« Compte actif. Rien à faire… »). Une clé distincte, jamais un
   * `.toLowerCase()` sur le libellé : la casse anglaise ne suit pas les mêmes
   * règles, et l'ordre des mots change (« Phase de warm-up » / « Warm-up
   * phase »). Cf I18N-TEXTE-AUSSI-DONNEE.md, famille B.
   */
  inlineKey: string;
  /** Paramètres d'interpolation (warmup en cours : jour fait / cible). */
  params?: Record<string, string | number>;
  /**
   * Classes Tailwind du badge (border/bg/text), cohérentes avec les badges
   * inline préexistants de /comptes. Décision #10 :
   * warmup=amber, actif=emerald, shadowban=rose, archived=slate.
   */
  className: string;
}

export const STATUS_CONFIG: Record<CompteStatus, StatusConfig> = {
  warmup: {
    labelKey: "status.compte.warmup",
    inlineKey: "status.compteInline.warmup",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  actif: {
    labelKey: "status.compte.actif",
    inlineKey: "status.compteInline.actif",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  shadowban: {
    labelKey: "status.compte.shadowban",
    inlineKey: "status.compteInline.shadowban",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  archived: {
    labelKey: "status.compte.archive",
    inlineKey: "status.compteInline.archive",
    className: "border-slate-200 bg-slate-50 text-slate-500",
  },
};

/**
 * Badge d'un warmup arrivé à terme : bleu d'attention « À valider » (invite à
 * passer le compte en actif). Distinct de l'amber du warmup en cours.
 */
export const WARMUP_DONE_CONFIG: StatusConfig = {
  labelKey: "status.compte.aValider",
    inlineKey: "status.compteInline.aValider",
  className: "border-blue-200 bg-blue-50 text-blue-700",
};

export function getWarmupDuration(plateforme: Plateforme): number {
  return WARMUP_DURATION_FALLBACK[plateforme];
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
  return isWarmupComplete(
    { plateforme: c.plateforme, warmupProtocol: c.warmupProtocol ?? undefined },
    warmupTargetDaysOf({}),
  );
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
      labelKey: "status.compte.warmupProgress",
      inlineKey: "status.compteInline.warmupProgress",
      params: { done, target },
      className: STATUS_CONFIG.warmup.className,
    };
  }
  return STATUS_CONFIG[status];
}
