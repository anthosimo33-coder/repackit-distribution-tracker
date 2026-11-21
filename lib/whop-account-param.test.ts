import { describe, it, expect } from "vitest";
import { fetchWhopPayments, fetchWhopPlans, fetchWhopMemberships } from "../convex/whopApi";

/**
 * Whop a renommé le filtre de compte. Les comptes anciens (Snytch) acceptent
 * `company_id` ; les comptes récents (BLUSH) le refusent en HTTP 400 et exigent
 * `account_id`. Constaté en prod le 21/11/2026 sur le relevé horaire :
 *   payments → « HTTP 400: company_id is not supported; filter by account_id »
 *   plans    → « HTTP 400: account_id is required »
 * Le relevé doit rejouer la même requête avec `account_id`, une seule fois.
 */

type Call = { url: string };

function whopError(message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status: 400 });
}

/** Simule Whop : refuse `company_id` avec `refusal`, sert `okBody` sur `account_id`. */
function newAccountWhop(refusal: string, okBody: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push({ url });
    if (url.includes("company_id=")) return whopError(refusal);
    return new Response(JSON.stringify(okBody), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const EMPTY_PAGE = { data: [], page_info: { has_next_page: false, end_cursor: null } };

describe("compte Whop récent : company_id refusé, account_id exigé", () => {
  it("paiements : rejoue avec account_id et lit la page", async () => {
    const { calls, fetchImpl } = newAccountWhop(
      "company_id is not supported; filter by account_id",
      EMPTY_PAGE,
    );
    const r = await fetchWhopPayments("k", "biz_kuN3Ilq0VjVUN5", { fetchImpl });
    expect(r.error).toBeNull();
    expect(r.pages).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("company_id=biz_kuN3Ilq0VjVUN5");
    expect(calls[1].url).toContain("account_id=biz_kuN3Ilq0VjVUN5");
    expect(calls[1].url).not.toContain("company_id=");
  });

  it("offres : rejoue avec account_id", async () => {
    const { calls, fetchImpl } = newAccountWhop("account_id is required", {
      data: [{ id: "plan_a", name: "Le rapport complet", billing_period: 30 }],
    });
    const r = await fetchWhopPlans("k", "biz_kuN3Ilq0VjVUN5", { fetchImpl });
    expect(r.error).toBeNull();
    expect(r.plans.map((p) => p.planId)).toEqual(["plan_a"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("account_id=biz_kuN3Ilq0VjVUN5");
  });

  it("abonnements : rejoue avec account_id", async () => {
    const { calls, fetchImpl } = newAccountWhop(
      "company_id is not supported; filter by account_id",
      EMPTY_PAGE,
    );
    const r = await fetchWhopMemberships("k", "biz_kuN3Ilq0VjVUN5", { fetchImpl });
    expect(r.error).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("account_id=biz_kuN3Ilq0VjVUN5");
  });
});

describe("compte Whop ancien et erreurs : rien ne change", () => {
  it("company_id accepté : un seul appel, jamais account_id", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push({ url });
      return new Response(JSON.stringify(EMPTY_PAGE), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchWhopPayments("k", "biz_e1zcXWKzcgHgt9", { fetchImpl });
    expect(r.error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("company_id=biz_e1zcXWKzcgHgt9");
  });

  it("un 400 qui ne parle pas d'account_id n'est pas rejoué", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push({ url });
      return whopError("first must be at most 100");
    }) as unknown as typeof fetch;
    const r = await fetchWhopPayments("k", "biz_x", { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(r.error).toContain("first must be at most 100");
  });

  it("account_id refusé aussi : une seule reprise, puis l'erreur", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push({ url });
      return whopError("account_id is required");
    }) as unknown as typeof fetch;
    const r = await fetchWhopPayments("k", "biz_x", { fetchImpl });
    expect(calls).toHaveLength(2);
    expect(r.error).toContain("account_id is required");
  });
});
