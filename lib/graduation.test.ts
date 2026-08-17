/**
 * Règle et identité de la GRADUATION d'un hook (`convex/graduation.ts`).
 *
 * L'atomicité et l'idempotence de l'écriture sont exercées côté e2e (elles
 * demandent une base) ; ce qui est DÉCIDABLE — un run qualifie-t-il, deux textes
 * sont-ils le même hook — est isolé ici.
 *
 * Les chiffres ont la forme de la prod : des vues qui ne tombent pas rondes et
 * des taux voisins des seuils, pas 10 000 pile partout.
 */
import { describe, it, expect } from "vitest";
import {
  GRADUATION_MIN_VIEWS,
  GRADUATION_MIN_LIKE_RATE,
  GRADUATION_MIN_SAVE_RATE,
  LAB_CAMPAIGN_NAME,
  PROVEN_CAMPAIGN_NAME,
  rateOf,
  qualifiesForGraduation,
  bestRun,
  hookIdentityKey,
  campaignNameMatches,
  type HookRun,
} from "../convex/graduation";

/** Run construit à partir de TAUX visés — comme on raisonne réellement. */
const run = (vues: number, likeRate: number, saveRate: number | null): HookRun => ({
  vues,
  likes: Math.round(vues * likeRate),
  saves: saveRate === null ? null : Math.round(vues * saveRate),
});

describe("rateOf", () => {
  it("rend null sur une mesure absente, PAS zéro", () => {
    // La distinction porte toute la règle : « non collecté » n'est pas « nul ».
    expect(rateOf(null, 12_000)).toBeNull();
    expect(rateOf(0, 12_000)).toBe(0);
  });

  it("rend null quand il n'y a pas de dénominateur", () => {
    expect(rateOf(50, 0)).toBeNull();
    expect(rateOf(50, -3)).toBeNull();
  });
});

describe("qualifiesForGraduation — les trois seuils ENSEMBLE", () => {
  it("un run franchement au-dessus qualifie", () => {
    expect(qualifiesForGraduation(run(18_432, 0.094, 0.017))).toBe(true);
  });

  it("des vues sans engagement ne qualifient PAS", () => {
    // Poussée d'algorithme : beaucoup de vues, personne n'accroche.
    expect(qualifiesForGraduation(run(212_000, 0.021, 0.002))).toBe(false);
  });

  it("un très bon engagement sur trop peu de vues ne qualifie pas", () => {
    expect(qualifiesForGraduation(run(3_140, 0.15, 0.04))).toBe(false);
  });

  it("les bornes sont INCLUSIVES, un cran en dessous refuse", () => {
    const pile: HookRun = {
      vues: GRADUATION_MIN_VIEWS,
      likes: Math.ceil(GRADUATION_MIN_VIEWS * GRADUATION_MIN_LIKE_RATE),
      saves: Math.ceil(GRADUATION_MIN_VIEWS * GRADUATION_MIN_SAVE_RATE),
    };
    expect(qualifiesForGraduation(pile)).toBe(true);

    expect(qualifiesForGraduation({ ...pile, vues: pile.vues - 1 })).toBe(false);
    expect(qualifiesForGraduation({ ...pile, likes: pile.likes - 1 })).toBe(
      false,
    );
    expect(qualifiesForGraduation({ ...pile, saves: pile.saves! - 1 })).toBe(
      false,
    );
  });

  it("un taux NON MESURÉ ne vaut pas un taux satisfait", () => {
    // Le piège du chantier : tant que les saves ne sont pas collectées, tout
    // gros run graduerait si `null` était traité comme « seuil franchi ».
    const sansSaves = run(48_000, 0.11, null);
    expect(sansSaves.saves).toBeNull();
    expect(qualifiesForGraduation(sansSaves)).toBe(false);
    // Contre-épreuve : le MÊME run avec la mesure présente qualifie.
    expect(qualifiesForGraduation(run(48_000, 0.11, 0.013))).toBe(true);
  });

  it("saves mesurées à ZÉRO refusent (c'est une mesure, elle est mauvaise)", () => {
    expect(qualifiesForGraduation({ vues: 40_000, likes: 4_400, saves: 0 })).toBe(
      false,
    );
  });
});

describe("bestRun", () => {
  it("choisit le run QUALIFIANT, pas simplement le plus gros", () => {
    const enorme = run(300_000, 0.02, 0.001); // ne qualifie pas
    const bon = run(24_700, 0.091, 0.014); // qualifie
    const best = bestRun([enorme, bon]);
    expect(best).toEqual(bon);
    expect(best!.vues).toBeLessThan(enorme.vues);
  });

  it("entre deux qualifiants, prend le plus gros", () => {
    const a = run(12_100, 0.09, 0.012);
    const b = run(31_800, 0.085, 0.011);
    expect(bestRun([a, b])).toEqual(b);
  });

  it("aucun qualifiant → le plus gros, pour dire « au mieux, ça »", () => {
    const petit = run(900, 0.12, 0.03);
    const moyen = run(7_400, 0.06, 0.004);
    expect(bestRun([petit, moyen])).toEqual(moyen);
  });

  it("aucun run → null", () => {
    expect(bestRun([])).toBeNull();
  });
});

describe("hookIdentityKey — l'idempotence tient là-dessus", () => {
  const hook = "Elle a vérifié son téléphone à 3 h du matin.";

  it("plie casse, accents et espaces", () => {
    expect(hookIdentityKey(hook)).toBe(
      hookIdentityKey("  ELLE A VERIFIE SON   TELEPHONE À 3 H DU MATIN.  "),
    );
  });

  it("ne confond PAS deux hooks différents", () => {
    // Contre-épreuve : le pliage ne fusionne pas tout ce qui se ressemble.
    expect(hookIdentityKey(hook)).not.toBe(
      hookIdentityKey("Elle a vérifié son téléphone à 4 h du matin."),
    );
    expect(hookIdentityKey("Il est parti.")).not.toBe(
      hookIdentityKey("Il est parti sans rien dire."),
    );
  });
});

describe("campaignNameMatches", () => {
  it("tolère casse, accents et espaces sur le nom de campagne", () => {
    expect(campaignNameMatches("format warmup lab", LAB_CAMPAIGN_NAME)).toBe(
      true,
    );
    expect(
      campaignNameMatches(
        "  Format Warmup - Ouvertures Prouvees  ",
        PROVEN_CAMPAIGN_NAME,
      ),
    ).toBe(true);
  });

  it("ne confond PAS le LAB et les prouvées", () => {
    expect(campaignNameMatches(LAB_CAMPAIGN_NAME, PROVEN_CAMPAIGN_NAME)).toBe(
      false,
    );
    expect(campaignNameMatches("Format Warmup FR", PROVEN_CAMPAIGN_NAME)).toBe(
      false,
    );
  });
});
