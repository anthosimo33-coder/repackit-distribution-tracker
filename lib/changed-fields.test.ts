import { describe, it, expect } from "vitest";
// Module SERVEUR pur (aucun import `_generated`) — chargeable tel quel par vitest.
import { changedFields, lastWhopSyncMs } from "../convex/changedFields";

describe("changedFields — n'écrire que ce qui change", () => {
  // Une ligne telle que la synchro Whop la relit : montants décimaux, champs
  // optionnels absents, pas un objet idéal.
  const enBase = {
    status: "paid",
    currency: "EUR",
    grossAmount: 16.9,
    netAmount: 15.37,
    paidAt: Date.UTC(2026, 8, 14, 21, 43, 7),
    membershipId: "mem_C4tq8Rz1",
    billingCountry: "RS",
  };

  it("rien de changé → null (aucune écriture, aucune relance)", () => {
    expect(
      changedFields(enBase, {
        ...enBase,
        // Champ optionnel ABSENT en base et relu `undefined` : égal.
        disputeDueAt: undefined,
      }),
    ).toBeNull();
  });

  it("un remboursement → seul le champ modifié part", () => {
    expect(
      changedFields(enBase, { ...enBase, status: "refunded", netAmount: 0 }),
    ).toEqual({ status: "refunded", netAmount: 0 });
  });

  it("un champ qui DISPARAÎT (litige résolu) est un changement", () => {
    const avecLitige = {
      ...enBase,
      disputeDueAt: Date.UTC(2026, 8, 20) as number | undefined,
    };
    const resolu = { ...avecLitige, disputeDueAt: undefined };
    const diff = changedFields(avecLitige, resolu as typeof avecLitige);
    expect(diff).not.toBeNull();
    expect(Object.keys(diff!)).toEqual(["disputeDueAt"]);
    expect(diff!.disputeDueAt).toBeUndefined();
  });
});

describe("lastWhopSyncMs — la synchro tourne même quand rien ne change", () => {
  const passage = Date.UTC(2026, 8, 16, 13, 30, 41);
  const lignes = [
    { updatedAt: Date.UTC(2026, 8, 3, 8, 30, 12) },
    { updatedAt: Date.UTC(2026, 8, 11, 17, 30, 9) },
  ];

  it("le passage marqué prime sur des lignes plus anciennes", () => {
    expect(lastWhopSyncMs(passage, lignes)).toBe(passage);
  });

  it("sans marqueur (avant ce changement) → le max des lignes, comme avant", () => {
    expect(lastWhopSyncMs(null, lignes)).toBe(Date.UTC(2026, 8, 11, 17, 30, 9));
  });

  it("une ligne écrite après le marqueur reste visible", () => {
    const tardive = Date.UTC(2026, 8, 16, 14, 2, 55);
    expect(lastWhopSyncMs(passage, [...lignes, { updatedAt: tardive }])).toBe(
      tardive,
    );
  });

  it("ni marqueur ni ligne → null (« — » à l'écran)", () => {
    expect(lastWhopSyncMs(null, [])).toBeNull();
  });
});
