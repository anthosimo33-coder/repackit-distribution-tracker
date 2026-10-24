import { describe, it, expect } from "vitest";
import {
  resolveArm,
  armDivergence,
  attributeArmClasses,
  attributeFlipper,
  attributePurchaseClasses,
  flipperLookupOf,
  parsePlanFamilies,
  planFamilyOf,
  type AbArmClass,
  type AbPurchaseClass,
  type ArmLookup,
} from "../convex/abAttribution";

/**
 * Le rattachement revenu ↔ bras avait une garde anti-flipper qui ne mordait que
 * sur la voie de REPLI : `abVariant ?? fromPosthog` court-circuitait la garde dès
 * que la metadata Whop existait. Ces tests verrouillent la règle « les gardes
 * passent AVANT les deux voies ».
 *
 * Les entrées ont la FORME de la prod : distinctId au format
 * `https://site.snytch.co|<id>`, identifiants `mem_*`, et les trois abonnements
 * réellement fautifs du 22/08/2026 (mem_RkKWAKB4ScRdaQ 4,48 € soft,
 * mem_S0eBnIuMvjMqvn 4,48 € soft, mem_zhBeuPeM9E8d6Q 9,27 € hard).
 */

const DID_FLIPPER_A = "https://site.snytch.co|k177k63g8631ccsgme0drvega18c2h0x";
const DID_FLIPPER_B = "https://site.snytch.co|k17ey7880m4y8bd9ag4vzw98w18bbq60";
const DID_FLIPPER_C = "https://site.snytch.co|k1729xr4v0m1w0dcbz8kq3v6bs8c9ptd";
const DID_STABLE = "https://site.snytch.co|k17b4qm2yy8t0v1hzn5jc0k9dx8ce2rv";
const DID_UNKNOWN = "https://site.snytch.co|k17zzzzzzzzzzzzzzzzzzzzzzzz8czzz";

const lookup: ArmLookup = {
  personArms: new Map([
    [DID_STABLE, "hard"],
    // Un flipper N'EST PAS dans personArms : la requête abPersonArms l'écarte.
    // C'est justement pourquoi son absence ne peut pas servir de garde.
  ]),
  flipperDistinctIds: new Set([DID_FLIPPER_A, DID_FLIPPER_B, DID_FLIPPER_C]),
};

describe("resolveArm — la garde flipper passe avant les DEUX voies", () => {
  it("écarte un abonnement dont la personne est flipper MÊME avec une metadata abVariant", () => {
    // Cas réel mem_RkKWAKB4ScRdaQ : abVariant='soft', personne f43ebbf4 instable.
    // Avant correctif : rendait « soft » et versait 4,48 € dans la colonne soft.
    expect(resolveArm({ abVariant: "soft", distinctId: DID_FLIPPER_A }, lookup)).toEqual({
      variant: null,
      via: null,
      rejected: "flipper",
    });
  });

  it("écarte aussi le bras HARD porté par metadata sur une personne flipper", () => {
    // Cas réel mem_zhBeuPeM9E8d6Q : abVariant='hard', 9,27 €.
    expect(resolveArm({ abVariant: "hard", distinctId: DID_FLIPPER_C }, lookup)).toEqual({
      variant: null,
      via: null,
      rejected: "flipper",
    });
  });

  it("écarte un flipper SANS metadata (la voie de repli était déjà gardée)", () => {
    expect(resolveArm({ distinctId: DID_FLIPPER_B }, lookup).rejected).toBe("flipper");
  });

  it("rattache par metadata quand la personne est stable", () => {
    expect(resolveArm({ abVariant: "soft", distinctId: DID_STABLE }, lookup)).toEqual({
      variant: "soft",
      via: "metadata",
      rejected: null,
    });
  });

  it("rattache par le repli distinctId quand la metadata manque", () => {
    expect(resolveArm({ distinctId: DID_STABLE }, lookup)).toEqual({
      variant: "hard",
      via: "distinctId",
      rejected: null,
    });
  });

  it("écarte une session de QA à bras forcé, metadata ou pas", () => {
    expect(
      resolveArm({ abVariant: "hard", abForced: true, distinctId: DID_STABLE }, lookup).rejected,
    ).toBe("forced");
  });

  it("rend « unassigned » — et non un bras inventé — quand aucune voie ne dit rien", () => {
    expect(resolveArm({ distinctId: DID_UNKNOWN }, lookup)).toEqual({
      variant: null,
      via: null,
      rejected: "unassigned",
    });
    expect(resolveArm({}, lookup).rejected).toBe("unassigned");
  });

  it("ne prend pas une chaîne vide ni 'null' pour un bras", () => {
    // toString(NULL) rend la chaîne 'null' côté HogQL, et le champ Whop peut
    // arriver vide : sans filtre, une 3e colonne « null » apparaissait.
    for (const junk of ["", "  ", "null", "NULL", "undefined"]) {
      expect(resolveArm({ abVariant: junk, distinctId: DID_UNKNOWN }, lookup).variant).toBeNull();
    }
  });

  it("PRÉSENCE — la garde n'écarte QUE les flippers, pas tout le monde", () => {
    // Contrepartie obligatoire des assertions d'absence ci-dessus : sans elle,
    // une garde qui écarterait TOUT passerait les 3 premiers tests.
    const kept = [
      resolveArm({ abVariant: "soft", distinctId: DID_STABLE }, lookup),
      resolveArm({ abVariant: "hard", distinctId: DID_UNKNOWN }, lookup),
      resolveArm({ distinctId: DID_STABLE }, lookup),
    ];
    expect(kept.every((r) => r.variant !== null)).toBe(true);
    expect(kept.map((r) => r.variant)).toEqual(["soft", "hard", "hard"]);
  });

  it("un abonnement SANS distinctId reste rattaché par sa metadata (limite assumée)", () => {
    // La garde s'exerce par distinctId : sans lui, aucun contrôle possible. Le
    // test fige le comportement pour que la limite soit visible, pas subie.
    expect(resolveArm({ abVariant: "soft" }, lookup)).toEqual({
      variant: "soft",
      via: "metadata",
      rejected: null,
    });
  });
});

describe("armDivergence — signalée, jamais tranchée en silence", () => {
  it("signale un désaccord entre metadata et PostHog", () => {
    expect(armDivergence({ abVariant: "soft", distinctId: DID_STABLE }, lookup)).toEqual({
      metadata: "soft",
      posthog: "hard",
    });
  });

  it("ne signale rien quand les deux voies s'accordent", () => {
    expect(armDivergence({ abVariant: "hard", distinctId: DID_STABLE }, lookup)).toBeNull();
  });

  it("ne signale rien quand une seule voie a une valeur", () => {
    expect(armDivergence({ abVariant: "hard", distinctId: DID_UNKNOWN }, lookup)).toBeNull();
    expect(armDivergence({ distinctId: DID_STABLE }, lookup)).toBeNull();
  });
});

// ─── Règle flipper (24/10/2026) ──────────────────────────────────────────────

describe("planFamilyOf — la famille d'un plan, quel que soit l'event qui l'émet", () => {
  it("lit la même famille sur le slug de checkout_started et sur celui de subscription_completed", () => {
    // Prod au 24/10 : checkout_started émet `pass_7d`, subscription_completed
    // `snytch_pass_7d` — le même plan.
    expect(planFamilyOf("pass_7d")).toBe("pass");
    expect(planFamilyOf("snytch_pass_7d")).toBe("pass");
    expect(planFamilyOf("snytch_pass_30d")).toBe("pass");
    expect(planFamilyOf("trio_monthly")).toBe("trio");
    expect(planFamilyOf("snytch_trio_weekly")).toBe("trio");
    expect(planFamilyOf("snytch_target_annual")).toBe("target");
  });

  it("un slug sans rythme n'a PAS de famille (jamais une famille devinée)", () => {
    // `monthly` / `weekly` : émis seuls par une vieille build (56 checkouts en prod).
    for (const junk of ["monthly", "weekly", "", "  ", null, undefined]) {
      expect(planFamilyOf(junk)).toBe("");
    }
  });
});

describe("attributeFlipper — le checkout d'abord, le paywall à défaut", () => {
  it("rattache à la famille du plan ouvert au checkout, MÊME contre l'étiquette du paywall", () => {
    // 10 flippers « pass » par étiquette ont ouvert et payé l'hebdo (deep-dive du 24/10).
    expect(attributeFlipper({ checkoutArms: ["hard"], paywallArms: ["pass"] })).toEqual({
      variant: "hard",
      via: "checkout",
      excluded: null,
    });
  });

  it("le checkout tranche même quand la personne a vu les deux paywalls", () => {
    expect(attributeFlipper({ checkoutArms: ["pass"], paywallArms: ["hard", "pass"] })).toMatchObject({
      variant: "pass",
      via: "checkout",
    });
  });

  it("sans checkout, rattache au bras de ses paywalls s'il est unique", () => {
    expect(attributeFlipper({ checkoutArms: [], paywallArms: ["hard"] })).toEqual({
      variant: "hard",
      via: "paywall",
      excluded: null,
    });
  });

  it("écarte qui a ouvert les DEUX offres", () => {
    expect(attributeFlipper({ checkoutArms: ["hard", "pass"], paywallArms: ["pass"] })).toEqual({
      variant: null,
      via: null,
      excluded: "bothFamilies",
    });
  });

  it("écarte qui a vu les deux paywalls SANS checkout", () => {
    expect(attributeFlipper({ checkoutArms: [], paywallArms: ["pass", "hard"] }).excluded).toBe(
      "bothPaywalls",
    );
  });

  it("écarte qui n'a rien vu : aucun traitement subi", () => {
    expect(attributeFlipper({ checkoutArms: [], paywallArms: [] }).excluded).toBe("noEvidence");
  });

  it("une étiquette vide ou 'null' (toString(NULL) côté HogQL) n'est pas une preuve", () => {
    expect(attributeFlipper({ checkoutArms: ["", "null"], paywallArms: ["NULL", "hard"] })).toMatchObject({
      variant: "hard",
      via: "paywall",
    });
    // Les doublons ne font pas « deux bras ».
    expect(attributeFlipper({ checkoutArms: ["hard", "hard"], paywallArms: [] }).variant).toBe("hard");
  });
});

describe("parsePlanFamilies — la table apprise, telle que la requête la rend", () => {
  it("décode les entrées famille=bras=personnes=total de la prod", () => {
    expect(parsePlanFamilies(["pass=pass=336=336", "trio=hard=797=804"])).toEqual([
      { family: "trio", variant: "hard", persons: 797, total: 804 },
      { family: "pass", variant: "pass", persons: 336, total: 336 },
    ]);
  });

  it("ignore une entrée illisible plutôt que de la deviner", () => {
    expect(parsePlanFamilies(["", "trio", "=hard=3=4", "pass=null=3=4", "trio=hard=x=4", "pass=pass=3=0"])).toEqual([]);
  });
});

/**
 * Les 16 CLASSES rendues par la requête `abArms` sur la prod le 24/10/2026
 * (test paywall_pass_2026_10) : [dernière étiquette, stable, bras des checkouts,
 * bras des paywalls, assignés, ont vu le paywall, checkouts, nouveaux clients,
 * renouvellements, payés sans checkout, cibles clients, cibles du bras,
 * multi-appareils]. Avant la règle, la carte affichait 97 hard / 110 pass.
 */
const PROD_CLASSES: [string, number, string[], string[], ...number[]][] = [
  ["hard", 1, [], [], 7946, 4796, 797, 97, 21, 4, 123, 159, 164],
  ["pass", 1, [], [], 7797, 4633, 343, 110, 15, 7, 150, 154, 149],
  ["pass", 0, ["hard"], ["pass"], 83, 83, 83, 10, 2, 0, 9, 10, 22],
  ["hard", 0, [], ["hard"], 47, 47, 0, 0, 1, 0, 0, 1, 46],
  ["pass", 0, [], ["pass"], 41, 41, 0, 0, 0, 0, 0, 0, 40],
  ["pass", 0, ["pass"], ["pass"], 31, 31, 31, 21, 0, 0, 31, 31, 31],
  ["hard", 0, ["hard"], ["hard"], 30, 30, 30, 9, 0, 0, 18, 18, 30],
  ["pass", 0, [], [], 16, 0, 0, 0, 2, 0, 0, 2, 16],
  ["hard", 0, [], [], 10, 0, 0, 0, 0, 0, 0, 0, 9],
  ["pass", 0, ["hard"], ["hard", "pass"], 5, 5, 5, 2, 0, 0, 2, 2, 5],
  ["pass", 0, [], ["hard", "pass"], 5, 5, 0, 0, 0, 0, 0, 0, 5],
  ["pass", 0, [], ["hard"], 4, 4, 0, 0, 0, 0, 0, 0, 4],
  ["hard", 0, ["hard"], ["pass"], 3, 3, 3, 0, 0, 0, 0, 0, 0],
  ["pass", 0, ["hard"], ["hard"], 3, 3, 3, 2, 1, 0, 2, 2, 3],
  ["hard", 0, [], ["hard", "pass"], 2, 2, 0, 0, 0, 0, 0, 0, 1],
  ["hard", 0, ["hard"], ["hard", "pass"], 2, 2, 2, 0, 1, 0, 0, 2, 2],
];
const classes: AbArmClass[] = PROD_CLASSES.map(([label, stable, ck, pv, ...n]) => ({
  label,
  stable: stable === 1,
  checkoutArms: ck,
  paywallArms: pv,
  exposed: n[0],
  paywallViewers: n[1],
  checkouts: n[2],
  paid: n[3],
  renewals: n[4],
  paidWithoutCheckout: n[5],
  clientTargets: n[6],
  armTargets: n[7],
  multiDevice: n[8],
}));

describe("attributeArmClasses — les flippers rattachés, sur les classes réelles de la prod", () => {
  const { rows, report } = attributeArmClasses(classes);
  const arm = (v: string) => rows.find((r) => r.variant === v)!;

  it("rend 120 hard / 131 pass nouveaux clients (97 / 110 en les écartant)", () => {
    expect(arm("hard")).toMatchObject({ exposed: 8123, paid: 120, checkouts: 923 });
    expect(arm("pass")).toMatchObject({ exposed: 7869, paid: 131, checkouts: 374 });
    // RR pass / hard ≈ 1,13 — contre 1,16 quand les flippers étaient écartés.
    const rr = (131 / 7869) / (120 / 8123);
    expect(rr).toBeCloseTo(1.127, 3);
  });

  it("les « pass » par étiquette qui ont ouvert l'hebdo comptent dans le bras HARD", () => {
    // Classe [pass, flipper, checkout hard, paywall pass] : 83 personnes, 10 clients.
    const sans = attributeArmClasses(classes.filter((c) => !(c.label === "pass" && !c.stable && c.checkoutArms[0] === "hard" && c.paywallArms.length === 1 && c.paywallArms[0] === "pass")));
    expect(arm("hard").paid - sans.rows.find((r) => r.variant === "hard")!.paid).toBe(10);
    expect(arm("pass").paid - sans.rows.find((r) => r.variant === "pass")!.paid).toBe(0);
  });

  it("aucun nouveau client n'est plus écarté ; les écartées restent COMPTÉES, sous leur dernière étiquette", () => {
    expect(report).toEqual({
      viaCheckout: 157,
      viaPaywall: 92,
      buyersReattributed: 44,
      excludedBothFamilies: 0,
      excludedBothPaywalls: 7,
      excludedNoEvidence: 26,
      buyersExcluded: 0,
    });
    expect(arm("hard")).toMatchObject({ excludedFlippers: 12, excludedFlippersMultiDevice: 10, excludedFlippersSameDevice: 2 });
    expect(arm("pass")).toMatchObject({ excludedFlippers: 21, excludedFlippersMultiDevice: 21, excludedFlippersSameDevice: 0 });
  });

  it("toute personne est dans une case et une seule : assignés + écartées = total des classes", () => {
    const total = classes.reduce((t, c) => t + c.exposed, 0);
    const placed = rows.reduce((t, r) => t + r.exposed + r.excludedFlippers, 0);
    expect(placed).toBe(total);
    expect(rows.reduce((t, r) => t + r.reattributedFlippers, 0)).toBe(report.viaCheckout + report.viaPaywall);
  });

  it("PRÉSENCE de l'ancienne règle pour les stables : leurs compteurs ne bougent pas", () => {
    const stables = attributeArmClasses(classes.filter((c) => c.stable));
    expect(stables.rows.map((r) => [r.variant, r.exposed, r.paid])).toEqual([
      ["hard", 7946, 97],
      ["pass", 7797, 110],
    ]);
  });
});

describe("attributePurchaseClasses — même rattachement côté achats", () => {
  const ligne = (label: string, stable: boolean, ck: string[], pv: string[], plan: string, id: string, clients: number, classClients: number, classMultiPlan = 0): AbPurchaseClass => ({
    label, stable, checkoutArms: ck, paywallArms: pv, plan, whopPlanId: id, clients, classClients, classMultiPlan,
  });
  const rows = attributePurchaseClasses([
    ligne("hard", true, [], [], "snytch_trio_weekly", "plan_8Eo6l4YYhkeI5", 81, 97, 1),
    ligne("hard", true, [], [], "snytch_trio_monthly", "plan_WOE4g8VkBjtgy", 11, 97, 1),
    ligne("hard", true, [], [], "snytch_trio_weekly", "plan_HFtrxkHt9BQMn", 5, 97, 1),
    ligne("hard", true, [], [], "snytch_trio_monthly", "plan_mWhQcntbwrAQ8", 1, 97, 1),
    ligne("pass", true, [], [], "snytch_pass_7d", "plan_BHa0QD8ANOD6L", 98, 110),
    // Flipper étiqueté pass, checkout hebdo : un client HARD.
    ligne("pass", false, ["hard"], ["pass"], "snytch_trio_weekly", "plan_8Eo6l4YYhkeI5", 10, 10),
    ligne("pass", false, ["pass"], ["pass"], "snytch_pass_7d", "plan_BHa0QD8ANOD6L", 21, 21),
    // Indécidable : sort des achats comme des colonnes.
    ligne("pass", false, ["hard", "pass"], [], "snytch_pass_7d", "plan_BHa0QD8ANOD6L", 1, 1),
  ]);

  it("ajoute les clients rattachés à la ligne du plan acheté, dans leur bras", () => {
    expect(rows.find((r) => r.variant === "hard" && r.whopPlanId === "plan_8Eo6l4YYhkeI5")).toMatchObject({ clients: 91 });
    expect(rows.find((r) => r.variant === "pass" && r.whopPlanId === "plan_BHa0QD8ANOD6L")).toMatchObject({ clients: 119 });
  });

  it("les totaux de classe se lisent UNE fois par classe, jamais ligne à ligne", () => {
    // hard : 97 stables (lus une fois sur 4 lignes) + 10 rattachés ; pass : 110 + 21.
    expect(new Set(rows.filter((r) => r.variant === "hard").map((r) => r.armClients))).toEqual(new Set([107]));
    expect(new Set(rows.filter((r) => r.variant === "pass").map((r) => r.armClients))).toEqual(new Set([131]));
    expect(rows.find((r) => r.variant === "hard")!.armMultiPlan).toBe(1);
  });
});

describe("flipperLookupOf + resolveArm — le revenu suit la PERSONNE", () => {
  const DID_PASS_ETIQUETTE = "https://site.snytch.co|k17c0hq1ap5w1ts9gfsv8x7mxs81p0e2";
  const DID_ANONYME = "019a0c4e-7d1b-7c3e-9f60-2b8d4e5a1c77";
  const DID_INDECIS = "https://site.snytch.co|k17d9e2b3a4c5d6e7f8g9h0j1k2l3m4n";
  const garde = flipperLookupOf([
    // Une personne, deux distinct_id : la décision vaut pour les deux.
    { distinctIds: [DID_PASS_ETIQUETTE, DID_ANONYME], checkoutArms: ["hard"], paywallArms: ["pass"] },
    { distinctIds: [DID_INDECIS], checkoutArms: ["hard", "pass"], paywallArms: [] },
  ]);
  const lookupRegle: ArmLookup = {
    personArms: lookup.personArms,
    flipperDistinctIds: new Set(garde.distinctIds),
    flipperArms: new Map(garde.resolved.map((r) => [r.distinctId, r.variant] as const)),
  };

  it("garde TOUS les distinct_id des flippers, et le bras de ceux qu'elle rattache", () => {
    expect(garde.distinctIds).toEqual([DID_PASS_ETIQUETTE, DID_ANONYME, DID_INDECIS]);
    expect(garde.resolved).toEqual([
      { distinctId: DID_PASS_ETIQUETTE, variant: "hard" },
      { distinctId: DID_ANONYME, variant: "hard" },
    ]);
  });

  it("la règle passe AVANT la metadata : abonnement étiqueté pass, offre hebdo ouverte → hard", () => {
    expect(resolveArm({ abVariant: "pass", distinctId: DID_PASS_ETIQUETTE }, lookupRegle)).toEqual({
      variant: "hard",
      via: "flipperRule",
      rejected: null,
    });
    expect(resolveArm({ abVariant: "pass", distinctId: DID_ANONYME }, lookupRegle).variant).toBe("hard");
  });

  it("un flipper indécidable reste écarté, metadata ou pas", () => {
    expect(resolveArm({ abVariant: "pass", distinctId: DID_INDECIS }, lookupRegle).rejected).toBe("flipper");
  });

  it("cache d'avant la règle (pas de flipperArms) : tous les flippers restent écartés", () => {
    const ancien: ArmLookup = { personArms: lookup.personArms, flipperDistinctIds: new Set(garde.distinctIds) };
    expect(resolveArm({ abVariant: "pass", distinctId: DID_PASS_ETIQUETTE }, ancien).rejected).toBe("flipper");
  });
});
