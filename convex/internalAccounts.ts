/**
 * Comptes INTERNES (équipe RepackIt/Snytch) — exclus de TOUTES les métriques du
 * hub Analytics (règle A4). Source UNIQUE : ce module. Un compteur visible du
 * nombre exclu accompagne l'exclusion (cf posthogSync `internalExcluded`).
 *
 * PostHog : le marqueur PRIMAIRE est la propriété PERSONNE `is_internal`. Vérifié
 * en prod (eu/231200) : elle EXISTE déjà et marque 6 personnes ; les fragments de
 * handle (« sofiamatcha22 »/« matcha ») ne matchent RIEN dans distinct_id/email/
 * username. On n'a donc PAS besoin de liste en dur pour Snytch — `handles` reste
 * un filet (fragment cherché dans distinct_id/email/username) pour un projet où
 * la propriété manquerait, vide par défaut.
 *
 * Whop : whopPayments ne porte pas d'email → seul le membershipId permet
 * d'exclure un abonnement interne. `whopMembershipIds` À RENSEIGNER quand l'id de
 * l'abonnement interne sera connu (aucune jointure person↔membership disponible).
 *
 * Vit en convex/ (posthogSync + analyticsHub le consomment ; un module convex/ ne
 * peut pas importer lib/). Testable côté lib via `import ../convex/internalAccounts`.
 */

export interface InternalAccountsConfig {
  /** Fragments (insensible casse) cherchés dans distinct_id/email/username. */
  handles: string[];
  /** MembershipIds Whop internes (exclusion du revenu). */
  whopMembershipIds: string[];
}

const EMPTY: InternalAccountsConfig = { handles: [], whopMembershipIds: [] };

const BY_SLUG: Record<string, InternalAccountsConfig> = {
  // is_internal suffit en prod côté PostHog (6 personnes) → aucun handle en dur.
  // Côté Whop, le compte de TEST de l'admin (vérifié : mem_4Hrv8RLuDels71, plan
  // 7,99 €, encaissé) doit être exclu du revenu ET du compte « clients payants ».
  snytch: { handles: [], whopMembershipIds: ["mem_4Hrv8RLuDels71"] },
};

export function internalAccountsFor(slug: string): InternalAccountsConfig {
  return BY_SLUG[slug] ?? EMPTY;
}

/** Retire les caractères dangereux d'un fragment avant injection littérale. */
function sanitize(s: string): string {
  return s.replace(/['"\\]/g, "");
}

/**
 * Expression HogQL vraie si le person est INTERNE : propriété `is_internal`
 * (marqueur primaire, déjà émis) OU un handle interne dans distinct_id/email/
 * username. `person.properties` sont constantes par personne → un filtre au
 * niveau event exclut TOUTES les lignes de l'interne.
 */
export function internalMarkerHogQL(cfg: InternalAccountsConfig): string {
  const parts = ["toString(person.properties.is_internal) = 'true'"];
  for (const h of cfg.handles) {
    const q = sanitize(h);
    if (q === "") continue;
    parts.push(`positionCaseInsensitive(toString(distinct_id), '${q}') > 0`);
    parts.push(`positionCaseInsensitive(toString(person.properties.email), '${q}') > 0`);
    parts.push(`positionCaseInsensitive(toString(person.properties.username), '${q}') > 0`);
  }
  return parts.join("\n    OR ");
}

/** Clause ` AND NOT (...)` à injecter dans un WHERE d'events (jamais vide). */
export function notInternalClause(cfg: InternalAccountsConfig): string {
  return `\n  AND NOT (${internalMarkerHogQL(cfg)})`;
}

/**
 * Expression HogQL vraie si la personne a FORCÉ son bras d'A/B test au moins une
 * fois (`ab_forced = true`, posé par l'override de QA `?ab=soft|hard`).
 *
 * Exclusion au niveau PERSONNE, pas event : une session forcée émet ses premiers
 * events AVANT que le bras ne s'attache (délai mesuré en prod de 1 s à 85 s),
 * donc filtrer sur `properties.ab_forced` seul laisserait passer le début de
 * chaque session de test — inscription et premiers pageviews compris.
 *
 * `ab_forced` n'est PAS une person property : il faut le sous-select. Fenêtre
 * alignée sur celle des requêtes appelantes, sinon une session forcée hors
 * fenêtre du sous-select redeviendrait comptable.
 */
export function forcedExperimentMarkerHogQL(windowDays: number): string {
  return `person_id IN (
      SELECT person_id FROM events
      WHERE toString(properties.ab_forced) = 'true'
        AND timestamp >= now() - INTERVAL ${windowDays} DAY
    )`;
}

/** Clause ` AND NOT (...)` écartant les sessions de test à bras forcé. */
export function notForcedExperimentClause(windowDays: number): string {
  return `\n  AND NOT (${forcedExperimentMarkerHogQL(windowDays)})`;
}

/** true si ce paiement Whop est un abonnement interne (par membershipId). */
export function isInternalWhopMembership(
  membershipId: string | undefined,
  cfg: InternalAccountsConfig,
): boolean {
  return (
    membershipId !== undefined && cfg.whopMembershipIds.includes(membershipId)
  );
}
