import { describe, it, expect } from "vitest";
import { normalizeWhopPlan, fetchWhopPlans } from "../convex/whopApi";

/**
 * Point 3 — récupérer le LIBELLÉ des offres depuis Whop /plans, mais NE RIEN
 * FABRIQUER : pas de nom fourni ⇒ `name` undefined (l'UI retombe sur le prix), et
 * un appel qui échoue ⇒ liste vide + erreur (les libellés existants sont conservés).
 */
describe("normalizeWhopPlan", () => {
  it("extrait id, nom, prix, devise et cadence quand ils existent", () => {
    const p = normalizeWhopPlan({
      id: "plan_22OfkN5xAE13m",
      title: "Hebdo 3 cibles",
      renewal_price: "7.99",
      base_currency: "EUR",
      billing_period: 7,
    });
    expect(p).toEqual({
      planId: "plan_22OfkN5xAE13m",
      name: "Hebdo 3 cibles",
      price: 7.99,
      currency: "eur",
      interval: "semaine",
    });
  });

  it("ne fabrique pas de nom quand l'API n'en donne pas", () => {
    const p = normalizeWhopPlan({ id: "plan_x", renewal_price: 4.99, base_currency: "eur", billing_period: 30 });
    expect(p?.name).toBeUndefined();
    expect(p?.interval).toBe("mois");
    expect(p?.price).toBe(4.99);
  });

  it("rejette un plan sans id", () => {
    expect(normalizeWhopPlan({ title: "x" })).toBeNull();
    expect(normalizeWhopPlan(null)).toBeNull();
  });
});

describe("fetchWhopPlans — tolérant à l'échec", () => {
  it("renvoie une erreur et aucune offre si l'API répond non-OK (on garde le prix)", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const r = await fetchWhopPlans("k", "biz_1", { fetchImpl });
    expect(r.plans).toEqual([]);
    expect(r.error).not.toBeNull();
  });

  it("normalise les offres d'une réponse OK", async () => {
    const body = JSON.stringify({ data: [{ id: "plan_a", name: "Mensuel", billing_period: 30 }] });
    const fetchImpl = (async () =>
      new Response(body, { status: 200 })) as unknown as typeof fetch;
    const r = await fetchWhopPlans("k", "biz_1", { fetchImpl });
    expect(r.error).toBeNull();
    expect(r.plans).toEqual([{ planId: "plan_a", name: "Mensuel", price: undefined, currency: undefined, interval: "mois" }]);
  });
});
