import { describe, expect, it } from "vitest";

import {
  QUADRANT_AXES,
  QUADRANT_KEYS,
  accountBaselines,
  accountKey,
  breakoutFlags,
  computeQuadrant,
  medianOf,
  qualificationOf,
  quadrantFor,
  type QuadrantInput,
} from "../convex/quadrant";
import {
  BASELINE_MIN_POSTS,
  MIN_SAMPLE_VIEWS,
  DISTRIBUTION_MULTIPLIER,
  INTENT_SAVE_RATE,
  QUADRANT_SETTINGS,
} from "../convex/quadrantSettings";
import { median as medianScriptStats } from "./scriptStats";
import { median as medianScriptAnalytics } from "../convex/scriptAnalytics";
import {
  buildQuadrantView,
  unplacedTotal,
  xDomain,
  xTicks,
  yDomain,
  type QuadrantViewPost,
} from "./quadrant-view";

/**
 * Quadrant « Vues × Intent ».
 *
 * Les jeux d'essai ont la FORME de la prod : handles suffixés (@snytch.kelly,
 * @snytch_orlane2), deux plateformes pour un même compte, vues non rondes,
 * saves rares, et une horloge FIXE au 18/08/2026 21:30 UTC — l'heure réelle d'un
 * relevé nocturne d'été. Un jeu de nombres ronds passerait sur des seuils faux :
 * 3 000 / 9 000 valide autant « ≥ 3× » que « > 2,9× ».
 */

/** 18/08/2026 21:30 UTC = 23h30 Paris, l'instant réel d'un relevé nocturne. */
const NOW = Date.UTC(2026, 7, 18, 21, 30);
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Post publié il y a `days` jours (et `hours` heures), forme prod. */
function post(over: Partial<QuadrantInput> & { id: string }): QuadrantInput {
  return {
    compte: "@snytch.kelly",
    plateforme: "TikTok",
    datePubli: NOW - 5 * DAY,
    vues: 4_312,
    saves: 12,
    ...over,
  };
}

describe("médiane — les trois implémentations du dépôt disent la même chose", () => {
  // convex/quadrant.ts en définit une TROISIÈME (cf son en-tête : lib/ est
  // interdit au runtime Convex, et convex/scriptAnalytics n'est pas un module
  // pur). Tant qu'elles coexistent, elles doivent coïncider — une divergence de
  // médiane déplacerait silencieusement tous les scores de distribution.
  const echantillons: number[][] = [
    [],
    [4_312],
    [1_204, 9_887],
    [812, 4_312, 27_940],
    [812, 1_204, 4_312, 27_940],
    [27_940, 812, 4_312, 1_204, 9_887],
  ];
  for (const values of echantillons) {
    it(`accord sur [${values.join(", ")}]`, () => {
      expect(medianOf(values)).toBe(medianScriptStats(values));
      expect(medianOf(values)).toBe(medianScriptAnalytics(values));
    });
  }

  it("n pair → moyenne des deux centraux, et l'ordre d'entrée n'y change rien", () => {
    expect(medianOf([1_204, 9_887])).toBe(5_545.5);
    expect(medianOf([9_887, 1_204])).toBe(5_545.5);
  });
});

describe("qualification — tri-état, jamais un booléen", () => {
  it("sépare warmup, promo et « jamais qualifié »", () => {
    expect(qualificationOf(true)).toBe("warmup");
    expect(qualificationOf(false)).toBe("promo");
    expect(qualificationOf(undefined)).toBe("autre");
  });
});

describe("médiane de référence d'un compte", () => {
  it("se calcule sur les posts MATURES et MESURÉS de la fenêtre", () => {
    const posts = [
      post({ id: "p1", datePubli: NOW - 3 * DAY, vues: 1_204 }),
      post({ id: "p2", datePubli: NOW - 6 * DAY, vues: 4_312 }),
      post({ id: "p3", datePubli: NOW - 9 * DAY, vues: 27_940 }),
    ];
    const b = accountBaselines(posts, NOW).get(accountKey("@snytch.kelly", "TikTok"));
    expect(b).toEqual({ views: 4_312, sample: 3 });
  });

  it("EXCLUT les posts de moins de 48 h — et garde les autres", () => {
    const trop_jeune = post({ id: "jeune", datePubli: NOW - 11 * HOUR, vues: 902 });
    const posts = [
      trop_jeune,
      post({ id: "p1", datePubli: NOW - 3 * DAY, vues: 1_204 }),
      post({ id: "p2", datePubli: NOW - 6 * DAY, vues: 4_312 }),
      post({ id: "p3", datePubli: NOW - 9 * DAY, vues: 27_940 }),
    ];
    const b = accountBaselines(posts, NOW).get(accountKey("@snytch.kelly", "TikTok"));
    // Absence : les 902 vues du post d'hier soir ne tirent pas la médiane vers le bas.
    expect(b?.sample).toBe(3);
    // Présence appariée : les trois autres SONT bien comptés (sinon `sample: 3`
    // serait vrai par accident, avec un échantillon vide et deux exclusions).
    expect(b?.views).toBe(4_312);
  });

  it("un post exactement à 48 h compte, à 47 h non", () => {
    const base = [
      post({ id: "a", datePubli: NOW - 5 * DAY, vues: 1_000 }),
      post({ id: "b", datePubli: NOW - 6 * DAY, vues: 1_000 }),
    ];
    const a48 = accountBaselines(
      [...base, post({ id: "pile", datePubli: NOW - 48 * HOUR, vues: 30_000 })],
      NOW,
    ).get(accountKey("@snytch.kelly", "TikTok"));
    const a47 = accountBaselines(
      [...base, post({ id: "presque", datePubli: NOW - 47 * HOUR, vues: 30_000 })],
      NOW,
    ).get(accountKey("@snytch.kelly", "TikTok"));
    expect(a48?.sample).toBe(3);
    expect(a47?.sample).toBe(2);
  });

  it("EXCLUT les posts hors fenêtre de 14 jours", () => {
    const posts = [
      post({ id: "vieux", datePubli: NOW - 20 * DAY, vues: 312_004 }),
      post({ id: "p1", datePubli: NOW - 3 * DAY, vues: 1_204 }),
      post({ id: "p2", datePubli: NOW - 6 * DAY, vues: 4_312 }),
      post({ id: "p3", datePubli: NOW - 13 * DAY, vues: 27_940 }),
    ];
    const b = accountBaselines(posts, NOW).get(accountKey("@snytch.kelly", "TikTok"));
    expect(b?.sample).toBe(3);
    expect(b?.views).toBe(4_312);
  });

  it("un post JAMAIS relevé ne compte pas pour zéro", () => {
    const posts = [
      post({ id: "jamais", vues: null }),
      post({ id: "p1", datePubli: NOW - 3 * DAY, vues: 1_204 }),
      post({ id: "p2", datePubli: NOW - 6 * DAY, vues: 4_312 }),
      post({ id: "p3", datePubli: NOW - 9 * DAY, vues: 27_940 }),
    ];
    const b = accountBaselines(posts, NOW).get(accountKey("@snytch.kelly", "TikTok"));
    // Avec le post non relevé compté 0, la médiane tomberait à 2 758.
    expect(b?.views).toBe(4_312);
    expect(b?.sample).toBe(3);
  });

  it("un même handle sur deux plateformes = DEUX comptes", () => {
    const posts = [
      post({ id: "t1", plateforme: "TikTok", datePubli: NOW - 3 * DAY, vues: 22_104 }),
      post({ id: "t2", plateforme: "TikTok", datePubli: NOW - 5 * DAY, vues: 19_882 }),
      post({ id: "t3", plateforme: "TikTok", datePubli: NOW - 7 * DAY, vues: 31_007 }),
      post({ id: "i1", plateforme: "Instagram", datePubli: NOW - 3 * DAY, vues: 604 }),
      post({ id: "i2", plateforme: "Instagram", datePubli: NOW - 5 * DAY, vues: 812 }),
      post({ id: "i3", plateforme: "Instagram", datePubli: NOW - 7 * DAY, vues: 977 }),
    ];
    const all = accountBaselines(posts, NOW);
    expect(all.get(accountKey("@snytch.kelly", "TikTok"))?.views).toBe(22_104);
    expect(all.get(accountKey("@snytch.kelly", "Instagram"))?.views).toBe(812);
  });

  it("sous le minimum d'échantillon : pas de référence, mais l'effectif est dit", () => {
    const posts = [
      post({ id: "p1", datePubli: NOW - 3 * DAY, vues: 1_204 }),
      post({ id: "p2", datePubli: NOW - 6 * DAY, vues: 4_312 }),
    ];
    const b = accountBaselines(posts, NOW).get(accountKey("@snytch.kelly", "TikTok"));
    expect(BASELINE_MIN_POSTS).toBe(3);
    expect(b?.views).toBeNull();
    // Présence appariée : l'absence de médiane n'est pas une absence de compte.
    expect(b?.sample).toBe(2);
  });

  it("une médiane à zéro n'est pas un dénominateur", () => {
    const posts = [
      post({ id: "p1", datePubli: NOW - 3 * DAY, vues: 0 }),
      post({ id: "p2", datePubli: NOW - 6 * DAY, vues: 0 }),
      post({ id: "p3", datePubli: NOW - 9 * DAY, vues: 4_312 }),
    ];
    const b = accountBaselines(posts, NOW).get(accountKey("@snytch.kelly", "TikTok"));
    expect(b?.views).toBeNull();
    expect(b?.sample).toBe(3);
  });

  it("le warmup compte par défaut, et sort si le réglage le dit", () => {
    const posts = [
      post({ id: "w1", datePubli: NOW - 3 * DAY, vues: 88_402, isWarmup: true }),
      post({ id: "w2", datePubli: NOW - 4 * DAY, vues: 74_119, isWarmup: true }),
      post({ id: "p1", datePubli: NOW - 6 * DAY, vues: 4_312, isWarmup: false }),
      post({ id: "p2", datePubli: NOW - 8 * DAY, vues: 3_207, isWarmup: false }),
      post({ id: "p3", datePubli: NOW - 9 * DAY, vues: 5_961, isWarmup: false }),
    ];
    const avec = accountBaselines(posts, NOW).get(
      accountKey("@snytch.kelly", "TikTok"),
    );
    const sans = accountBaselines(posts, NOW, {
      ...QUADRANT_SETTINGS,
      baselineIncludesWarmup: false,
    }).get(accountKey("@snytch.kelly", "TikTok"));
    expect(avec).toEqual({ views: 5_961, sample: 5 });
    expect(sans).toEqual({ views: 4_312, sample: 3 });
  });
});

describe("fenêtre de breakout", () => {
  const gros = post({
    id: "gros",
    datePubli: NOW - 6 * DAY,
    vues: 214_883,
  });

  it("marque un post publié DANS les 48 h qui suivent un gros post du compte", () => {
    const suivant = post({
      id: "suivant",
      datePubli: gros.datePubli + 31 * HOUR,
      vues: 18_204,
    });
    const flags = breakoutFlags([gros, suivant]);
    expect(flags.has("suivant")).toBe(true);
    // Le gros post n'ouvre pas sa propre fenêtre.
    expect(flags.has("gros")).toBe(false);
  });

  it("ne marque pas un post publié AVANT le gros post", () => {
    const avant = post({
      id: "avant",
      datePubli: gros.datePubli - 9 * HOUR,
      vues: 6_041,
    });
    const flags = breakoutFlags([gros, avant]);
    expect(flags.has("avant")).toBe(false);
    // Présence appariée : la fenêtre EXISTE, elle ne va simplement pas en arrière.
    const apres = post({
      id: "apres",
      datePubli: gros.datePubli + 9 * HOUR,
      vues: 6_041,
    });
    expect(breakoutFlags([gros, apres]).has("apres")).toBe(true);
  });

  it("borne : 48 h pile dedans, 48 h + 1 min dehors", () => {
    const pile = post({ id: "pile", datePubli: gros.datePubli + 48 * HOUR });
    const apres = post({
      id: "apres",
      datePubli: gros.datePubli + 48 * HOUR + 60_000,
    });
    expect(breakoutFlags([gros, pile]).has("pile")).toBe(true);
    expect(breakoutFlags([gros, apres]).has("apres")).toBe(false);
  });

  it("ne traverse pas les comptes ni les plateformes", () => {
    const autreCompte = post({
      id: "autre",
      compte: "@snytch_orlane2",
      datePubli: gros.datePubli + 12 * HOUR,
    });
    const autrePlateforme = post({
      id: "insta",
      plateforme: "Instagram",
      datePubli: gros.datePubli + 12 * HOUR,
    });
    const flags = breakoutFlags([gros, autreCompte, autrePlateforme]);
    expect(flags.has("autre")).toBe(false);
    expect(flags.has("insta")).toBe(false);
    // Présence appariée : le MÊME décalage sur le MÊME compte, lui, est marqué.
    const meme = post({ id: "meme", datePubli: gros.datePubli + 12 * HOUR });
    expect(breakoutFlags([gros, meme]).has("meme")).toBe(true);
  });

  it("un post juste sous le seuil de vues n'ouvre pas de fenêtre", () => {
    const presque = post({ id: "presque", datePubli: NOW - 6 * DAY, vues: 14_999 });
    const suivant = post({
      id: "suivant",
      datePubli: presque.datePubli + 12 * HOUR,
    });
    expect(breakoutFlags([presque, suivant]).has("suivant")).toBe(false);
    const pile = post({ id: "pile", datePubli: NOW - 6 * DAY, vues: 15_000 });
    const suivant2 = post({
      id: "suivant2",
      datePubli: pile.datePubli + 12 * HOUR,
    });
    expect(breakoutFlags([pile, suivant2]).has("suivant2")).toBe(true);
  });

  it("deux posts au même horodatage ne se portent pas l'un l'autre", () => {
    const a = post({ id: "a", datePubli: NOW - 6 * DAY, vues: 88_402 });
    const b = post({ id: "b", datePubli: NOW - 6 * DAY, vues: 91_770 });
    const flags = breakoutFlags([a, b]);
    expect(flags.has("a")).toBe(false);
    expect(flags.has("b")).toBe(false);
  });
});

describe("les quatre cases", () => {
  /**
   * RÈGLAGE D'ÉPREUVE, volontairement DIFFÉRENT de la calibration en vigueur
   * (×2 / 2 000). Les tests de RÈGLE ne doivent pas pouvoir passer par accident
   * parce qu'ils rejouent les valeurs de prod : ici on vérifie que la mécanique
   * obéit aux réglages qu'on lui donne, quels qu'ils soient. La calibration
   * réelle, elle, est épinglée dans son propre describe plus bas.
   */
  const REGLAGE = {
    ...QUADRANT_SETTINGS,
    distributionMultiplier: 3,
    minSampleViews: 5_000,
  };

  it("chaque case est le couple d'axes annoncé", () => {
    for (const key of QUADRANT_KEYS) {
      const { distributionHigh, intentHigh } = QUADRANT_AXES[key];
      const score = distributionHigh ? 4.2 : 1.1;
      const vues = distributionHigh ? 41_207 : 2_118;
      const intent = intentHigh ? 0.0081 : 0.0012;
      expect(quadrantFor(score, vues, intent, REGLAGE)).toBe(key);
    }
  });

  it("la moitié haute exige le multiplicateur ET le volume lisible", () => {
    // Le ratio passe, le volume non : le save rate de ce post n'est pas lisible,
    // il ne monte pas — quand bien même il a quadruplé la médiane de son compte.
    expect(quadrantFor(4.1, 4_120, 0.0091, REGLAGE)).toBe("distribution_faible");
    // Le volume passe, le ratio non : beaucoup de vues, mais à peine au-dessus
    // de ce que ce compte fait d'habitude.
    expect(quadrantFor(1.2, 92_400, 0.0091, REGLAGE)).toBe("distribution_faible");
    // Les deux : c'est du scale.
    expect(quadrantFor(4.1, 41_200, 0.0091, REGLAGE)).toBe("scale");
  });

  it("les seuils sont LARGES des trois côtés", () => {
    const { distributionMultiplier: m, minSampleViews: v, intentSaveRate: i } =
      REGLAGE;
    expect(quadrantFor(m, v, i, REGLAGE)).toBe("scale");
    expect(quadrantFor(m - 0.001, v, i, REGLAGE)).toBe("distribution_faible");
    expect(quadrantFor(m, v - 1, i, REGLAGE)).toBe("distribution_faible");
    expect(quadrantFor(m, v, i - 0.00001, REGLAGE)).toBe("intent_faible");
  });
});

describe("calibration en vigueur", () => {
  /**
   * Ces deux valeurs ont été TRANCHÉES sur 14 jours de prod (cf. les commentaires
   * de `convex/quadrantSettings.ts`). Les épingler ici fait qu'un changement de
   * calibration est une modification VISIBLE et délibérée — une ligne de test à
   * mettre à jour — et pas un chiffre qui glisse dans un fichier de réglages.
   */
  it("multiplicateur ×2, volume lisible à 2 000 vues", () => {
    expect(DISTRIBUTION_MULTIPLIER).toBe(2);
    expect(MIN_SAMPLE_VIEWS).toBe(2_000);
  });

  it("le volume lisible vaut au moins dix saves au seuil d'intent", () => {
    // La raison d'être du réglage, exprimée en saves et pas en vues : sous dix
    // saves, une ou deux saves de bruit changent le post de quadrant. C'est CE
    // rapport-là qu'il faut préserver si l'un des deux seuils bouge.
    expect(MIN_SAMPLE_VIEWS * INTENT_SAVE_RATE).toBeGreaterThanOrEqual(10);
  });
});

describe("classement complet d'un projet", () => {
  /** Trois posts matures et mesurés : de quoi donner une médiane au compte. */
  function socle(): QuadrantInput[] {
    return [
      post({ id: "s1", datePubli: NOW - 6 * DAY, vues: 4_312, saves: 9 }),
      post({ id: "s2", datePubli: NOW - 8 * DAY, vues: 3_207, saves: 4 }),
      post({ id: "s3", datePubli: NOW - 10 * DAY, vues: 5_961, saves: 21 }),
    ];
  }

  it("classe un post qui dépasse les deux seuils", () => {
    const vedette = post({
      id: "vedette",
      datePubli: NOW - 4 * DAY,
      vues: 41_207,
      saves: 338,
    });
    const res = computeQuadrant([...socle(), vedette], NOW);
    const r = res.find((x) => x.id === "vedette");
    expect(r?.status).toBe("classified");
    // Le post évalué est DANS sa propre médiane (choix documenté : tous les
    // posts d'un compte partagent la même référence, donc leurs scores sont
    // comparables). Sans lui la médiane vaudrait 4 312 et le score serait
    // gonflé de ~19 % — l'écart que ce chiffre verrouille.
    expect(r?.baselineViews).toBe(5_136.5);
    expect(r?.baselineSample).toBe(4);
    expect(r?.scoreDistribution).toBeCloseTo(41_207 / 5_136.5, 6);
    expect(r?.scoreIntent).toBeCloseTo(338 / 41_207, 8);
    expect(r?.quadrant).toBe("scale");
  });

  it("« en attente » l'emporte sur tout, sans perdre les scores", () => {
    const hier = post({
      id: "hier",
      datePubli: NOW - 19 * HOUR,
      vues: 38_004,
      saves: 402,
    });
    const r = computeQuadrant([...socle(), hier], NOW).find((x) => x.id === "hier");
    expect(r?.status).toBe("pending");
    expect(r?.quadrant).toBeNull();
    // Présence appariée : le point reste PLAÇABLE (il est tracé en gris), donc
    // ses deux scores sont bien calculés — « non classé » n'est pas « inconnu ».
    expect(r?.scoreDistribution).toBeCloseTo(38_004 / 4_312, 6);
    expect(r?.scoreIntent).toBeCloseTo(402 / 38_004, 8);
  });

  it("post jamais relevé : « pas de mesure », pas un zéro", () => {
    const jamais = post({
      id: "jamais",
      datePubli: NOW - 5 * DAY,
      vues: null,
      saves: null,
    });
    const r = computeQuadrant([...socle(), jamais], NOW).find(
      (x) => x.id === "jamais",
    );
    expect(r?.status).toBe("not_measured");
    expect(r?.scoreDistribution).toBeNull();
    expect(r?.quadrant).toBeNull();
  });

  it("compte sans référence : le post n'est pas rangé en bas à gauche", () => {
    const seul = post({
      id: "seul",
      compte: "@snytch_orlane2",
      datePubli: NOW - 5 * DAY,
      vues: 1_882,
      saves: 3,
    });
    const r = computeQuadrant([...socle(), seul], NOW).find((x) => x.id === "seul");
    expect(r?.status).toBe("no_baseline");
    expect(r?.quadrant).toBeNull();
    expect(r?.baselineSample).toBe(1);
    // Présence appariée : son save rate, lui, est bien mesuré — c'est l'axe X
    // qui manque, et lui seul.
    expect(r?.scoreIntent).toBeCloseTo(3 / 1_882, 8);
  });

  it("saves indisponibles sur Instagram : définitif, et dit comme tel", () => {
    const insta = [
      post({ id: "i1", plateforme: "Instagram", datePubli: NOW - 6 * DAY, vues: 604, saves: null }),
      post({ id: "i2", plateforme: "Instagram", datePubli: NOW - 8 * DAY, vues: 812, saves: null }),
      post({ id: "i3", plateforme: "Instagram", datePubli: NOW - 10 * DAY, vues: 977, saves: null }),
    ];
    const r = computeQuadrant(insta, NOW).find((x) => x.id === "i1");
    expect(r?.status).toBe("no_intent");
    expect(r?.reason).toBe("saves_unavailable");
    // Présence appariée : l'axe X est calculé normalement, Instagram ou pas.
    expect(r?.scoreDistribution).toBeCloseTo(604 / 812, 6);
  });

  it("saves absentes sur TikTok : collecte en cours, pas une limite définitive", () => {
    const ancien = post({
      id: "ancien",
      datePubli: NOW - 5 * DAY,
      vues: 7_413,
      saves: null,
    });
    const r = computeQuadrant([...socle(), ancien], NOW).find(
      (x) => x.id === "ancien",
    );
    expect(r?.status).toBe("no_intent");
    expect(r?.reason).toBe("saves_collecting");
  });

  it("0 vue mesurée : pas de save rate, et on le dit", () => {
    const mort = post({ id: "mort", datePubli: NOW - 5 * DAY, vues: 0, saves: 0 });
    const r = computeQuadrant([...socle(), mort], NOW).find((x) => x.id === "mort");
    expect(r?.status).toBe("no_intent");
    expect(r?.reason).toBe("no_views");
    expect(r?.scoreDistribution).toBe(0);
  });

  it("0 save MESURÉ est un résultat, pas une absence", () => {
    const zero = post({ id: "zero", datePubli: NOW - 5 * DAY, vues: 6_204, saves: 0 });
    const r = computeQuadrant([...socle(), zero], NOW).find((x) => x.id === "zero");
    expect(r?.status).toBe("classified");
    expect(r?.scoreIntent).toBe(0);
    expect(r?.quadrant).toBe("archiver");
  });

  it("porte la qualification et le drapeau de breakout jusqu'au résultat", () => {
    const gros = post({
      id: "gros",
      datePubli: NOW - 5 * DAY,
      vues: 214_883,
      saves: 1_902,
      isWarmup: true,
    });
    const suiveur = post({
      id: "suiveur",
      datePubli: gros.datePubli + 20 * HOUR,
      vues: 22_140,
      saves: 61,
      isWarmup: false,
    });
    const res = computeQuadrant([...socle(), gros, suiveur], NOW);
    const g = res.find((x) => x.id === "gros");
    const s = res.find((x) => x.id === "suiveur");
    expect(g?.qualification).toBe("warmup");
    expect(g?.breakoutWindow).toBe(false);
    expect(s?.qualification).toBe("promo");
    expect(s?.breakoutWindow).toBe(true);
  });

  it("un post non qualifié reste « autre », jamais replié sur promo", () => {
    const r = computeQuadrant(socle(), NOW).find((x) => x.id === "s1");
    expect(r?.qualification).toBe("autre");
  });
});

// ─── Mise en forme de la carte ───────────────────────────────────────────────

/** Row de tracker à la forme de `listTrackerPosts`. */
function row(
  over: Partial<QuadrantViewPost> & { _id: string },
): QuadrantViewPost {
  return {
    label: "Le truc que personne ne te dit sur ton forfait",
    plateforme: "TikTok",
    compte: "@snytch.kelly",
    creatorName: "Kelly",
    datePubli: NOW - 5 * DAY,
    vues: 41_207,
    saves: 338,
    ...over,
  };
}

const CLASSE = {
  computedAt: NOW,
  status: "classified" as const,
  baselineViews: 4_312,
  baselineSample: 5,
  scoreDistribution: 9.55,
  scoreIntent: 0.0082,
  key: "scale" as const,
  breakoutWindow: false,
};

describe("vue de la carte", () => {
  it("ne garde que la fenêtre demandée", () => {
    const posts = [
      row({ _id: "recent", datePubli: NOW - 3 * DAY, quadrant: CLASSE }),
      row({ _id: "ancien", datePubli: NOW - 21 * DAY, quadrant: CLASSE }),
    ];
    expect(buildQuadrantView(posts, NOW, 7).points.map((p) => p.id)).toEqual([
      "recent",
    ]);
    expect(buildQuadrantView(posts, NOW, 30).points.map((p) => p.id)).toEqual([
      "recent",
      "ancien",
    ]);
  });

  it("trace les classés ET les en-attente, compte le reste par raison", () => {
    const posts = [
      row({ _id: "ok", quadrant: CLASSE }),
      row({
        _id: "attente",
        quadrant: { ...CLASSE, status: "pending", key: undefined },
      }),
      row({
        _id: "sans-ref",
        quadrant: {
          computedAt: NOW,
          status: "no_baseline",
          baselineSample: 1,
          scoreIntent: 0.004,
          breakoutWindow: false,
        },
      }),
      row({
        _id: "insta",
        plateforme: "Instagram",
        saves: null,
        quadrant: {
          computedAt: NOW,
          status: "no_intent",
          reason: "saves_unavailable",
          baselineViews: 812,
          baselineSample: 4,
          scoreDistribution: 0.74,
          breakoutWindow: false,
        },
      }),
      row({ _id: "pas-encore", quadrant: null }),
    ];
    const v = buildQuadrantView(posts, NOW, 14);
    expect(v.points.map((p) => p.id)).toEqual(["ok", "attente"]);
    expect(v.points.find((p) => p.id === "attente")?.pending).toBe(true);
    expect(v.points.find((p) => p.id === "attente")?.quadrant).toBeNull();
    expect(v.points.find((p) => p.id === "ok")?.quadrant).toBe("scale");
    expect(v.unplaced.no_baseline).toBe(1);
    expect(v.unplaced.saves_unavailable).toBe(1);
    expect(unplacedTotal(v.unplaced)).toBe(2);
    expect(v.notComputed).toBe(1);
    expect(v.total).toBe(5);
    expect(v.counts.scale).toBe(1);
  });

  it("un score de distribution nul n'est pas plaçable sur une échelle log", () => {
    const posts = [
      row({
        _id: "zero",
        vues: 0,
        quadrant: {
          ...CLASSE,
          status: "classified",
          scoreDistribution: 0,
          scoreIntent: 0,
          key: "archiver",
        },
      }),
      row({ _id: "ok", quadrant: CLASSE }),
    ];
    const v = buildQuadrantView(posts, NOW, 14);
    expect(v.points.map((p) => p.id)).toEqual(["ok"]);
    expect(v.unplaced.pending).toBe(1);
  });

  it("convertit le save rate en pourcents pour l'axe, et garde le brut", () => {
    const v = buildQuadrantView([row({ _id: "ok", quadrant: CLASSE })], NOW, 14);
    expect(v.points[0].y).toBeCloseTo(0.82, 10);
    expect(v.points[0].scoreIntent).toBe(0.0082);
    expect(v.points[0].x).toBe(9.55);
  });

  it("les domaines contiennent TOUJOURS la ligne de seuil", () => {
    const serres = buildQuadrantView(
      [
        row({
          _id: "petit",
          quadrant: { ...CLASSE, scoreDistribution: 0.4, scoreIntent: 0.0001 },
        }),
      ],
      NOW,
      14,
    ).points;
    const [lo, hi] = xDomain(serres, DISTRIBUTION_MULTIPLIER);
    expect(lo).toBeLessThan(0.4);
    expect(hi).toBeGreaterThan(DISTRIBUTION_MULTIPLIER);
    const [ylo, yhi] = yDomain(serres, INTENT_SAVE_RATE * 100);
    expect(ylo).toBe(0);
    expect(yhi).toBeGreaterThan(INTENT_SAVE_RATE * 100);
  });

  it("colore par la qualification TRI-ÉTAT servie, jamais par un booléen", () => {
    // Le défaut corrigé : la row du tracker sert `isWarmup` en BOOLÉEN, donc un
    // post jamais qualifié y vaut `false` — s'en servir pour la couleur peignait
    // « promo » un défaut de saisie, et rendait « non qualifié » inatteignable.
    const posts = [
      row({ _id: "w", qualification: "warmup", quadrant: CLASSE }),
      row({ _id: "p", qualification: "promo", quadrant: CLASSE }),
      row({ _id: "a", qualification: "autre", quadrant: CLASSE }),
      // Producteur qui ne dit rien : « non qualifié », jamais « promo ».
      row({ _id: "muet", quadrant: CLASSE }),
    ];
    const v = buildQuadrantView(posts, NOW, 14);
    const par = new Map(v.points.map((p) => [p.id, p.qualification]));
    expect(par.get("w")).toBe("warmup");
    expect(par.get("p")).toBe("promo");
    expect(par.get("a")).toBe("autre");
    expect(par.get("muet")).toBe("autre");
    // Les TROIS couleurs sont atteignables sur un même jeu.
    expect(new Set(v.points.map((p) => p.qualification)).size).toBe(3);
  });

  it("les graduations de l'axe log restent dans le domaine", () => {
    const ticks = xTicks([0.3, 12]);
    expect(ticks).toEqual([0.5, 1, 2, 3, 5, 10]);
    expect(ticks.every((t) => t > 0)).toBe(true);
  });
});
