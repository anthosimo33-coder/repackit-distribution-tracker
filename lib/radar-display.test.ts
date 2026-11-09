import { describe, expect, it } from "vitest";
import {
  TODAY_LIMIT,
  TODAY_RIVAL_SLOTS,
  appWeek,
  curveOf,
  earlyHits,
  isEarlyHit,
  isTextOnShot,
  sharesWell,
  groupAds,
  handledToday,
  isTemplateText,
  lastGrowth,
  originalSoundOf,
  scoreOf,
  sparklinePoints,
  todayQueue,
  usualViews,
  type AdLike,
} from "../convex/radarDisplay";
import { applyFilters, defaultFilters, type FilterableSignal } from "../convex/radarSignalFilters";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 9 novembre 2026, 15 h à Paris (14 h UTC).
const NOW = Date.UTC(2026, 10, 9, 14, 0);

type S = FilterableSignal & { id: string; markedAt: number | null; elsewhere?: boolean; network?: string | null; durationSec?: number | null };
const sig = (id: string, o: Partial<S> = {}): S => ({
  id,
  handle: id,
  fans: 2_000,
  caption: "",
  lang: "en",
  publishedAt: NOW - 2 * DAY,
  views: 100_000,
  ratio: 50,
  competitor: null,
  app: null,
  platform: "tiktok",
  multiplier: null,
  status: "nouveau",
  markedAt: null,
  ...o,
});

/** Chiffres relevés en prod le 09/11/2026 (outil MCP signaux, 7 jours). */
describe("le score affiché (refonte du 09/11/2026)", () => {
  it("× sa normale quand on la connaît : @revishaan 0,4× ses abonnés mais 76× sa normale", () => {
    expect(scoreOf({ multiplier: 76.1, ratio: 0.4 })).toEqual({ value: 76.1, basis: "normale" });
    expect(scoreOf({ multiplier: null, ratio: 253.2 })).toEqual({ value: 253.2, basis: "abonnes" });
    expect(scoreOf({ ratio: 12 })).toEqual({ value: 12, basis: "abonnes" });
  });

  it("ce que le compte fait d'habitude : @gigi.girlytea, 2,58 M vues à 286× → ~9 000", () => {
    expect(usualViews({ views: 2_577_704, multiplier: 286 })).toBe(9_013);
    expect(usualViews({ views: 2_577_704, multiplier: null })).toBeNull();
  });
});

describe("à regarder aujourd'hui", () => {
  it("les plus fortes non traitées des 7 derniers jours, dans l'ordre du tri par défaut, 12 au plus", () => {
    const signals = [
      sig("vieille", { multiplier: 900, publishedAt: NOW - 8 * DAY }),
      sig("gardee", { multiplier: 800, status: "enregistre" }),
      sig("passee", { multiplier: 700, status: "ignore" }),
      sig("sansMediane", { ratio: 5_000 }),
      sig("forte", { multiplier: 286 }),
      sig("moyenne", { multiplier: 20 }),
    ];
    // Les vidéos à médiane d'abord (la carte affiche × sa normale), puis × abonnés.
    expect(todayQueue(signals, NOW).map((s) => s.id)).toEqual(["forte", "moyenne", "sansMediane"]);
    const many = Array.from({ length: 30 }, (_, i) => sig(`v${i}`, { multiplier: 100 - i }));
    expect(todayQueue(many, NOW)).toHaveLength(TODAY_LIMIT);
    expect(todayQueue(many, NOW)[0].id).toBe("v0");
  });

  it("propre au projet : 6 de ses concurrents au plus, le reste ailleurs, jamais les concurrents d'un autre projet", () => {
    const rivals = Array.from({ length: 10 }, (_, i) => sig(`conc${i}`, { app: "FollowSpy", competitor: "FollowSpy", multiplier: 500 - i }));
    const others = Array.from({ length: 10 }, (_, i) => sig(`autre${i}`, { app: "Praktika", multiplier: 100 - i }));
    // The Ick dans le Radar de BLUSH : concurrente d'un autre projet, quel que soit son score.
    const ailleurs = sig("ailleurs", { app: "The Ick", multiplier: 9_999, elsewhere: true });
    // Ce qu'un compte suivi publie sans citer d'app (« TURN OFF THESE ROKU SETTINGS »).
    const reseauSeul = sig("reseauSeul", { network: "Finch", multiplier: 9_000 });
    const q = todayQueue([...rivals, ...others, ailleurs, reseauSeul], NOW);
    expect(q).toHaveLength(TODAY_LIMIT);
    expect(q.filter((s) => s.competitor)).toHaveLength(TODAY_RIVAL_SLOTS);
    expect(q.map((s) => s.id)).not.toContain("ailleurs");
    expect(q.map((s) => s.id)).not.toContain("reseauSeul");
    // Dans l'ordre du score : les concurrents (500×…) d'abord ici.
    expect(q.map((s) => s.id)).toEqual(["conc0", "conc1", "conc2", "conc3", "conc4", "conc5", "autre0", "autre1", "autre2", "autre3", "autre4", "autre5"]);
  });

  it("une part trop courte est complétée par l'autre", () => {
    const rivals = Array.from({ length: 10 }, (_, i) => sig(`conc${i}`, { competitor: "FollowSpy", app: "FollowSpy", multiplier: 50 - i }));
    const deuxAutres = [sig("a1", { multiplier: 900 }), sig("a2", { multiplier: 800 })];
    const q = todayQueue([...rivals, ...deuxAutres], NOW);
    expect(q).toHaveLength(TODAY_LIMIT);
    expect(q.filter((s) => s.competitor)).toHaveLength(10);
    const unSeulConcurrent = [sig("c", { competitor: "FollowSpy", app: "FollowSpy", multiplier: 5 }), ...Array.from({ length: 20 }, (_, i) => sig(`o${i}`, { multiplier: 100 - i }))];
    expect(todayQueue(unSeulConcurrent, NOW).filter((s) => s.competitor)).toHaveLength(1);
    expect(todayQueue(unSeulConcurrent, NOW)).toHaveLength(TODAY_LIMIT);
  });

  it("une vidéo traitée en sort, la suivante prend sa place", () => {
    const signals = Array.from({ length: 13 }, (_, i) => sig(`v${i}`, { multiplier: 100 - i }));
    expect(todayQueue(signals, NOW).map((s) => s.id)).not.toContain("v12");
    signals[0] = { ...signals[0], status: "ignore" };
    expect(todayQueue(signals, NOW).map((s) => s.id)).toContain("v12");
  });

  it("traitées aujourd'hui : le jour de Paris, pas les dernières 24 heures", () => {
    const minuitParis = Date.UTC(2026, 10, 8, 23, 0); // 9 nov., 0 h à Paris
    const signals = [
      sig("a", { status: "ignore", markedAt: minuitParis + 60_000 }),
      sig("b", { status: "adapte", markedAt: NOW - HOUR }),
      sig("hier", { status: "enregistre", markedAt: minuitParis - 60_000 }),
      sig("nouvelle"),
    ];
    expect(handledToday(signals, NOW)).toBe(2);
  });
});

describe("la courbe", () => {
  // @gigi.girlytea : 1 493 384 vues à H+22, 2 577 704 à H+47.
  const publishedAt = NOW - 65 * HOUR;
  const snaps = [
    { at: publishedAt + 22 * HOUR, views: 1_493_384 },
    { at: publishedAt + 47 * HOUR, views: 2_577_704 },
  ];

  it("relevés en heures après la publication, et la pente des deux derniers", () => {
    const c = curveOf(snaps, publishedAt);
    expect(c).toEqual([
      { h: 22, views: 1_493_384 },
      { h: 47, views: 2_577_704 },
    ]);
    expect(lastGrowth(c)).toEqual({ fromH: 22, toH: 47, pct: 73 });
    expect(lastGrowth(c.slice(0, 1))).toBeNull();
  });

  it("la petite courbe part de la publication (0 vue) et finit en haut à droite", () => {
    const pts = sparklinePoints(curveOf(snaps, publishedAt), 74, 26).split(" ");
    expect(pts).toHaveLength(3);
    expect(pts[0]).toBe("2.0,24.0");
    expect(pts[2]).toBe("72.0,2.0");
    expect(sparklinePoints([], 74, 26)).toBe("");
  });
});

describe("noms des sons", () => {
  it("« original sound - x » devient le son de @x ; une vraie musique garde son titre", () => {
    expect(originalSoundOf("original sound - georgiaspamming")).toBe("georgiaspamming");
    expect(originalSoundOf("son original - meline.stalk")).toBe("meline.stalk");
    expect(originalSoundOf("Elastic Heart")).toBeNull();
    expect(originalSoundOf("Save My Soul")).toBeNull();
  });
});

describe("pubs regroupées par créa", () => {
  const ad = (id: string, o: Partial<AdLike> = {}): AdLike => ({
    id,
    platform: "meta",
    app: "Snitchy",
    rival: true,
    advertiser: "Snitchy",
    text: "Sauras-tu résoudre les affaires ? 🔍 · Snitchy : jeu d'enquête",
    active: true,
    runDays: 20,
    firstShownAt: NOW - 20 * DAY,
    url: `https://www.facebook.com/ads/library?id=${id}`,
    videoUrl: null,
    ...o,
  });

  it("12 annonces Snitchy au même texte n'en font qu'une ; une autre langue est une autre créa", () => {
    const ads = [
      ...Array.from({ length: 6 }, (_, i) => ad(`fr${i}`, { runDays: 20 - i })),
      ad("fr-arretee", { active: false, runDays: 25 }),
      ...Array.from({ length: 5 }, (_, i) => ad(`de${i}`, { text: "Kannst du die Fälle lösen? 🔍 · Snitchy: Detektivspiel" })),
    ];
    const g = groupAds(ads);
    expect(g).toHaveLength(2);
    const fr = g.find((x) => x.text?.startsWith("Sauras"))!;
    expect(fr.ads).toHaveLength(7);
    expect(fr.activeCount).toBe(6);
    // La plus longue court depuis 25 jours ; le lien est celui d'une annonce active.
    expect(fr.runDays).toBe(25);
    expect(fr.lead.active).toBe(true);
  });

  it("un texte de catalogue n'est pas un texte, et ne fusionne pas des annonceurs différents", () => {
    expect(isTemplateText("{{product.brand}} · {{product.name}} · {{product.description}}")).toBe(true);
    expect(isTemplateText("Get rizz in your keyboard.")).toBe(false);
    const g = groupAds([
      ad("s1", { app: "Stalkie", advertiser: "Stalkie", text: "{{product.brand}} · {{product.name}}", active: false }),
      ad("s2", { app: "Stalkie", advertiser: "Stalkie", text: "{{product.brand}} · {{product.name}} · {{product.description}}", active: false }),
      ad("s3", { app: "Stalkie", advertiser: "Girl Sherlock Mobile Detective Game", text: "{{product.brand}}", active: false }),
    ]);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.text === null)).toBe(true);
  });

  it("concurrentes d'abord, actives d'abord, puis les plus longues", () => {
    const g = groupAds([
      ad("autre", { app: "Rizz App", rival: false, advertiser: "Smoothspeak", text: "Get rizz", runDays: 278 }),
      ad("arretee", { text: "vieille créa", active: false, runDays: 36 }),
      ad("active", { text: "créa active", runDays: 15 }),
    ]);
    expect(g.map((x) => x.lead.id)).toEqual(["active", "arretee", "autre"]);
  });
});

describe("la semaine d'une app", () => {
  it("ses vidéos qui sortent du lot (7 jours, hors passées) et ses créas actives", () => {
    const signals = [
      sig("a", { app: "FollowSpy", multiplier: 286 }),
      sig("b", { app: "FollowSpy", multiplier: 141, publishedAt: NOW - 6 * DAY }),
      sig("vieille", { app: "FollowSpy", publishedAt: NOW - 9 * DAY }),
      sig("passee", { app: "FollowSpy", status: "ignore" }),
      sig("autre", { app: "RecentFollow" }),
    ];
    const ads: AdLike[] = [
      { id: "1", platform: "meta", app: "FollowSpy", rival: true, advertiser: "FS", text: "x", active: true, runDays: 3, firstShownAt: null, url: "u1", videoUrl: null },
      { id: "2", platform: "meta", app: "FollowSpy", rival: true, advertiser: "FS", text: "x", active: true, runDays: 2, firstShownAt: null, url: "u2", videoUrl: null },
      { id: "3", platform: "meta", app: "FollowSpy", rival: true, advertiser: "FS", text: "y", active: false, runDays: 9, firstShownAt: null, url: "u3", videoUrl: null },
    ];
    const w = appWeek("FollowSpy", signals, ads, NOW);
    expect(w.hits.map((s) => s.id)).toEqual(["a", "b"]);
    expect(w.activeAds).toBe(1);
  });
});

describe("repérer les gagnants (09/11/2026)", () => {
  it("se partage : 2 % des vues partagées ou plus (p90 mesuré 2,07 %)", () => {
    expect(sharesWell({ views: 2_577_704, shares: 160_501 })).toBe(true); // @gigi.girlytea, 6,2 %
    expect(sharesWell({ views: 717_812, shares: 2_519 })).toBe(false); // @soysarahi303, 0,35 %
    expect(sharesWell({ views: 0, shares: 10 })).toBe(false);
  });

  it("en train de partir : moins de 24 h, 10× la normale, 10 000 vues ; jamais traitée ni d'un autre projet", () => {
    // @rated_chats (Plug AI) : 53 677 vues à H+9.
    expect(isEarlyHit({ publishedAt: NOW - 9 * HOUR, views: 53_677, multiplier: 12 }, NOW)).toBe(true);
    expect(isEarlyHit({ publishedAt: NOW - 30 * HOUR, views: 53_677, multiplier: 12 }, NOW)).toBe(false);
    expect(isEarlyHit({ publishedAt: NOW - 9 * HOUR, views: 8_000, multiplier: 40 }, NOW)).toBe(false);
    expect(isEarlyHit({ publishedAt: NOW - 9 * HOUR, views: 53_677, multiplier: 4 }, NOW)).toBe(false);
    const signals = [
      sig("jeune", { publishedAt: NOW - 5 * HOUR, views: 60_000, multiplier: 30 }),
      sig("plusJeuneMoinsFort", { publishedAt: NOW - 2 * HOUR, views: 20_000, multiplier: 12 }),
      sig("traitee", { publishedAt: NOW - 5 * HOUR, views: 60_000, multiplier: 90, status: "ignore" }),
      sig("ailleurs", { publishedAt: NOW - 5 * HOUR, views: 60_000, multiplier: 90, elsewhere: true }),
      sig("vieille", { publishedAt: NOW - 3 * DAY, views: 900_000, multiplier: 200 }),
    ];
    expect(earlyHits(signals, NOW).map((s) => s.id)).toEqual(["jeune", "plusJeuneMoinsFort"]);
  });

  it("trier par partages : partages ÷ vues", () => {
    const f = defaultFilters();
    f.sort = "shares";
    const r = applyFilters([sig("a", { views: 100_000, shares: 500 }), sig("b", { views: 10_000, shares: 900 })], f, NOW);
    expect(r.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("« texte sur plan » : 12 secondes ou moins, hors de ce qu'on regarde (09/11/2026)", () => {
  it("12 secondes ou moins ; une durée inconnue ou nulle n'est pas « courte »", () => {
    expect(isTextOnShot({ durationSec: 9 })).toBe(true);
    expect(isTextOnShot({ durationSec: 12 })).toBe(true);
    expect(isTextOnShot({ durationSec: 12.1 })).toBe(false);
    expect(isTextOnShot({ durationSec: null })).toBe(false);
    expect(isTextOnShot({})).toBe(false);
    expect(isTextOnShot({ durationSec: 0 })).toBe(false);
  });

  it("elle sort de la file du jour et d'« en train de partir » ; la semaine d'un concurrent la range après les autres, Explorer la garde", () => {
    const signals = [
      sig("courte", { competitor: "RecentFollow", app: "RecentFollow", multiplier: 80, durationSec: 9, publishedAt: NOW - 5 * HOUR }),
      sig("demo", { competitor: "RecentFollow", app: "RecentFollow", multiplier: 20, durationSec: 31, publishedAt: NOW - 5 * HOUR }),
      sig("sansDuree", { competitor: "RecentFollow", app: "RecentFollow", multiplier: 12, publishedAt: NOW - 5 * HOUR }),
    ];
    expect(todayQueue(signals, NOW).map((s) => s.id)).toEqual(["demo", "sansDuree"]);
    expect(earlyHits(signals, NOW).map((s) => s.id)).toEqual(["demo", "sansDuree"]);
    // « Sa meilleure » = la meilleure vidéo qui n'est pas un texte sur plan.
    expect(appWeek("RecentFollow", signals, [], NOW).hits.map((s) => s.id)).toEqual(["demo", "sansDuree", "courte"]);
    // Explorer (les filtres par défaut) la garde, en tête de son tri.
    expect(applyFilters(signals, defaultFilters(), NOW).map((s) => s.id)).toEqual(["courte", "demo", "sansDuree"]);
  });
});
