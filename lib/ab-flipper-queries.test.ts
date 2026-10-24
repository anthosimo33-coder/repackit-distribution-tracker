import { describe, expect, it } from "vitest";
import { buildQueries, DEFAULT_WINDOW } from "../convex/posthogSync";
import { hogWindowClause } from "./hog-window";

/**
 * La règle flipper vit dans convex/abAttribution (testée là-bas) ; les requêtes
 * ne rendent que ses PREUVES. Ce qui peut casser en silence ici, c'est le
 * CÂBLAGE : une requête qui apprendrait sa table famille → bras autrement que
 * les autres, ou jugerait les preuves sur la période au lieu du test entier,
 * ferait diverger colonnes, achats et revenu sans qu'aucun chiffre ne paraisse
 * faux. Les trois requêtes doivent porter le MÊME fragment, à l'octet près.
 */
const W = hogWindowClause("2026-10-10", "2026-10-16")!;
const WSUB = hogWindowClause("2026-10-10", "2026-10-16", "t_first_sub")!;
const NC = "\n  AND NOT (toString(person.properties.is_internal) = 'true')";
const base = buildQueries(NC, "''");
const fenetre = buildQueries(NC, "''", W, WSUB);
const FLIPPER_QUERIES = ["abArms", "abPurchases", "abFlippers"] as const;

/** Extrait la table apprise (`(SELECT groupArray(concat(fam … AS ab_fam_map`). */
function familyCte(sql: string): string {
  const start = sql.indexOf("(SELECT groupArray(concat(fam");
  const end = sql.indexOf("AS ab_fam_map", start);
  expect(start, "table famille → bras absente").toBeGreaterThan(-1);
  return sql.slice(start, end);
}

describe("requêtes A/B — preuves des flippers", () => {
  it("les trois requêtes apprennent la MÊME table famille → bras", () => {
    const ref = familyCte(base.abArms);
    for (const q of FLIPPER_QUERIES) expect(familyCte(base[q]), q).toBe(ref);
  });

  it("la table est jugée sur tout le test (90 j), même quand la période change", () => {
    const ref = familyCte(base.abArms);
    for (const q of FLIPPER_QUERIES) {
      const cte = familyCte(fenetre[q]);
      expect(cte, `${q} a fenêtré sa table`).toBe(ref);
      expect(cte).toContain(DEFAULT_WINDOW);
      expect(cte).not.toContain(W);
    }
  });

  it("la table n'apprend que des personnes STABLES, et exclut internes et sessions forcées", () => {
    const cte = familyCte(base.abArms);
    expect(cte).toContain("HAVING uniqIf(toString(properties.experiment_variant)");
    expect(cte).toMatch(/\) = 1\s/);
    expect(cte).toContain(NC);
  });

  it("le découpage de famille est celui de planFamilyOf (avant-dernier segment)", () => {
    for (const q of FLIPPER_QUERIES) {
      expect(base[q]).toContain("splitByChar('_', toString(properties.plan))[-2]");
    }
  });

  it("les preuves (checkout, paywall) sont les mêmes dans les trois requêtes", () => {
    const ck = /arraySort\(arrayDistinct\(arrayFilter\(a -> a != ''[\s\S]*?checkout_started[\s\S]*?\)\)\)\)\)/;
    const pv = /arraySort\(groupUniqArrayIf\(toString\(properties\.experiment_variant\), event = 'paywall_viewed'[^\n]*?= ab_exp\)\)/;
    const ckRef = base.abArms.match(ck)?.[0];
    const pvRef = base.abArms.match(pv)?.[0];
    expect(ckRef).toBeDefined();
    expect(pvRef).toBeDefined();
    for (const q of FLIPPER_QUERIES) {
      expect(base[q].match(ck)?.[0], q).toBe(ckRef);
      expect(base[q].match(pv)?.[0], q).toBe(pvRef);
    }
  });

  it("PRÉSENCE : abArms et abPurchases sortent par classe (stable, preuves), plus de filtre `stable` qui jette les flippers", () => {
    expect(base.abArms).toContain("GROUP BY variant, stable, ck_key, pv_key");
    expect(base.abPurchases).toContain("GROUP BY variant, stable, ck_key, pv_key, plan_achete, whop_plan_id");
    expect(base.abArms).not.toContain("uniqIf(person_id, stable");
    expect(base.abPurchases).not.toContain("WHERE stable AND");
    // abOffers garde sa règle : une offre servie ne se lit que sur une personne stable.
    expect(base.abOffers).toContain("= 1\n      AND uniqIf(concat(toString(properties.plan_preselected)");
  });
});
