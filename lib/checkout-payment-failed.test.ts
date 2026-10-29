import { describe, expect, it } from "vitest";
import { buildQueries } from "../convex/posthogSync";

/**
 * ÉCHEC DE PAIEMENT AU CHECKOUT — l'event que le hub compte doit être VIVANT.
 *
 * Snytch n'émet plus `payment_failed` depuis le 28/07/2026 01:09 (event client,
 * en fait un timeout de confirmation `no_confirmation_60s`). Le relais est
 * `subscription_payment_failed`, émis par le BACKEND ~5 s après le webhook Whop
 * `payment.failed`, depuis le 28/07 14:21. Tant que le hub lisait l'ancien nom,
 * « Échec de paiement resté sans suite » valait 0 — un zéro qui ressemble à une
 * bonne nouvelle.
 *
 * Forme relevée en prod le 29/10 (1 190 events, 521 personnes) : UNE ligne par
 * TENTATIVE, renouvellements compris. `billing_reason` sépare le 1er paiement
 * (`subscription_create`, `one_time` — le pass) du cycle (`subscription_cycle`) ;
 * le motif est dans `decline_reason`. Recoupé sur 27/09→26/10 : 139 personnes
 * nouvelles refusées au 1er paiement, le chiffre de Whop.
 */
describe("échec de paiement au checkout", () => {
  const q = buildQueries("", "''") as Record<string, string>;

  /** L'expression qui alimente `failed_c` (colonne failed_payment). */
  function failedExpr(): string {
    // Sur UNE ligne : une capture multiligne partirait du premier countIf( de
    // la requête et avalerait paid_c, freed_c… — les assertions sur le texte
    // passeraient alors pour de mauvaises raisons.
    const m = /countIf\((.*)\) AS failed_c/.exec(q.checkoutReliability);
    expect(m, "checkoutReliability : plus de colonne failed_c").not.toBeNull();
    return m![1];
  }

  it("la fiabilité du checkout compte l'event vivant", () => {
    expect(failedExpr()).toContain("event = 'subscription_payment_failed'");
  });

  it("…seulement au 1er paiement, jamais sur un renouvellement", () => {
    // Un abonné d'avant la fenêtre qui rouvre le checkout sans payer, et dont
    // le CYCLE échoue, n'a pas « échoué au checkout ».
    const e = failedExpr();
    expect(e).toContain(
      "toString(properties.billing_reason) IN ('subscription_create', 'one_time')",
    );
    expect(e).not.toContain("subscription_cycle");
  });

  it("…et garde l'ancien nom pour une période d'avant le 28/07", () => {
    // Les deux events ne se chevauchent pas (01:09 → 14:21 le 28/07) : l'union
    // ne double rien, et une fenêtre libre de juillet ne retombe pas à 0.
    expect(failedExpr()).toContain("event = 'payment_failed'");
  });

  it("le balayage laisse passer les deux noms", () => {
    const liste = /event IN \(([^)]*)\)/.exec(q.checkoutReliability);
    expect(liste).not.toBeNull();
    expect(liste![1]).toContain("'subscription_payment_failed'");
    expect(liste![1]).toContain("'payment_failed'");
  });

  it("les motifs lisent le même périmètre que la fiabilité", () => {
    // Deux définitions de « l'échec » feraient dire aux deux cartes des choses
    // différentes sur les mêmes personnes.
    expect(q.checkoutCauses).toContain(failedExpr());
  });

  it("le motif vient de decline_reason, puis de l'ancien reason", () => {
    expect(q.checkoutCauses).toMatch(
      /coalesce\(nullIf\(toString\(properties\.decline_reason\), ''\),\s*nullIf\(toString\(properties\.reason\), ''\)/,
    );
  });
});
