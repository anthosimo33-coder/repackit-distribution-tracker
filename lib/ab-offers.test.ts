process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { formatMoney } from "./format-rate";
import {
  amountOfPrice,
  armComparability,
  attributedOffers,
  currentOfferByArm,
  excludedViewers,
  intervalOfPlan,
  offerCurrency,
  offerLabel,
  type AbOfferInput,
  type OfferPlanLike,
} from "./ab-offers";

const at = (iso: string) => Date.parse(iso);
const EUR = "EUR";

/**
 * Extrait du CATALOGUE WHOP de Snytch le 13/09/2026 : la même grille existe en
 * euros, en dollars et en dinars serbes. Prix et rythmes tels que Whop les rend.
 */
const PLANS: OfferPlanLike[] = [
  { price: 16.9, currency: "eur", interval: "mois" },
  { price: 49.9, currency: "eur", interval: "an" },
  { price: 4.99, currency: "eur", interval: "semaine" },
  { price: 16.99, currency: "eur", interval: "mois" },
  { price: 9.99, currency: "eur", interval: "semaine" },
  { price: 29.99, currency: "eur", interval: "mois" },
  { price: 11.99, currency: "usd", interval: "semaine" },
  { price: 19.99, currency: "usd", interval: "mois" },
  { price: 599, currency: "rsd", interval: "semaine" },
  { price: 1049, currency: "rsd", interval: "mois" },
  { price: null, currency: "rsd", interval: "one_time" },
];

/**
 * L'ÉTAT RÉEL DE LA PROD le 06/09/2026, relevé sur PostHog (expérience
 * `paywall_ab_…` en cours depuis le 08/08). Cinq offres attribuées, un trou
 * d'instrumentation (plan non émis), et les personnes écartées faute d'offre
 * unique. Les nombres ne sont pas ronds parce que la prod ne l'est pas.
 */
const PROD: AbOfferInput[] = [
  {
    variant: "soft",
    plan: "snytch_target_monthly",
    price: "16.9",
    attributed: true,
    paywallViewers: 20,
    checkouts: 1,
    paid: 0,
    renewals: 0,
    firstMs: at("2026-09-06T13:39:26.676Z"),
    lastMs: at("2026-09-06T14:28:49.696Z"),
  },
  {
    variant: "soft",
    plan: "snytch_target_weekly",
    price: "4.99",
    attributed: true,
    paywallViewers: 4544,
    checkouts: 724,
    paid: 89,
    renewals: 7,
    firstMs: at("2026-08-18T17:29:38Z"),
    lastMs: at("2026-09-06T14:28:15.154Z"),
  },
  {
    variant: "soft",
    plan: "snytch_target_monthly",
    price: "16.99",
    attributed: true,
    paywallViewers: 326,
    checkouts: 64,
    paid: 16,
    renewals: 2,
    firstMs: at("2026-08-08T10:25:03.740Z"),
    lastMs: at("2026-08-18T17:01:27.291Z"),
  },
  {
    // Trou d'instrumentation RÉEL : `paywall_viewed` sans `plan_preselected`.
    variant: "soft",
    plan: "",
    price: "16.99",
    attributed: true,
    paywallViewers: 233,
    checkouts: 31,
    paid: 6,
    renewals: 1,
    firstMs: at("2026-08-09T22:05:15.834Z"),
    lastMs: at("2026-09-06T13:27:20.726Z"),
  },
  {
    variant: "hard",
    plan: "snytch_trio_weekly",
    price: "9.99",
    attributed: true,
    paywallViewers: 4862,
    checkouts: 846,
    paid: 138,
    renewals: 11,
    firstMs: at("2026-08-18T17:32:33.996Z"),
    lastMs: at("2026-09-06T14:30:31.278Z"),
  },
  {
    variant: "hard",
    plan: "snytch_trio_monthly",
    price: "29.99",
    attributed: true,
    paywallViewers: 364,
    checkouts: 64,
    paid: 11,
    renewals: 3,
    firstMs: at("2026-08-08T10:38:03.812Z"),
    lastMs: at("2026-08-18T17:23:05.445Z"),
  },
  // Personnes écartées : elles ont traversé un changement d'offre.
  {
    variant: "soft",
    plan: "",
    price: "",
    attributed: false,
    paywallViewers: 264,
    checkouts: 41,
    paid: 19,
    renewals: 2,
    firstMs: at("2026-08-08T10:25:03.740Z"),
    lastMs: at("2026-09-06T14:28:15.154Z"),
  },
  {
    variant: "hard",
    plan: "",
    price: "",
    attributed: false,
    paywallViewers: 47,
    checkouts: 9,
    paid: 9,
    renewals: 1,
    firstMs: at("2026-08-08T10:38:03.812Z"),
    lastMs: at("2026-09-06T14:30:31.278Z"),
  },
];

/** L'état de la veille : le bras `soft` n'était pas encore repassé au mensuel. */
const HIER = PROD.filter((r) => r.price !== "16.9");

describe("intervalOfPlan", () => {
  it("lit le suffixe du plan, jamais le prix", () => {
    expect(intervalOfPlan("snytch_target_weekly")).toBe("semaine");
    expect(intervalOfPlan("snytch_trio_monthly")).toBe("mois");
    // Le mensuel du 06/09 à 16,90 € est plus PROCHE en prix de l'hebdo à 9,99 €
    // que du mensuel à 29,99 € : si le rythme se devinait au prix, il serait
    // rangé du mauvais côté.
    expect(intervalOfPlan("snytch_target_monthly")).toBe("mois");
    expect(intervalOfPlan("")).toBeNull();
    expect(intervalOfPlan("snytch_target")).toBeNull();
  });
});

describe("amountOfPrice", () => {
  it("16,90 € et 16,99 € sont DEUX offres, pas un arrondi", () => {
    expect(amountOfPrice("16.9")).toBe(16.9);
    expect(amountOfPrice("16.99")).toBe(16.99);
    expect(amountOfPrice("16.9")).not.toBe(amountOfPrice("16.99"));
  });
  it("prix absent ou illisible ⇒ inconnu, jamais zéro", () => {
    expect(amountOfPrice("")).toBeNull();
    expect(amountOfPrice("   ")).toBeNull();
    expect(amountOfPrice("gratuit")).toBeNull();
    // Contre-test de présence : un prix lisible sort bien un nombre.
    expect(amountOfPrice("4.99")).toBe(4.99);
  });
});

describe("offerLabel", () => {
  it("garde le prix quand le plan n'est pas émis", () => {
    // Le montant est composé par `formatMoney` (espace fine insécable de l'ICU
    // incluse) : le figer ici casserait au prochain Node sans qu'aucune règle
    // métier ait changé. Ce qui est testé, c'est le suffixe et le cadrage.
    const eur = (n: number) => formatMoney(n, "EUR");
    expect(offerLabel("", "16.99", EUR)).toBe(`${eur(16.99)} (rythme non émis)`);
    expect(offerLabel("snytch_target_weekly", "4.99", EUR)).toBe(`${eur(4.99)}/semaine`);
    expect(offerLabel("snytch_target_monthly", "16.9", EUR)).toBe(`${eur(16.9)}/mois`);
    // 16,9 s'écrit bien « 16,90 » : deux décimales, pas une.
    expect(offerLabel("snytch_target_monthly", "16.9", EUR)).toContain("16,90");
    expect(offerLabel("", "", EUR)).toBe("Offre non identifiée");
  });

  it("sans devise réglée sur le projet, AUCUN symbole n'est inventé", () => {
    // `properties.price` est un nombre nu : PostHog ne transporte pas la devise.
    // Poser « € » par défaut afficherait une devise que rien ne garantit.
    const sansDevise = offerLabel("snytch_target_weekly", "4.99", null);
    expect(sansDevise).toBe("4,99/semaine");
    expect(sansDevise).not.toContain("€");
    // Contre-test de présence : avec une devise, le symbole est bien là.
    expect(offerLabel("snytch_target_weekly", "4.99", EUR)).toContain("€");
  });
});

describe("offerCurrency", () => {
  it("les grilles par pays : 599 et 1049 sont des DINARS, 11,99 des dollars", () => {
    // Le défaut vécu le 13/09 : « 599,00 €/semaine » et « 1 049,00 €/mois ».
    expect(offerCurrency("snytch_trio_weekly", "599", PLANS)).toBe("rsd");
    expect(offerCurrency("snytch_target_monthly", "1049", PLANS)).toBe("rsd");
    expect(offerCurrency("snytch_trio_weekly", "11.99", PLANS)).toBe("usd");
    expect(offerCurrency("snytch_target_monthly", "19.99", PLANS)).toBe("usd");
    // Contre-test de présence : la grille en euros reste en euros.
    expect(offerCurrency("snytch_trio_weekly", "9.99", PLANS)).toBe("eur");
  });

  it("rythme non émis : rapprochement sur le prix seul", () => {
    expect(offerCurrency("", "49.9", PLANS)).toBe("eur");
  });

  it("aucun plan, rythme discordant ou devise ambiguë ⇒ null, jamais supposée", () => {
    expect(offerCurrency("snytch_trio_weekly", "599", [])).toBeNull();
    // 599 existe en hebdo, pas en mensuel.
    expect(offerCurrency("snytch_trio_monthly", "599", PLANS)).toBeNull();
    const ambigu = [...PLANS, { price: 9.99, currency: "usd", interval: "semaine" }];
    expect(offerCurrency("snytch_trio_weekly", "9.99", ambigu)).toBeNull();
  });

  it("le libellé et le revenu par mille portent la devise de L'OFFRE", () => {
    const [rsd] = attributedOffers(
      [{ ...PROD[4], price: "599", paywallViewers: 78, paid: 1 }],
      PLANS,
    );
    expect(rsd.currency).toBe("rsd");
    expect(rsd.label).toBe(`${formatMoney(599, "rsd")}/semaine`);
    expect(rsd.label).not.toContain("€");
  });
});

describe("attributedOffers", () => {
  it("calcule conversion et revenu du 1er cycle sur les vues de CETTE offre", () => {
    const rows = attributedOffers(PROD, PLANS);
    const softHebdo = rows.find(
      (r) => r.variant === "soft" && r.price === "4.99",
    )!;
    const hardHebdo = rows.find(
      (r) => r.variant === "hard" && r.price === "9.99",
    )!;
    expect(softHebdo.conversionPct).toBe(1.96); // 89 / 4544
    expect(hardHebdo.conversionPct).toBe(2.84); // 138 / 4862
    expect(softHebdo.firstCycleRevenuePer1000).toBe(97.74);
    expect(hardHebdo.firstCycleRevenuePer1000).toBe(283.55);
    // Le bras `hard` convertit MIEUX à prix double : c'est tout l'enjeu du
    // découpage par offre — agrégé, ce régime était noyé dans le mensuel d'août.
    expect(hardHebdo.firstCycleRevenuePer1000!).toBeGreaterThan(
      softHebdo.firstCycleRevenuePer1000! * 2,
    );
  });

  it("écarte les lignes non attribuées et trie du plus récent au plus ancien", () => {
    const rows = attributedOffers(PROD, PLANS);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.attributed)).toBe(true);
    const soft = rows.filter((r) => r.variant === "soft");
    expect(soft[0].price).toBe("16.9"); // dernière vue le 06/09 à 14h28
    expect(soft[soft.length - 1].price).toBe("16.99"); // arrêtée le 18/08
  });

  it("sans prix connu, pas de revenu par mille (et pas zéro)", () => {
    const rows = attributedOffers([
      { ...PROD[1], price: "", paid: 89, paywallViewers: 4544 },
    ], PLANS);
    expect(rows[0].firstCycleRevenuePer1000).toBeNull();
    // La conversion, elle, reste mesurable : elle ne dépend pas du prix.
    expect(rows[0].conversionPct).toBe(1.96);
  });
});

describe("excludedViewers", () => {
  it("compte les personnes écartées, et elles seules", () => {
    expect(excludedViewers(PROD)).toBe(311); // 264 + 47
    // Contre-test de présence : sans ligne écartée, le compteur tombe à 0 —
    // il ne peut donc pas ramasser les 10 000 personnes attribuées.
    expect(excludedViewers(PROD.filter((r) => r.attributed))).toBe(0);
  });
});

describe("currentOfferByArm / armComparability", () => {
  it("donne l'offre servie EN CE MOMENT par chaque bras", () => {
    const current = currentOfferByArm(PROD, PLANS);
    expect(current.get("soft")!.label).toBe(`${formatMoney(16.9, "EUR")}/mois`);
    expect(current.get("hard")!.label).toBe(
      `${formatMoney(9.99, "EUR")}/semaine`,
    );
  });

  it("06/09 : les bras ne sont plus comparables (mois vs semaine)", () => {
    const c = armComparability(PROD, PLANS);
    expect(c.comparable).toBe(false);
    expect(c.intervals).toEqual(expect.arrayContaining(["mois", "semaine"]));
  });

  it("la veille, les DEUX bras étaient en hebdo : comparables", () => {
    // Contre-test de la condition : sans lui, un `comparable` toujours faux
    // passerait le test précédent sans rien mesurer.
    const c = armComparability(HIER, PLANS);
    expect(c.comparable).toBe(true);
    expect(c.current.map((o) => o.label)).toEqual([
      `${formatMoney(9.99, "EUR")}/semaine`,
      `${formatMoney(4.99, "EUR")}/semaine`,
    ]);
  });

  it("un rythme NON ÉMIS suffit à rendre la comparaison douteuse", () => {
    const flou = HIER.map((r) =>
      r.variant === "hard" && r.price === "9.99" ? { ...r, plan: "" } : r,
    );
    expect(armComparability(flou, PLANS).comparable).toBe(false);
  });

  it("un seul bras servi n'est pas signalé comme incomparable", () => {
    const seul = PROD.filter((r) => r.variant === "soft");
    expect(armComparability(seul, PLANS).comparable).toBe(true);
    expect(armComparability(seul, PLANS).current).toHaveLength(1);
  });
});
