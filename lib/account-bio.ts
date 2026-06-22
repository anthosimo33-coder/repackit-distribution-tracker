// ─── Bio à mettre (par compte) — logique de transition pure ──────────────────
//
// ⚠️ A6 (cross-tsconfig) : convex/ ne peut PAS importer lib/. La décision de
// transition (computeBioPatch) est DUPLIQUÉE à l'identique dans convex/comptes.ts
// (mutation setAccountBio). Toute évolution de cette règle doit être répliquée
// dans les deux fichiers. La garder triviale limite le risque de drift ; les
// transitions sont testées ici (vitest) ET de bout en bout (e2e).

export type BioStatus = "to_apply" | "applied";

/** Sous-ensemble bio d'un compte (les 4 champs persistés). */
export interface BioState {
  bioToApply?: string;
  bioStatus?: BioStatus;
  bioUpdatedAt?: number;
  bioAppliedAt?: number;
}

/**
 * Patch à appliquer (ctx.db.patch). Une valeur `undefined` UNSET le champ
 * (sémantique Convex). `null` n'est jamais utilisé ici.
 */
export interface BioPatch {
  bioToApply?: string | undefined;
  bioStatus?: BioStatus | undefined;
  bioUpdatedAt?: number | undefined;
  bioAppliedAt?: number | undefined;
}

/**
 * Décision serveur quand l'ADMIN enregistre `rawBio` sur un compte.
 *
 *  - bio vidée (trim === "") : si aucune bio n'existait → no-op (null) ; sinon
 *    on EFFACE tout (plus de bio → le créateur ne voit plus rien).
 *  - bio inchangée (même texte, état déjà suivi) : no-op (null) — éviter de
 *    repasser bêtement en "to_apply" quand l'admin re-sauve sans rien changer.
 *  - bio posée pour la 1re fois OU modifiée : retour en "to_apply",
 *    bioUpdatedAt = now, et on PURGE bioAppliedAt (l'ancienne date d'application
 *    n'a plus de sens tant que le créateur n'a pas re-confirmé).
 *
 * Retourne `null` quand il n'y a rien à écrire (no-op).
 */
export function computeBioPatch(
  current: BioState,
  rawBio: string,
  now: number,
): BioPatch | null {
  const bio = rawBio.trim();

  if (bio.length === 0) {
    // Rien à effacer.
    if (current.bioToApply === undefined) return null;
    return {
      bioToApply: undefined,
      bioStatus: undefined,
      bioUpdatedAt: undefined,
      bioAppliedAt: undefined,
    };
  }

  // Même texte, déjà suivi (to_apply ou applied) → ne pas perturber l'état.
  if (current.bioToApply === bio && current.bioStatus !== undefined) {
    return null;
  }

  // Nouvelle bio ou bio modifiée → (re)passe en "à appliquer".
  return {
    bioToApply: bio,
    bioStatus: "to_apply",
    bioUpdatedAt: now,
    bioAppliedAt: undefined,
  };
}

export type BioTone = "none" | "pending" | "applied";

/** Libellé + tonalité de l'état bio (admin & créateur partagent le vocabulaire). */
export function bioStateLabel(state: BioState): { label: string; tone: BioTone } {
  if (state.bioToApply === undefined || state.bioStatus === undefined) {
    return { label: "Aucune bio définie", tone: "none" };
  }
  if (state.bioStatus === "to_apply") {
    return { label: "En attente d'application", tone: "pending" };
  }
  return { label: "Appliquée", tone: "applied" };
}

/** Une bio est « à mettre à jour » (notif créateur) ssi posée ET en to_apply. */
export function isBioPending(state: BioState): boolean {
  return state.bioToApply !== undefined && state.bioStatus === "to_apply";
}
