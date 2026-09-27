/**
 * Tests de la politique du RELEVÉ RAPIDE (`convex/earlyTracking.ts`).
 *
 * Entrées de la forme de la prod : un id TikTok et un code Instagram RÉELS
 * (cf lib/post-url-date.test.ts pour leur provenance), les deux comptes de Kelly
 * qui partagent un même lien (cas relevé le 2026-09-26), des handles suffixés et
 * des heures qui ne tombent pas rondes.
 */
import { describe, expect, it } from "vitest";
import {
  EARLY_CADENCE_MS,
  EARLY_MAX_TIKTOK_PER_PASS,
  EARLY_TIKTOK_SUSPEND_MS,
  EARLY_WINDOW_MS,
  isNightlyQuietWindow,
  parisMinutesOfDay,
  postedAtOf,
  selectEarlyTargets,
  tiktokSuspended,
  type EarlyCandidate,
} from "../convex/earlyTracking";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Id TikTok réel : mis en ligne 2026-08-12T16:32:42Z, confirmé 16:33:59Z. */
const TT_ID = "7673183969470352673";
const TT_POSTED = Date.UTC(2026, 7, 12, 16, 32, 42);
const TT_URL = `https://www.tiktok.com/@kellyleydie/video/${TT_ID}`;
const TT_URL_AUTRE_COMPTE = `https://www.tiktok.com/@thekellychapters_/video/${TT_ID}?is_from_webapp=1`;

/** Code Instagram réel : mis en ligne 2026-09-26T16:15:31.524Z. */
const IG_CODE = "DdwcP91scOd";
const IG_POSTED = Date.parse("2026-09-26T16:15:31.524Z");
const IG_URL = `https://www.instagram.com/reel/${IG_CODE}/`;

/**
 * Id TikTok synthétique mis en ligne à `at` (secondes Unix sur les 32 bits de
 * poids fort, comme les vrais). Sert UNIQUEMENT au volume (plafond, simulation) :
 * le décodage lui-même est éprouvé sur l'id réel ci-dessus.
 */
function ttIdAt(at: number, seq: number): string {
  return ((BigInt(Math.floor(at / 1000)) << BigInt(32)) + BigInt(seq)).toString();
}

function candidate(over: Partial<EarlyCandidate> & { _id: string }): EarlyCandidate {
  return {
    projectId: "snytch",
    compte: "@kelly.leydie",
    plateforme: "TikTok",
    postUrl: TT_URL,
    datePubli: TT_POSTED + 77_000,
    ...over,
  };
}

describe("postedAtOf — l'heure de mise en ligne se lit dans l'URL", () => {
  it("TikTok : l'id, pas la date de confirmation", () => {
    expect(postedAtOf("TikTok", TT_URL, TT_POSTED + 77_000, TT_POSTED + HOUR)).toEqual({
      at: TT_POSTED,
      source: "url",
    });
  });

  it("Instagram : le code de publication", () => {
    const datePubli = Date.parse("2026-09-26T16:16:32.182Z");
    expect(postedAtOf("Instagram", IG_URL, datePubli, IG_POSTED + HOUR)).toEqual({
      at: IG_POSTED,
      source: "url",
    });
  });

  it("lien court : repli sur datePubli, et le repli est DIT", () => {
    const datePubli = Date.UTC(2026, 8, 25, 19, 41, 7);
    expect(
      postedAtOf("TikTok", "https://vm.tiktok.com/ZNRd7Kq2x/", datePubli, datePubli + HOUR),
    ).toEqual({ at: datePubli, source: "datePubli" });
  });

  it("un décodage dans le futur n'est pas cru", () => {
    // `now` une heure AVANT la mise en ligne décodée : lecture invraisemblable.
    const now = TT_POSTED - HOUR;
    expect(postedAtOf("TikTok", TT_URL, now - 3 * HOUR, now)).toEqual({
      at: now - 3 * HOUR,
      source: "datePubli",
    });
  });
});

describe("selectEarlyTargets — qui relever à ce passage", () => {
  it("fenêtre de 36 h sur l'âge RÉEL : 35 h 50 dedans, 36 h 10 dehors", () => {
    const dedans = candidate({ _id: "pubA" });
    const dehors = candidate({
      _id: "pubB",
      postUrl: `https://www.tiktok.com/@ja.deotn/video/${ttIdAt(TT_POSTED - 20 * MIN, 7)}`,
      compte: "@ja.deotn",
    });
    const now = TT_POSTED + 35 * HOUR + 50 * MIN;
    const plan = selectEarlyTargets([dedans, dehors], now);
    expect(plan.tiktok.map((t) => t.publications[0].publicationId)).toEqual(["pubA"]);
    // Présence en miroir : le post écarté est bien dans l'entrée, et son âge
    // réel (36 h 10) est ce qui l'écarte — pas une URL illisible.
    expect(postedAtOf("TikTok", dehors.postUrl, dehors.datePubli, now).source).toBe("url");
    expect(now - postedAtOf("TikTok", dehors.postUrl, dehors.datePubli, now).at).toBe(
      36 * HOUR + 10 * MIN,
    );
  });

  it("Instagram : l'âge vient du code, même quand datePubli est récent", () => {
    // Confirmé (datePubli) 10 h avant `now`, mais mis en ligne 37 h 44 avant.
    const now = IG_POSTED + 37 * HOUR + 44 * MIN;
    const ig = candidate({
      _id: "pubIG",
      plateforme: "Instagram",
      postUrl: IG_URL,
      compte: "@juliettesnytch",
      datePubli: now - 10 * HOUR,
    });
    expect(selectEarlyTargets([ig], now).instagram).toEqual([]);
    // Et le même post, à 19 h 44 d'âge, est bien relevé.
    expect(selectEarlyTargets([ig], IG_POSTED + 19 * HOUR + 44 * MIN).instagram).toHaveLength(1);
  });

  it("hors posts de chauffe — le post normal du même compte, lui, passe", () => {
    const chauffe = candidate({
      _id: "pubWarm",
      isWarmup: true,
      postUrl: `https://www.tiktok.com/@kellyleydie/video/${ttIdAt(TT_POSTED + 5 * MIN, 3)}`,
    });
    const normal = candidate({ _id: "pubPromo", isWarmup: false });
    const plan = selectEarlyTargets([chauffe, normal], TT_POSTED + 6 * HOUR);
    const ids = plan.tiktok.flatMap((t) => t.publications.map((p) => p.publicationId));
    expect(ids).toEqual(["pubPromo"]);
  });

  it("cadence : dû à 1 h 41 du dernier relevé, pas à 1 h 39 ; jamais relevé = dû", () => {
    const now = TT_POSTED + 9 * HOUR + 12 * MIN;
    const recent = candidate({ _id: "p1", lastReadingAt: now - (HOUR + 39 * MIN) });
    const mur = candidate({ _id: "p1", lastReadingAt: now - (HOUR + 41 * MIN) });
    const jamais = candidate({ _id: "p1" });
    expect(selectEarlyTargets([recent], now).tiktok).toHaveLength(0);
    expect(selectEarlyTargets([mur], now).tiktok).toHaveLength(1);
    expect(selectEarlyTargets([jamais], now).tiktok).toHaveLength(1);
  });

  it("un lien partagé par deux publications = UNE vidéo relevée, écrite sur les deux", () => {
    const now = TT_POSTED + 4 * HOUR;
    const plan = selectEarlyTargets(
      [
        candidate({ _id: "pubLeydie", compte: "@kelly.leydie" }),
        candidate({ _id: "pubChapters", compte: "@thekellychapters_", postUrl: TT_URL_AUTRE_COMPTE }),
      ],
      now,
    );
    expect(plan.tiktok).toHaveLength(1);
    expect(plan.tiktok[0].publications.map((p) => p.compte)).toEqual([
      "@kelly.leydie",
      "@thekellychapters_",
    ]);
  });

  it("…et son dernier relevé est le plus récent des deux publications", () => {
    const now = TT_POSTED + 4 * HOUR;
    const plan = selectEarlyTargets(
      [
        candidate({ _id: "pubLeydie" }),
        candidate({
          _id: "pubChapters",
          postUrl: TT_URL_AUTRE_COMPTE,
          lastReadingAt: now - 31 * MIN,
        }),
      ],
      now,
    );
    expect(plan.tiktok).toHaveLength(0);
  });

  it("plafond par passage : les plus jeunes d'abord, le reste est compté reporté", () => {
    const now = Date.UTC(2026, 8, 26, 14, 5, 0);
    const n = EARLY_MAX_TIKTOK_PER_PASS + 2;
    const cands = Array.from({ length: n }, (_, i) =>
      candidate({
        _id: `pub${i}`,
        compte: `@creatrice_${i % 7}.snytch`,
        // i = 0 est le plus vieux (35 h), i = n-1 le plus jeune.
        postUrl: `https://www.tiktok.com/@c/video/${ttIdAt(now - (35 * HOUR - i * 20 * MIN), i)}`,
        datePubli: now - 34 * HOUR,
      }),
    );
    const plan = selectEarlyTargets(cands, now);
    expect(plan.tiktok).toHaveLength(EARLY_MAX_TIKTOK_PER_PASS);
    expect(plan.deferred.tiktok).toBe(2);
    const gardes = new Set(plan.tiktok.map((t) => t.publications[0].publicationId));
    expect(gardes.has("pub0")).toBe(false);
    expect(gardes.has("pub1")).toBe(false);
    expect(gardes.has(`pub${n - 1}`)).toBe(true);
  });
});

describe("heure de Paris et fenêtre de silence du relevé nocturne", () => {
  it("minutes Paris en été (UTC+2) et en hiver (UTC+1)", () => {
    expect(parisMinutesOfDay(Date.UTC(2026, 8, 26, 21, 25))).toBe(23 * 60 + 25);
    expect(parisMinutesOfDay(Date.UTC(2026, 11, 15, 22, 25))).toBe(23 * 60 + 25);
    expect(parisMinutesOfDay(Date.UTC(2026, 8, 26, 22, 0))).toBe(0);
  });

  it("silence de 23 h 25 à 0 h 25, bornes comprises au début", () => {
    expect(isNightlyQuietWindow(23 * 60 + 24)).toBe(false);
    expect(isNightlyQuietWindow(23 * 60 + 25)).toBe(true);
    expect(isNightlyQuietWindow(24)).toBe(true);
    expect(isNightlyQuietWindow(25)).toBe(false);
    expect(isNightlyQuietWindow(14 * 60 + 5)).toBe(false);
  });
});

describe("coupe-circuit TikTok persistant", () => {
  it("suspend 6 h après le dernier déclenchement", () => {
    const now = Date.UTC(2026, 8, 27, 9, 35);
    expect(tiktokSuspended(undefined, now)).toBe(false);
    expect(tiktokSuspended(now - EARLY_TIKTOK_SUSPEND_MS + MIN, now)).toBe(true);
    expect(tiktokSuspended(now - EARLY_TIKTOK_SUSPEND_MS - MIN, now)).toBe(false);
  });
});

/**
 * SIMULATION — la promesse tenue au bout de la chaîne : un relevé toutes les
 * 2 h sur les 36 premières heures, quel que soit l'heure de publication.
 *
 * Rejoue le cron réel (:05 et :35 UTC), la fenêtre de silence, un passage qui
 * horodate ses relevés 2 min après son déclenchement, et le relevé nocturne de
 * 23 h 30 Paris compté comme un point de mesure. Le lien est saisi 6 min après
 * la mise en ligne (médiane mesurée en prod). Une publication toutes les
 * 37 minutes sur deux jours, en été ET en hiver.
 */
function simulate(firstPost: number): {
  gaps: number[];
  firstDelays: { delay: number; linkInQuietWindow: boolean }[];
} {
  const gaps: number[] = [];
  const firstDelays: { delay: number; linkInQuietWindow: boolean }[] = [];
  for (let k = 0; k < 78; k++) {
    const posted = firstPost + k * 37 * MIN;
    const linkAt = posted + 6 * MIN;
    const id = ttIdAt(posted, k);
    const url = `https://www.tiktok.com/@marriyaaahsmile/video/${id}`;
    const readings: number[] = [];
    // Passages de cron de la saisie du lien à la fin de la fenêtre.
    let t = Math.ceil((linkAt - 5 * MIN) / (30 * MIN)) * 30 * MIN + 5 * MIN;
    for (; t < posted + EARLY_WINDOW_MS + HOUR; t += 30 * MIN) {
      // Relevé nocturne : 23 h 30 Paris, horodaté 23 h 33.
      const minutes = parisMinutesOfDay(t);
      if (minutes === null) throw new Error("heure de Paris incalculable");
      if (minutes === 23 * 60 + 35 && t - 2 * MIN > linkAt) readings.push(t - 2 * MIN);
      if (isNightlyQuietWindow(minutes)) continue;
      const plan = selectEarlyTargets(
        [
          {
            _id: `p${k}`,
            projectId: "snytch",
            compte: "@marriyaaahsmile",
            plateforme: "TikTok",
            postUrl: url,
            datePubli: linkAt,
            lastReadingAt: readings.length > 0 ? readings[readings.length - 1] : undefined,
          },
        ],
        t,
      );
      if (plan.tiktok.length === 1) readings.push(t + 2 * MIN);
    }
    const inWindow = readings.filter((r) => r - posted < EARLY_WINDOW_MS);
    firstDelays.push({
      delay: inWindow[0] - linkAt,
      linkInQuietWindow: isNightlyQuietWindow(parisMinutesOfDay(linkAt) as number),
    });
    for (let i = 1; i < inWindow.length; i++) gaps.push(inWindow[i] - inWindow[i - 1]);
  }
  return { gaps, firstDelays };
}

describe("simulation — cadence réellement tenue", () => {
  for (const [saison, debut] of [
    ["été", Date.UTC(2026, 8, 24, 5, 13)],
    ["hiver", Date.UTC(2026, 11, 8, 6, 47)],
  ] as const) {
    it(`${saison} : 2 h entre deux relevés, jamais plus de 2 h 30`, () => {
      const { gaps, firstDelays } = simulate(debut);
      expect(gaps.length).toBeGreaterThan(78 * 15);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(2 * HOUR + 30 * MIN);
      // L'écart TYPE est la cadence : sans la marge, il glisserait à 2 h 30.
      const exacts = gaps.filter((g) => g === EARLY_CADENCE_MS).length;
      expect(exacts / gaps.length).toBeGreaterThan(0.8);
      // Premier relevé au plus 32 min après la saisie du lien…
      const hors = firstDelays.filter((f) => !f.linkInQuietWindow).map((f) => f.delay);
      expect(Math.max(...hors)).toBeLessThanOrEqual(32 * MIN);
      // …sauf lien saisi pendant le silence de la nuit : il attend 0 h 35 (au
      // pire 1 h 12 pour un lien de 23 h 25). Des cas de ce genre existent bien
      // dans la simulation, sinon cette borne ne prouverait rien.
      const pendant = firstDelays.filter((f) => f.linkInQuietWindow).map((f) => f.delay);
      expect(pendant.length).toBeGreaterThan(0);
      expect(Math.max(...pendant)).toBeGreaterThan(32 * MIN);
      expect(Math.max(...pendant)).toBeLessThanOrEqual(72 * MIN);
    });
  }
});
