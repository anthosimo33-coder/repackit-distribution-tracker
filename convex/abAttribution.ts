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
 * ⚠️ MISE À JOUR 24/10/2026 — UN FLIPPER N'EST PLUS ÉCARTÉ PAR PRINCIPE. Les
 * personnes à deux `experiment_variant` sont surtout des ACHETEURS : 44 des 248
 * nouveaux clients du test `paywall_pass_2026_10` (18 %, contre 1,4 % des
 * non-acheteurs), et 25 d'entre eux changent de bras APRÈS le paiement. Les
 * écarter retirait de vraies conversions, plus d'un côté que de l'autre (31
 * pass contre 13 hard) : la carte affichait une conversion pass sous-estimée.
 * `attributeFlipper` les rattache désormais à l'offre qu'ils ont RÉELLEMENT
 * ouverte (famille du plan du checkout), et n'écarte que ceux qui ne disent
 * rien d'univoque. La même règle sert les colonnes PostHog (classes de
 * `abArms` / `abPurchases`) et le revenu (liste `abFlippers`), au niveau
 * PERSONNE : une personne n'est jamais dans un bras côté clients et dans
 * l'autre côté argent.
 *
 * Module PUR (aucune dépendance Convex/React), vit dans convex/ parce qu'un
 * module convex/ ne peut pas importer lib/ (règle A6) et que c'est
 * convex/analyticsHub.ts qui le consomme. Testé depuis lib/ab-attribution.test.ts.
 */

/**
 * Voie par laquelle le bras a été résolu. `flipperRule` = personne à bras
 * instable, rattachée par `attributeFlipper` (offre ouverte au checkout, ou
 * paywall vu) : elle passe AVANT la metadata, qui n'est que l'étiquette du
 * moment du paiement.
 */
export type ArmSource = "metadata" | "distinctId" | "flipperRule";

/**
 * Motif de NON-rattachement. Chacun doit être COMPTÉ et affiché : une exclusion
 * silencieuse se lit comme un bras qui vend mal.
 */
export type ArmRejection =
  | "forced" // session de QA (`ab_forced`) : hors revenu comme hors events
  | "flipper" // bras instable ET aucune preuve univoque (cf attributeFlipper) : écartée partout
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
  /**
   * `distinct_id` → bras RATTACHÉ par la règle flipper (`attributeFlipper`),
   * pour les seuls flippers qu'elle sait attribuer. Un flipper absent d'ici est
   * écarté. Absent tout entier (cache écrit avant le 24/10) = règle d'avant :
   * tous les flippers écartés.
   */
  flipperArms?: ReadonlyMap<string, string>;
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
    // Le bras d'un flipper est celui de la PERSONNE, décidé une fois pour toutes
    // par attributeFlipper — jamais la metadata : 10 flippers étiquetés « pass »
    // au paywall ont acheté l'hebdo (deep-dive du 24/10).
    const ruled = normalizeVariant(lookup.flipperArms?.get(did));
    if (ruled !== null) return { variant: ruled, via: "flipperRule", rejected: null };
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

// ─── Règle FLIPPER : à quel bras rattacher une personne à bras instable ──────

/**
 * FAMILLE d'un plan : l'avant-dernier segment du slug, préfixe produit ignoré.
 * `snytch_pass_7d` et `pass_7d` (le même plan, vu par `subscription_completed`
 * puis par `checkout_started`, qui n'émettent pas le même slug) → `pass` ;
 * `snytch_trio_weekly` → `trio`. Un slug sans rythme (`monthly`, émis par une
 * vieille build) n'a pas de famille : chaîne vide, jamais une famille devinée.
 *
 * ⚠️ DOIT rester identique à `planFamilySql` (convex/posthogSync.ts), qui fait
 * le même découpage côté HogQL (`splitByChar('_', plan)[-2]`).
 */
export function planFamilyOf(plan: string | null | undefined): string {
  if (typeof plan !== "string") return "";
  const parts = plan.trim().split("_");
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

/**
 * Ce que l'on sait d'une personne à deux `experiment_variant`. Les deux listes
 * sont des BRAS, pas des plans : la requête a déjà traduit chaque famille de
 * plan ouverte au checkout en bras, par la table apprise des personnes à bras
 * STABLE (cf `AbPlanFamily`).
 */
export interface FlipperEvidence {
  /** Bras des familles de plan ouvertes au checkout (familles inconnues retirées). */
  checkoutArms: readonly string[];
  /** Bras portés par ses `paywall_viewed` (l'étiquette du moment de la vue). */
  paywallArms: readonly string[];
}

export type FlipperOutcome =
  | { variant: string; via: "checkout" | "paywall"; excluded: null }
  | {
      variant: null;
      via: null;
      /**
       * `bothFamilies` : a ouvert le checkout des deux offres.
       * `bothPaywalls` : sans checkout attribuable, a vu le paywall des deux bras.
       * `noEvidence`   : ni checkout attribuable ni paywall vu — rien ne dit
       *                  quel traitement elle a subi (elle n'en a subi aucun).
       */
      excluded: "bothFamilies" | "bothPaywalls" | "noEvidence";
    };

function distinctArms(arms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const a of arms) {
    const v = normalizeVariant(a);
    if (v !== null) out.add(v);
  }
  return [...out].sort();
}

/**
 * Bras d'une personne qui a changé de bras. Ordre imposé :
 *  1. la FAMILLE DU PLAN OUVERT AU CHECKOUT — c'est l'offre qu'elle avait sous
 *     les yeux au moment de payer. L'étiquette `experiment_variant` du
 *     `paywall_viewed`, elle, ne le dit pas : 10 flippers « pass » par
 *     étiquette ont ouvert (et payé) l'hebdo ;
 *  2. à défaut de checkout attribuable, le bras de ses `paywall_viewed`, s'il
 *     est UNIQUE ;
 *  3. sinon, écartée — deux familles ouvertes, deux paywalls vus, ou rien vu.
 */
export function attributeFlipper(e: FlipperEvidence): FlipperOutcome {
  const ck = distinctArms(e.checkoutArms);
  if (ck.length > 1) return { variant: null, via: null, excluded: "bothFamilies" };
  if (ck.length === 1) return { variant: ck[0], via: "checkout", excluded: null };
  const pv = distinctArms(e.paywallArms);
  if (pv.length > 1) return { variant: null, via: null, excluded: "bothPaywalls" };
  if (pv.length === 1) return { variant: pv[0], via: "paywall", excluded: null };
  return { variant: null, via: null, excluded: "noEvidence" };
}

/**
 * Une entrée de la table « famille de plan → bras », apprise par la requête
 * des personnes à bras STABLE qui ont ouvert un checkout sur cette famille.
 * Rien n'est écrit en dur : la table de prix du dépôt a dérivé deux fois en un
 * mois sans que rien ne le signale, une table d'offres ferait pareil au
 * prochain test.
 */
export interface AbPlanFamily {
  family: string;
  variant: string;
  /** Personnes stables du bras `variant` ayant ouvert cette famille. */
  persons: number;
  /** Personnes stables, tous bras, ayant ouvert cette famille. */
  total: number;
}

/**
 * Décode la colonne `fam_map` de la requête (`famille=bras=n_bras=n_total`).
 * Une entrée illisible est IGNORÉE plutôt que devinée : elle ne ferait que
 * renvoyer ses flippers vers la règle du paywall.
 */
export function parsePlanFamilies(raw: readonly string[]): AbPlanFamily[] {
  const out: AbPlanFamily[] = [];
  for (const entry of raw) {
    const [family, variant, persons, total] = entry.split("=");
    const p = Number(persons);
    const t = Number(total);
    if (!family || normalizeVariant(variant) === null) continue;
    if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) continue;
    out.push({ family, variant: variant.trim(), persons: p, total: t });
  }
  return out.sort((a, b) => b.total - a.total || a.family.localeCompare(b.family));
}

/** Bilan VISIBLE de la règle flipper — chaque personne est dans une case. */
export interface FlipperAttributionReport {
  /** Rattachées par la famille du plan ouvert au checkout. */
  viaCheckout: number;
  /** Rattachées par le bras unique de leurs paywalls vus. */
  viaPaywall: number;
  /** Dont NOUVEAUX CLIENTS rattachés (toutes voies) — ceux que la carte perdait. */
  buyersReattributed: number;
  excludedBothFamilies: number;
  excludedBothPaywalls: number;
  excludedNoEvidence: number;
  /** Nouveaux clients restés écartés. */
  buyersExcluded: number;
}

export const EMPTY_FLIPPER_REPORT: FlipperAttributionReport = {
  viaCheckout: 0,
  viaPaywall: 0,
  buyersReattributed: 0,
  excludedBothFamilies: 0,
  excludedBothPaywalls: 0,
  excludedNoEvidence: 0,
  buyersExcluded: 0,
};

/**
 * Une CLASSE de personnes de la requête `abArms` : toutes les personnes
 * stables d'un bras, ou toutes les flippers qui partagent la même dernière
 * étiquette et les mêmes preuves. Les classes PARTITIONNENT les personnes :
 * leurs compteurs s'additionnent sans double compte.
 */
export interface AbArmClass extends FlipperEvidence {
  /** Dernière étiquette `experiment_variant` (le bras d'une personne stable). */
  label: string;
  stable: boolean;
  exposed: number;
  paywallViewers: number;
  checkouts: number;
  paid: number;
  renewals: number;
  paidWithoutCheckout: number;
  clientTargets: number;
  armTargets: number;
  /** Personnes vues sur plusieurs `$device_id`. */
  multiDevice: number;
}

/** Une ligne par bras, après attribution (la forme d'`AbArmsPayload.rows`). */
export interface AttributedArm {
  variant: string;
  exposed: number;
  paywallViewers: number;
  checkouts: number;
  paid: number;
  renewals: number;
  paidWithoutCheckout: number;
  clientTargets: number;
  armTargets: number;
  /** Flippers ÉCARTÉS, rangés sous leur DERNIÈRE étiquette (la ligne qu'ils auraient faussée). */
  excludedFlippers: number;
  excludedFlippersMultiDevice: number;
  excludedFlippersSameDevice: number;
  /** Flippers RATTACHÉS à ce bras par la règle — déjà inclus dans les colonnes ci-dessus. */
  reattributedFlippers: number;
}

/**
 * Agrège les classes en lignes de bras. Une personne stable compte dans son
 * bras ; une flipper compte dans le bras que lui donne `attributeFlipper`, ou
 * dans les écartées de sa dernière étiquette.
 */
export function attributeArmClasses(classes: readonly AbArmClass[]): {
  rows: AttributedArm[];
  report: FlipperAttributionReport;
} {
  const arms = new Map<string, AttributedArm>();
  const arm = (variant: string): AttributedArm => {
    let a = arms.get(variant);
    if (!a) {
      a = {
        variant,
        exposed: 0,
        paywallViewers: 0,
        checkouts: 0,
        paid: 0,
        renewals: 0,
        paidWithoutCheckout: 0,
        clientTargets: 0,
        armTargets: 0,
        excludedFlippers: 0,
        excludedFlippersMultiDevice: 0,
        excludedFlippersSameDevice: 0,
        reattributedFlippers: 0,
      };
      arms.set(variant, a);
    }
    return a;
  };
  const report = { ...EMPTY_FLIPPER_REPORT };
  for (const c of classes) {
    const label = normalizeVariant(c.label);
    if (label === null) continue;
    const outcome: FlipperOutcome | null = c.stable ? null : attributeFlipper(c);
    if (outcome !== null && outcome.variant === null) {
      const a = arm(label);
      a.excludedFlippers += c.exposed;
      a.excludedFlippersMultiDevice += c.multiDevice;
      a.excludedFlippersSameDevice += c.exposed - c.multiDevice;
      if (outcome.excluded === "bothFamilies") report.excludedBothFamilies += c.exposed;
      else if (outcome.excluded === "bothPaywalls") report.excludedBothPaywalls += c.exposed;
      else report.excludedNoEvidence += c.exposed;
      report.buyersExcluded += c.paid;
      continue;
    }
    const a = arm(outcome === null ? label : outcome.variant);
    a.exposed += c.exposed;
    a.paywallViewers += c.paywallViewers;
    a.checkouts += c.checkouts;
    a.paid += c.paid;
    a.renewals += c.renewals;
    a.paidWithoutCheckout += c.paidWithoutCheckout;
    a.clientTargets += c.clientTargets;
    a.armTargets += c.armTargets;
    if (outcome !== null) {
      a.reattributedFlippers += c.exposed;
      if (outcome.via === "checkout") report.viaCheckout += c.exposed;
      else report.viaPaywall += c.exposed;
      report.buyersReattributed += c.paid;
    }
  }
  return {
    rows: [...arms.values()].sort(
      (x, y) => y.exposed - x.exposed || x.variant.localeCompare(y.variant),
    ),
    report,
  };
}

/**
 * Une ligne de la requête `abPurchases` : (classe × plan acheté). `classClients`
 * et `classMultiPlan` sont les totaux de la CLASSE, répétés sur chacune de ses
 * lignes de plan — à lire une fois par classe, jamais à sommer ligne à ligne.
 */
export interface AbPurchaseClass extends FlipperEvidence {
  label: string;
  stable: boolean;
  plan: string;
  whopPlanId: string;
  clients: number;
  classClients: number;
  classMultiPlan: number;
}

/** La forme d'`AbPurchasesPayload.rows`, après attribution. */
export interface AttributedPurchase {
  variant: string;
  plan: string;
  whopPlanId: string;
  clients: number;
  armClients: number;
  armMultiPlan: number;
}

/** Même attribution que `attributeArmClasses`, appliquée aux achats. */
export function attributePurchaseClasses(
  rows: readonly AbPurchaseClass[],
): AttributedPurchase[] {
  const classKey = (r: AbPurchaseClass) =>
    JSON.stringify([r.label, r.stable, [...r.checkoutArms].sort(), [...r.paywallArms].sort()]);
  const byPlan = new Map<string, { variant: string; plan: string; whopPlanId: string; clients: number }>();
  const armTotals = new Map<string, { clients: number; multi: number; seen: Set<string> }>();
  for (const r of rows) {
    const label = normalizeVariant(r.label);
    if (label === null) continue;
    const variant = r.stable ? label : attributeFlipper(r).variant;
    if (variant === null) continue;
    const k = JSON.stringify([variant, r.plan, r.whopPlanId]);
    const line = byPlan.get(k) ?? { variant, plan: r.plan, whopPlanId: r.whopPlanId, clients: 0 };
    line.clients += r.clients;
    byPlan.set(k, line);
    const t = armTotals.get(variant) ?? { clients: 0, multi: 0, seen: new Set<string>() };
    const ck = classKey(r);
    if (!t.seen.has(ck)) {
      t.seen.add(ck);
      t.clients += r.classClients;
      t.multi += r.classMultiPlan;
    }
    armTotals.set(variant, t);
  }
  return [...byPlan.values()]
    .map((l) => ({
      ...l,
      armClients: armTotals.get(l.variant)?.clients ?? 0,
      armMultiPlan: armTotals.get(l.variant)?.multi ?? 0,
    }))
    .sort((a, b) =>
      a.variant !== b.variant ? (a.variant < b.variant ? -1 : 1) : b.clients - a.clients,
    );
}

/** Une personne à bras instable, telle que la rend la requête `abFlippers`. */
export interface AbFlipperPerson extends FlipperEvidence {
  distinctIds: readonly string[];
}

/**
 * Liste de garde du REVENU : tous les `distinct_id` des flippers (test positif,
 * cf `ArmLookup.flipperDistinctIds`) et, pour ceux que la règle sait attribuer,
 * leur bras. Une personne = une décision, appliquée à TOUS ses distinct_id.
 */
export function flipperLookupOf(persons: readonly AbFlipperPerson[]): {
  distinctIds: string[];
  resolved: { distinctId: string; variant: string }[];
} {
  const distinctIds: string[] = [];
  const resolved: { distinctId: string; variant: string }[] = [];
  for (const p of persons) {
    const outcome = attributeFlipper(p);
    for (const did of p.distinctIds) {
      if (typeof did !== "string" || did === "") continue;
      distinctIds.push(did);
      if (outcome.variant !== null) resolved.push({ distinctId: did, variant: outcome.variant });
    }
  }
  return { distinctIds, resolved };
}
