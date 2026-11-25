import { describe, expect, it } from "vitest";
import {
  abExperimentsQuery,
  buildQueries,
  pickCurrentAbExperiment,
  shapeAbExperimentCandidates,
} from "../convex/posthogSync";
import { hogWindowClause } from "./hog-window";

/**
 * EXPÉRIENCE COURANTE DES CARTES A/B — le test de paywall lancé le plus
 * récemment (choix du user, 25/11/2026), et non l'id du dernier event reçu.
 *
 * Entrées à la forme de la prod du 25/11/2026 : trois tests de paywall émettent
 * EN MÊME TEMPS, parce que les assignés d'un test fini gardent leur id
 * (`paywall_hebdo_2026_10` ~3 900 events/24 h depuis le 28/10,
 * `paywall_pass_2026_10` ~970 depuis le 07/10, `paywall_ab_2026_08_v2` ~290
 * depuis le 08/08). Le dernier event vient tantôt de l'un, tantôt de l'autre :
 * `abOffers` rendait 14 lignes à 12:46 UTC et 0 à 12:54.
 *
 * Les lignes sont celles que PostHog rend pour `abExperimentsQuery` :
 * [experiment, first_seen, last_seen, paywalls].
 */
const A_12H46: unknown[][] = [
  ["paywall_hebdo_2026_10", "2026-10-28T11:50:07.318000Z", "2026-11-25T12:45:58.904000Z", 41873],
  ["paywall_pass_2026_10", "2026-10-07T03:29:41.552000Z", "2026-11-25T12:44:12.067000Z", 10394],
  ["paywall_ab_2026_08_v2", "2026-08-08T10:18:56.211000Z", "2026-11-25T12:31:40.738000Z", 3127],
];
// Huit minutes plus tard : un ancien assigné du test pass ouvre le paywall
// après le dernier paywall du test hebdo. Rien n'a été lancé entre-temps.
const A_12H54: unknown[][] = [
  ["paywall_hebdo_2026_10", "2026-10-28T11:50:07.318000Z", "2026-11-25T12:53:02.415000Z", 41899],
  ["paywall_pass_2026_10", "2026-10-07T03:29:41.552000Z", "2026-11-25T12:53:49.120000Z", 10401],
  ["paywall_ab_2026_08_v2", "2026-08-08T10:18:56.211000Z", "2026-11-25T12:47:15.006000Z", 3129],
];

const choix = (rows: unknown[][]) =>
  pickCurrentAbExperiment(shapeAbExperimentCandidates(rows));

describe("expérience courante — le dernier test LANCÉ, pas le dernier à émettre", () => {
  it("désigne le test hebdo, lancé le 28/10, même quand le pass a émis en dernier", () => {
    expect(choix(A_12H54)).toBe("paywall_hebdo_2026_10");
  });

  it("deux calculs à huit minutes d'écart désignent le MÊME test", () => {
    expect(choix(A_12H46)).toBe(choix(A_12H54));
    expect(choix(A_12H46)).toBe("paywall_hebdo_2026_10");
  });

  it("l'ordre des lignes ne change rien (PostHog ne le garantit pas sans ORDER BY)", () => {
    expect(choix([...A_12H54].reverse())).toBe("paywall_hebdo_2026_10");
  });

  it("un NOUVEAU test de paywall prend la main dès son premier paywall", () => {
    const lancement: unknown[][] = [
      ...A_12H54,
      ["paywall_prix_2026_11", "2026-11-25T13:02:44.590000Z", "2026-11-25T13:02:44.590000Z", 1],
    ];
    expect(choix(lancement)).toBe("paywall_prix_2026_11");
  });

  it("aucun test de paywall : null, jamais un id deviné", () => {
    expect(choix([])).toBeNull();
    // Une ligne sans horodatage lisible ne peut pas être classée : écartée.
    expect(choix([["paywall_hebdo_2026_10", null, null, 0]])).toBeNull();
  });
});

describe("candidats — seuls les tests de PAYWALL", () => {
  const NC = "\n  AND NOT (toString(person.properties.is_internal) = 'true')";
  const sql = abExperimentsQuery(NC);

  it("ne lit que paywall_viewed : les relances de paiement n'en portent pas", () => {
    // `reprise_refus_*` n'existe que sur `payment_recovery_assigned`,
    // `relance_renouvellement_*` sur `renewal_recovery_*`.
    expect(sql).toContain("WHERE event = 'paywall_viewed'");
    expect(sql).not.toMatch(/payment_recovery|renewal_recovery/);
  });

  it("classe sur la 1re émission RÉELLE, pas rognée par la fenêtre de 90 jours", () => {
    // Une borne glissante ferait sortir tous les vieux tests à « il y a 90
    // jours » : le choix redeviendrait un tirage dès que le test en cours
    // dépasse trois mois.
    expect(sql).toContain("toDateTime('2026-08-03 00:00:00', 'UTC')");
    expect(sql).toContain("min(timestamp) AS first_seen");
    // …mais seuls restent candidats les tests vus dans les 90 jours.
    expect(sql).toMatch(/HAVING[^\n]*max\(timestamp\) >= now\(\) - INTERVAL 90 DAY/);
  });

  it("porte les mêmes exclusions que les requêtes A/B (internes, bras forcés)", () => {
    expect(sql).toContain(NC);
  });
});

describe("requêtes A/B — une seule expérience, écrite en dur", () => {
  const AB = ["abArms", "abOffers", "abPurchases", "abPersonArms", "abFlippers"] as const;
  const W = hogWindowClause("2026-11-18", "2026-11-24")!;
  const WSUB = hogWindowClause("2026-11-18", "2026-11-24", "t_first_sub")!;
  const jeux = [
    ["cron", buildQueries("", "''", undefined, undefined, "paywall_hebdo_2026_10")],
    ["période", buildQueries("", "''", W, WSUB, "paywall_hebdo_2026_10")],
  ] as const;

  it.each(jeux)("%s : les requêtes ab* lisent l'expérience choisie, plus l'argMax", (_nom, Q) => {
    for (const q of AB) {
      expect(Q[q], q).toContain("'paywall_hebdo_2026_10' AS ab_exp");
      expect(Q[q], q).not.toContain("argMax(toString(properties.experiment_id)");
      // Le début du test reste la 1re émission de CET id.
      expect(Q[q], q).toContain("WHERE toString(properties.experiment_id) = ab_exp");
    }
  });

  it("sans expérience choisie, les cartes sortent vides au lieu d'en deviner une", () => {
    const Q = buildQueries("", "''");
    for (const q of AB) {
      expect(Q[q], q).toContain("'' AS ab_exp");
      expect(Q[q], q).not.toContain("argMax(toString(properties.experiment_id)");
    }
  });

  it("un id inattendu est échappé, pas injecté", () => {
    const Q = buildQueries("", "''", undefined, undefined, "test_l'été\\x");
    expect(Q.abArms).toContain("'test_l\\'été\\\\x' AS ab_exp");
  });
});
