import { describe, it, expect } from "vitest";
import {
  divergesFromWarmup,
  isRemunerated,
  normalizeRemunere,
  remunereAfterWarmupToggle,
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

/**
 * LA RÈGLE de la bascule warmup — testée ici et pas seulement en e2e : le e2e
 * couvre le scénario (un post, un écran), ces cas couvrent la règle.
 *
 * Le bug corrigé : `setPublicationWarmup` calculait la valeur effective sur
 * l'ANCIEN warmup, ce qui revenait à « la bascule ne change jamais la paie » et
 * ÉPINGLAIT tout post implicite dès son premier passage en warmup — exactement le
 * mode de panne que `normalizeRemunere` documente avoir déjà subi
 * (`backfillRemunere`, 143 publications).
 */
describe("remunereAfterWarmupToggle — la paie suit, sauf décision explicite", () => {
  it("post IMPLICITE → reste implicite, la paie SUIT le nouveau warmup", () => {
    // Passer un post normal en warmup le sort de la paie…
    expect(remunereAfterWarmupToggle(true, undefined)).toBeUndefined();
    expect(
      isRemunerated({ isWarmup: true, remunere: remunereAfterWarmupToggle(true, undefined) }),
    ).toBe(false);
    // …et l'en sortir l'y remet. Aucune trace stockée dans un sens ni l'autre.
    expect(remunereAfterWarmupToggle(false, undefined)).toBeUndefined();
    expect(
      isRemunerated({ isWarmup: false, remunere: remunereAfterWarmupToggle(false, undefined) }),
    ).toBe(true);
  });

  it("post implicite : la bascule ne l'ÉPINGLE JAMAIS (le bug corrigé)", () => {
    // Régression directe : avant le correctif, ce cas rendait `true` (la valeur
    // effective de l'ancien état), donc un post warmup RESTAIT payé et épinglé.
    const stored = remunereAfterWarmupToggle(true, undefined);
    expect(stored).toBeUndefined();
    expect(divergesFromWarmup({ isWarmup: true, remunere: stored })).toBe(false);
  });

  it("post EXPLICITE (cas Kelly) → sa décision garde son EFFET", () => {
    // Kelly : warmup + payé. On retire le warmup → toujours payé.
    const stored = remunereAfterWarmupToggle(false, true);
    expect(isRemunerated({ isWarmup: false, remunere: stored })).toBe(true);
    // Et rien de redondant n'est stocké : « payé sans warmup » EST la règle par
    // défaut, donc plus rien à piloter à la main → la divergence disparaît
    // légitimement (l'argent, lui, ne bouge pas).
    expect(stored).toBeUndefined();
    expect(divergesFromWarmup({ isWarmup: false, remunere: stored })).toBe(false);
  });

  it("post explicite NON payé hors warmup → reste non payé après la bascule", () => {
    const stored = remunereAfterWarmupToggle(true, false);
    expect(isRemunerated({ isWarmup: true, remunere: stored })).toBe(false);
    expect(stored).toBeUndefined();
  });

  it("la valeur EFFECTIVE d'une décision explicite est toujours préservée", () => {
    for (const decision of [true, false]) {
      for (const next of [true, false]) {
        const stored = remunereAfterWarmupToggle(next, decision);
        expect(isRemunerated({ isWarmup: next, remunere: stored })).toBe(decision);
      }
    }
  });

  it("parité lib/ ↔ convex/ (règle A6)", () => {
    for (const next of [true, false]) {
      for (const current of [true, false, undefined]) {
        expect(convexRemunerate.remunereAfterWarmupToggle(next, current)).toBe(
          remunereAfterWarmupToggle(next, current),
        );
      }
    }
  });
});
