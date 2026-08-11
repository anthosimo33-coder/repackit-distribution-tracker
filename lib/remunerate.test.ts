import { describe, it, expect } from "vitest";
import {
  divergesFromWarmup,
  isRemunerated,
  normalizeRemunere,
  type RemunerationFlags,
} from "./remunerate";
// Réplique serveur (A6) importée en RELATIF (module pur) : parité verrouillée.
import * as convexRemunerate from "../convex/remunerate";
import { payableAssignmentViews, type PublicationViews } from "./pricing-engine";
import { passesWarmupMode } from "./warmup-mode";

describe("isRemunerated — sémantique (LOT 2)", () => {
  it("remunere explicite prime sur isWarmup", () => {
    expect(isRemunerated({ isWarmup: true, remunere: true })).toBe(true); // Kelly
    expect(isRemunerated({ isWarmup: false, remunere: false })).toBe(false);
  });
  it("sans remunere → payé ssi pas warmup (ancienne règle)", () => {
    expect(isRemunerated({ isWarmup: false })).toBe(true);
    expect(isRemunerated({ isWarmup: true })).toBe(false);
  });
});

describe("normalizeRemunere — n'épingler QUE la divergence", () => {
  it("valeur qui répète la déduction → non stockée (le post reste déductible)", () => {
    expect(normalizeRemunere(false, true)).toBeUndefined(); // pas warmup, payé
    expect(normalizeRemunere(true, false)).toBeUndefined(); // warmup, non payé
  });

  it("valeur qui diverge → stockée explicitement", () => {
    expect(normalizeRemunere(true, true)).toBe(true); // cas Kelly : warmup ET payé
    expect(normalizeRemunere(false, false)).toBe(false); // promo mais NON payé
  });

  it("la valeur EFFECTIVE est préservée dans les 4 cas — c'est l'invariant", () => {
    for (const isWarmup of [true, false]) {
      for (const remunere of [true, false]) {
        const stored = normalizeRemunere(isWarmup, remunere);
        expect(isRemunerated({ isWarmup, remunere: stored })).toBe(remunere);
      }
    }
  });

  it("normaliser est IDEMPOTENT", () => {
    for (const isWarmup of [true, false]) {
      for (const remunere of [true, false]) {
        const once = normalizeRemunere(isWarmup, remunere);
        const twice = normalizeRemunere(
          isWarmup,
          isRemunerated({ isWarmup, remunere: once }),
        );
        expect(twice).toBe(once);
      }
    }
  });

  it("la régression qu'on empêche : une valeur redondante rend le warmup inopérant", () => {
    // AVANT (comportement de backfillRemunere) : remunere=true épinglé sur un
    // post non-warmup. Basculer le warmup ne change alors PLUS la paie.
    const epingle = { isWarmup: true, remunere: true as boolean | undefined };
    expect(isRemunerated(epingle)).toBe(true); // toujours payé malgré le warmup

    // APRÈS : la même valeur, normalisée, n'est pas stockée → la bascule agit.
    const normalise = {
      isWarmup: true,
      remunere: normalizeRemunere(false, true),
    };
    expect(isRemunerated(normalise)).toBe(false); // le warmup reprend la main
  });
});

describe("divergesFromWarmup — la liste à piloter à la main", () => {
  it("ne retient que les écarts à la règle par défaut", () => {
    expect(divergesFromWarmup({ isWarmup: true, remunere: true })).toBe(true);
    expect(divergesFromWarmup({ isWarmup: false, remunere: false })).toBe(true);
  });
  it("une valeur redondante ou absente ne diverge pas", () => {
    expect(divergesFromWarmup({ isWarmup: false, remunere: true })).toBe(false);
    expect(divergesFromWarmup({ isWarmup: true, remunere: false })).toBe(false);
    expect(divergesFromWarmup({ isWarmup: true })).toBe(false);
    expect(divergesFromWarmup({ isWarmup: false })).toBe(false);
  });
});

describe("parité lib/ ↔ convex/ isRemunerated (règle A6)", () => {
  it("identique sur toutes les combinaisons (isWarmup × remunere)", () => {
    for (const isWarmup of [true, false]) {
      for (const remunere of [true, false, undefined]) {
        const flags: RemunerationFlags = { isWarmup, remunere };
        expect(convexRemunerate.isRemunerated(flags)).toBe(isRemunerated(flags));
        expect(convexRemunerate.divergesFromWarmup(flags)).toBe(
          divergesFromWarmup(flags),
        );
      }
    }
  });

  it("normalizeRemunere identique sur toutes les combinaisons", () => {
    for (const isWarmup of [true, false]) {
      for (const remunere of [true, false]) {
        expect(convexRemunerate.normalizeRemunere(isWarmup, remunere)).toBe(
          normalizeRemunere(isWarmup, remunere),
        );
      }
    }
  });
});

describe("désépinglage — la migration ne change AUCUNE paie", () => {
  // Reproduit l'état prod : 132 posts avec un remunere redondant, 11 divergents.
  const prodLike: PublicationViews[] = [
    { views: 10_000, isWarmup: false, remunere: true }, // redondant → à effacer
    { views: 3_000, isWarmup: false, remunere: true }, // redondant → à effacer
    { views: 111_300, isWarmup: true, remunere: true }, // divergent → CONSERVÉ
    { views: 5_000, isWarmup: true }, // déjà en déduction
  ];
  const unpinned = prodLike.map((p) => ({
    ...p,
    remunere: divergesFromWarmup(p) ? p.remunere : undefined,
  }));

  it("payableViews et hasPayablePost strictement identiques", () => {
    expect(payableAssignmentViews(unpinned)).toEqual(
      payableAssignmentViews(prodLike),
    );
  });

  it("seuls les posts DIVERGENTS gardent une valeur explicite", () => {
    expect(unpinned.filter((p) => p.remunere !== undefined)).toHaveLength(1);
    expect(unpinned[2].remunere).toBe(true); // le cas Kelly survit
  });
});

describe("iso-paie : migration remunere = !isWarmup ne change RIEN au centime", () => {
  // Posts variés, état AVANT (remunere absent, comme la prod aujourd'hui).
  const before: PublicationViews[] = [
    { views: 10_000, isWarmup: false },
    { views: 5_000, isWarmup: true }, // warmup → non payé aujourd'hui
    { views: 3_000, isWarmup: false },
  ];
  // Après migration : remunere = !isWarmup posé explicitement sur chaque post.
  const after: PublicationViews[] = before.map((p) => ({
    ...p,
    remunere: !p.isWarmup,
  }));

  it("payableViews + hasPayablePost strictement identiques avant/après", () => {
    expect(payableAssignmentViews(after)).toEqual(payableAssignmentViews(before));
  });
  it("valeur attendue : seules les vues rémunérées comptent (13 000)", () => {
    expect(payableAssignmentViews(before).payableViews).toBe(13_000);
  });
});

describe("cas Kelly (le seul qui compte) : warmup ET payé", () => {
  const kelly: PublicationViews = {
    views: 111_300,
    isWarmup: true,
    remunere: true,
  };

  it("est PAYÉ : ses vues comptent dans payableViews et il pilote le fixe", () => {
    const r = payableAssignmentViews([kelly]);
    expect(r.payableViews).toBe(111_300);
    expect(r.hasPayablePost).toBe(true);
  });

  it("est EXCLU des vues promo / conversion (isWarmup, mode exclude)", () => {
    expect(passesWarmupMode(kelly.isWarmup, "exclude")).toBe(false);
  });

  it("séparation des deux flags : payé (financier) ≠ promo (éditorial)", () => {
    expect(isRemunerated(kelly)).toBe(true); // dans la paie
    expect(passesWarmupMode(kelly.isWarmup, "exclude")).toBe(false); // hors promo
  });
});
