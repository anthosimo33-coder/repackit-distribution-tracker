/**
 * RATTACHEMENT revenu ↔ bras d'A/B test — POINT DE PASSAGE UNIQUE.
 *
 * Le bras d'un abonnement Whop se lit par DEUX voies : la metadata
 * `abVariant` posée au checkout (primaire, insensible au dénouement du
 * paiement) et le repli `distinctId` → personne PostHog. Avant ce module, la
 * garde qui écarte les personnes à bras INSTABLE (« flippers ») n'existait que
 * sous forme d'ABSENCE dans le cache `abPersonArms` : elle ne mordait donc que
 * sur le repli. Dès que la metadata existait, `abVariant ?? fromPosthog`
 * court-circuitait la garde et rattachait à un bras le revenu d'une personne
 * que le tableau par bras avait explicitement écartée de TOUTES ses colonnes —
 * numérateur (€) et dénominateur (assignés) ne portaient plus sur la même
 * population. Mesuré en prod le 22/08/2026 : 3 abonnements, 18,23 €.
 *
 * La correction n'est pas un ordre de test : c'est de rendre les flippers
 * EXPLICITES (cache `abFlippers`, test POSITIF) pour que la garde puisse
 * s'appliquer AVANT de consulter l'une ou l'autre voie. Une absence ne peut
 * pas servir de garde : `distinctId` absent du cache est ambigu (flipper ?
 * jamais assigné ? payload tronqué ?).
 *
 * Module PUR (aucune dépendance Convex/React), vit dans convex/ parce qu'un
 * module convex/ ne peut pas importer lib/ (règle A6) et que c'est
 * convex/analyticsHub.ts qui le consomme. Testé depuis lib/ab-attribution.test.ts.
 */

/** Voie par laquelle le bras a été résolu. */
export type ArmSource = "metadata" | "distinctId";

/**
 * Motif de NON-rattachement. Chacun doit être COMPTÉ et affiché : une exclusion
 * silencieuse se lit comme un bras qui vend mal.
 */
export type ArmRejection =
  | "forced" // session de QA (`ab_forced`) : hors revenu comme hors events
  | "flipper" // deux valeurs d'`experiment_variant` : écartée de toutes les colonnes
  | "unassigned"; // aucune des deux voies ne rend de bras

export type ArmResolution =
  | { variant: string; via: ArmSource; rejected: null }
  | { variant: null; via: null; rejected: ArmRejection };

/** Ce qu'un abonnement Whop apporte à la résolution. */
export interface ArmCandidate {
  /** `metadata.abVariant` posée au checkout (voie primaire). */
  abVariant?: string | null;
  /** Bras FORCÉ par l'override de QA `?ab=soft|hard`. */
  abForced?: boolean | null;
  /** Personne PostHog (voie de repli ET porteuse de la garde flipper). */
  distinctId?: string | null;
}

/** Tables de résolution, lues du cache PostHog. */
export interface ArmLookup {
  /** `distinct_id` → bras, pour les personnes à bras STABLE uniquement. */
  personArms: ReadonlyMap<string, string>;
  /**
   * `distinct_id` des personnes à bras INSTABLE. Test POSITIF : c'est lui qui
   * permet d'appliquer la garde sur les DEUX voies. Un distinctId qui n'y
   * figure pas n'est pas « sain » pour autant — il peut n'avoir jamais été
   * assigné —, mais un distinctId qui y figure est écarté à coup sûr.
   */
  flipperDistinctIds: ReadonlySet<string>;
}

/**
 * Résout le bras d'UN abonnement. Ordre imposé, et c'est tout le correctif :
 * les gardes (forcé, flipper) passent AVANT les deux voies de lecture, de sorte
 * qu'aucune metadata ne peut les contourner.
 *
 * ⚠️ Limite assumée : la garde flipper s'exerce par `distinctId`. Un abonnement
 * SANS distinctId ne peut pas être contrôlé et reste rattaché par sa metadata
 * (prod au 22/08/2026 : 123 memberships sur 123 en portent un — le cas est
 * théorique, il est traité pour ne pas dépendre de cette chance).
 */
export function resolveArm(m: ArmCandidate, lookup: ArmLookup): ArmResolution {
  if (m.abForced === true) return { variant: null, via: null, rejected: "forced" };

  const did = m.distinctId ?? null;
  if (did !== null && lookup.flipperDistinctIds.has(did)) {
    return { variant: null, via: null, rejected: "flipper" };
  }

  const meta = normalizeVariant(m.abVariant);
  if (meta !== null) return { variant: meta, via: "metadata", rejected: null };

  const fallback = did === null ? undefined : lookup.personArms.get(did);
  const viaPerson = normalizeVariant(fallback);
  if (viaPerson !== null) return { variant: viaPerson, via: "distinctId", rejected: null };

  return { variant: null, via: null, rejected: "unassigned" };
}

/**
 * Une valeur de bras vide, `"null"` ou `"NULL"` n'est PAS un bras. Les requêtes
 * HogQL rendent la chaîne `'null'` pour une propriété absente (`toString(NULL)`)
 * et le champ Whop peut arriver en chaîne vide : sans ce filtre, un bras nommé
 * « null » apparaîtrait comme une troisième colonne dans la carte.
 */
function normalizeVariant(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "" || s.toLowerCase() === "null" || s === "undefined") return null;
  return s;
}

/**
 * Divergence entre les deux voies pour un abonnement rattaché. Elle est
 * SIGNALÉE, jamais tranchée en silence : un rattachement faux est pire qu'un
 * rattachement absent. Rend null quand une seule voie a une valeur (cas normal).
 */
export function armDivergence(
  m: ArmCandidate,
  lookup: ArmLookup,
): { metadata: string; posthog: string } | null {
  const meta = normalizeVariant(m.abVariant);
  const did = m.distinctId ?? null;
  const posthog = normalizeVariant(did === null ? undefined : lookup.personArms.get(did));
  if (meta === null || posthog === null || meta === posthog) return null;
  return { metadata: meta, posthog };
}
