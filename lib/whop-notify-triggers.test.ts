import { describe, it, expect } from "vitest";
// Module SERVEUR pur (aucun import `_generated`) — chargeable tel quel par vitest.
import {
  FRESH_INSERT_MS,
  isActionableRenewalFailure,
  isDisputed,
  isRetryableRenewalFailure,
  shouldNotifyDispute,
  shouldNotifyRenewalFailure,
  type WhopPaymentSnapshot,
} from "../convex/whopNotifyTriggers";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const HOUR = 3_600_000;

function paiement(over: Partial<WhopPaymentSnapshot> = {}): WhopPaymentSnapshot {
  return { status: "paid", paidAt: NOW - HOUR, ...over };
}

const litige = (over: Partial<WhopPaymentSnapshot> = {}) =>
  paiement({ status: "disputed", disputeDueAt: NOW + 5 * 86_400_000, ...over });

const echecRenouv = (over: Partial<WhopPaymentSnapshot> = {}) =>
  paiement({
    status: "failed",
    billingReason: "subscription_cycle",
    retryable: false,
    ...over,
  });

describe("isDisputed — deux signaux, l'un ou l'autre suffit", () => {
  it("échéance de réponse renseignée", () => {
    expect(isDisputed(paiement({ disputeDueAt: NOW + 1000 }))).toBe(true);
  });
  it("statut disputed sans détail d'échéance", () => {
    expect(isDisputed(paiement({ status: "disputed" }))).toBe(true);
  });
  it("paiement normal", () => {
    expect(isDisputed(paiement())).toBe(false);
  });
});

describe("échec de renouvellement — actionnable vs relançable", () => {
  it("actionnable : échec + motif de cycle + relances épuisées", () => {
    expect(isActionableRenewalFailure(echecRenouv())).toBe(true);
  });

  it("relançable → PAS actionnable (Whop rejouera, rien à faire)", () => {
    const s = echecRenouv({ retryable: true });
    expect(isActionableRenewalFailure(s)).toBe(false);
    expect(isRetryableRenewalFailure(s)).toBe(true);
  });

  it("retryable inconnu → traité comme actionnable (on préfère le signaler)", () => {
    expect(
      isActionableRenewalFailure(echecRenouv({ retryable: undefined })),
    ).toBe(true);
  });

  it("un PREMIER paiement raté n'est pas un renouvellement", () => {
    expect(
      isActionableRenewalFailure(
        echecRenouv({ billingReason: "subscription_create" }),
      ),
    ).toBe(false);
  });

  it("motif absent → on ne DEVINE pas que c'est un renouvellement", () => {
    expect(
      isActionableRenewalFailure(echecRenouv({ billingReason: undefined })),
    ).toBe(false);
  });

  it("un paiement réussi n'est jamais un échec", () => {
    expect(
      isActionableRenewalFailure(
        paiement({ status: "paid", billingReason: "subscription_cycle" }),
      ),
    ).toBe(false);
  });
});

describe("litige — notification au PASSAGE, pas à l'état", () => {
  it("ouverture : paiement normal → en litige", () => {
    expect(shouldNotifyDispute(paiement(), litige(), NOW)).toBe(true);
  });

  it("la re-synchro horaire du MÊME litige ouvert ne re-notifie pas", () => {
    expect(shouldNotifyDispute(litige(), litige(), NOW)).toBe(false);
  });

  it("résolution (l'échéance se vide) ne notifie rien", () => {
    expect(shouldNotifyDispute(litige(), paiement(), NOW)).toBe(false);
  });

  it("ligne NEUVE et récente en litige → notifie", () => {
    expect(shouldNotifyDispute(null, litige(), NOW)).toBe(true);
  });

  it("ligne NEUVE mais ancienne → muette (c'est du backfill)", () => {
    const vieux = litige({ paidAt: NOW - FRESH_INSERT_MS - 1 });
    expect(shouldNotifyDispute(null, vieux, NOW)).toBe(false);
  });
});

describe("renouvellement échoué — notification au PASSAGE", () => {
  it("apparition d'un échec non relançable", () => {
    expect(shouldNotifyRenewalFailure(paiement(), echecRenouv(), NOW)).toBe(true);
  });

  it("relances ÉPUISÉES sur un échec déjà connu → notifie (le seul instant utile)", () => {
    // C'est le passage qui compte : tant que Whop relançait, il n'y avait rien à
    // faire ; maintenant que c'est fini, c'est du churn réel.
    expect(
      shouldNotifyRenewalFailure(
        echecRenouv({ retryable: true }),
        echecRenouv({ retryable: false }),
        NOW,
      ),
    ).toBe(true);
  });

  it("un échec relançable qui le reste ne notifie pas", () => {
    expect(
      shouldNotifyRenewalFailure(
        paiement(),
        echecRenouv({ retryable: true }),
        NOW,
      ),
    ).toBe(false);
  });

  it("la re-synchro horaire du même échec épuisé ne re-notifie pas", () => {
    expect(shouldNotifyRenewalFailure(echecRenouv(), echecRenouv(), NOW)).toBe(
      false,
    );
  });

  it("ligne NEUVE et récente → notifie (l'échec naît comme une ligne neuve)", () => {
    expect(shouldNotifyRenewalFailure(null, echecRenouv(), NOW)).toBe(true);
  });

  it("ligne NEUVE mais ancienne → muette (backfill d'historique)", () => {
    expect(
      shouldNotifyRenewalFailure(
        null,
        echecRenouv({ paidAt: NOW - FRESH_INSERT_MS - 1 }),
        NOW,
      ),
    ).toBe(false);
  });

  it("un premier paiement raté ne déclenche jamais", () => {
    expect(
      shouldNotifyRenewalFailure(
        null,
        echecRenouv({ billingReason: "subscription_create" }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("première synchro d'un projet — aucune salve", () => {
  it("un historique entier inséré d'un coup reste muet", () => {
    // 50 paiements historiques, dont litiges et échecs, tous anciens.
    const historique = Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0
        ? litige({ paidAt: NOW - (i + 24) * HOUR })
        : echecRenouv({ paidAt: NOW - (i + 24) * HOUR }),
    );
    const alertes = historique.filter(
      (p) =>
        shouldNotifyDispute(null, p, NOW) ||
        shouldNotifyRenewalFailure(null, p, NOW),
    );
    expect(alertes).toHaveLength(0);
  });

  it("… mais un événement de la dernière heure passe", () => {
    const frais = echecRenouv({ paidAt: NOW - HOUR });
    expect(shouldNotifyRenewalFailure(null, frais, NOW)).toBe(true);
  });
});
