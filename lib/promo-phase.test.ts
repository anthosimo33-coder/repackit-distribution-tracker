import { describe, it, expect } from "vitest";
import { isPromo, isWarmupPromoConflict, type PromoPost } from "./promo-phase";
// Réplique serveur (A6) — parité verrouillée.
import * as convexPromo from "../convex/promoPhase";

const START = 1000; // datePromoStart de référence
const BEFORE = 500; // publié AVANT la phase promo
const AFTER = 1500; // publié APRÈS

describe("isPromo — ordre de priorité (LOT 3)", () => {
  it("1. isWarmup gagne TOUJOURS : un post postérieur à la date mais warmup n'est PAS promo", () => {
    expect(isPromo({ isWarmup: true, datePubli: AFTER }, START)).toBe(false);
  });
  it("2. est_promo_override force la promo AVANT la date (direction inverse)", () => {
    expect(
      isPromo({ est_promo_override: true, datePubli: BEFORE }, START),
    ).toBe(true);
  });
  it("2. est_promo_override=false retire un post POSTÉRIEUR à la date", () => {
    expect(
      isPromo({ est_promo_override: false, datePubli: AFTER }, START),
    ).toBe(false);
  });
  it("3. datePromoStart absent → jamais promo (phase non définie)", () => {
    expect(isPromo({ datePubli: AFTER }, null)).toBe(false);
    expect(isPromo({ datePubli: AFTER }, undefined)).toBe(false);
  });
  it("4. sinon : promo ssi datePubli >= datePromoStart (borne incluse)", () => {
    expect(isPromo({ datePubli: BEFORE }, START)).toBe(false);
    expect(isPromo({ datePubli: START }, START)).toBe(true);
    expect(isPromo({ datePubli: AFTER }, START)).toBe(true);
  });
  it("cas Kelly : pré-promo warmup=true → pas promo, quelle que soit la date", () => {
    expect(isPromo({ isWarmup: true, datePubli: BEFORE }, START)).toBe(false);
    expect(isPromo({ isWarmup: true, datePubli: AFTER }, START)).toBe(false);
  });
});

describe("isWarmupPromoConflict — combinaison interdite (les deux sens)", () => {
  it("warmup=true + override=true → CONFLIT (interdit)", () => {
    expect(isWarmupPromoConflict(true, true)).toBe(true);
  });
  it("warmup=true + override=false → OK (les deux disent « pas promo »)", () => {
    expect(isWarmupPromoConflict(true, false)).toBe(false);
  });
  it("warmup=false/absent + override=true → OK", () => {
    expect(isWarmupPromoConflict(false, true)).toBe(false);
    expect(isWarmupPromoConflict(undefined, true)).toBe(false);
  });
  it("aucun flag → OK", () => {
    expect(isWarmupPromoConflict(undefined, undefined)).toBe(false);
    expect(isWarmupPromoConflict(false, null)).toBe(false);
  });
});

describe("parité lib/ ↔ convex/ (règle A6)", () => {
  const posts: PromoPost[] = [
    { datePubli: BEFORE },
    { datePubli: AFTER },
    { isWarmup: true, datePubli: AFTER },
    { est_promo_override: true, datePubli: BEFORE },
    { est_promo_override: false, datePubli: AFTER },
  ];
  it("isPromo identique sur tous les cas × {null, START}", () => {
    for (const p of posts) {
      for (const d of [null, undefined, START] as const) {
        expect(convexPromo.isPromo(p, d)).toBe(isPromo(p, d));
      }
    }
  });
  it("isWarmupPromoConflict identique sur toutes les combinaisons", () => {
    for (const w of [true, false, undefined]) {
      for (const o of [true, false, null, undefined]) {
        expect(convexPromo.isWarmupPromoConflict(w, o)).toBe(
          isWarmupPromoConflict(w, o),
        );
      }
    }
  });
});
