import { describe, expect, it } from "vitest";
import {
  SC_PRICE_PER_CREDIT,
  addSnapshot,
  allowance,
  budgetState,
  curveCandidate,
  keepSignal,
  langBucket,
  nextCheckpointAt,
  nextQueries,
  normalizeBudget,
  parseScVideo,
  plannedUsd,
} from "../convex/radarSignalsMath";
import { DISCOVERY_QUERIES } from "../convex/radarDiscoveryQueries";
import {
  applyFilters,
  chips,
  clearAll,
  defaultFilters,
  facets,
  fromSearchParams,
  PRESETS,
  removeChip,
  sameFilters,
  suggestions,
  toSearchParams,
  toggle,
  type FilterableSignal,
  type Filters,
} from "../convex/radarSignalFilters";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 6, 13, 0);

/** Une vidéo telle que la renvoie `/v1/tiktok/search/keyword?trim=true` (06/11/2026, champs utiles). */
const ARPEGE = {
  aweme_id: "7704722574420266272",
  desc: "Voici toutes les applications qu’il faut installer dans son téléphone pour la survie telle que Pocketpal,Kiwix",
  desc_language: "fr",
  region: "FR",
  statistics: { play_count: 168_850, digg_count: 6_018, comment_count: 216, share_count: 5_521, collect_count: 8_280 },
  video: { duration: 136_648, cover: { url_list: ["https://p16.tiktokcdn.com/cover.jpeg?x-expires=1"] } },
  author: { unique_id: "arpegesauvage", uid: "7681242475235296278", follower_count: 1_801 },
  create_time: 1_793_895_521,
  is_ad: false,
  url: "https://www.tiktok.com/@arpegesauvage/video/7704722574420266272",
};

describe("parseScVideo", () => {
  it("lit une vidéo de recherche allégée, champ par champ", () => {
    expect(parseScVideo(ARPEGE)).toEqual({
      videoId: "7704722574420266272",
      url: "https://www.tiktok.com/@arpegesauvage/video/7704722574420266272",
      authorId: "7681242475235296278",
      authorHandle: "arpegesauvage",
      authorFans: 1_801,
      caption: ARPEGE.desc,
      lang: "fr",
      region: "FR",
      publishedAt: 1_793_895_521_000,
      durationSec: 136.6,
      coverUrl: "https://p16.tiktokcdn.com/cover.jpeg?x-expires=1",
      isAd: false,
      views: 168_850,
      likes: 6_018,
      comments: 216,
      shares: 5_521,
      saves: 8_280,
    });
  });

  it("déballe aweme_info (réponse non allégée) et reconstruit le lien absent", () => {
    const { url: _u, ...sansLien } = ARPEGE;
    void _u;
    const v = parseScVideo({ aweme_info: sansLien });
    expect(v?.videoId).toBe("7704722574420266272");
    expect(v?.url).toBe("https://www.tiktok.com/@arpegesauvage/video/7704722574420266272");
  });

  it("refuse une vidéo sans id, sans pseudo ou sans date", () => {
    expect(parseScVideo({ ...ARPEGE, aweme_id: undefined })).toBeNull();
    expect(parseScVideo({ ...ARPEGE, author: { follower_count: 3 } })).toBeNull();
    expect(parseScVideo({ ...ARPEGE, create_time: 0 })).toBeNull();
    expect(parseScVideo("pas une vidéo")).toBeNull();
  });
});

describe("langBucket", () => {
  it("range l'espagnol par marché, et replie sur la langue de la recherche", () => {
    expect(langBucket("es", "ES")).toBe("es-es");
    expect(langBucket("es", "MX")).toBe("es-am");
    expect(langBucket("es", undefined)).toBe("es-am");
    expect(langBucket("pt", "BR")).toBe("pt");
    expect(langBucket("un", "FR", "fr")).toBe("fr");
    expect(langBucket(undefined, "US", "en")).toBe("en");
    expect(langBucket("it", "IT")).toBe("autre");
  });
});

describe("tri à la découverte et courbe", () => {
  const pub = NOW - 21 * HOUR;
  it("garde une vidéo assez vue et assez au-dessus de son compte, pas une pub", () => {
    expect(keepSignal({ views: 168_850, authorFans: 1_801, isAd: false })).toBe(true);
    expect(keepSignal({ views: 9_999, authorFans: 12, isAd: false })).toBe(false);
    // 3 030 073 vues pour 56 461 abonnés = 53,7× : gardée ; 9× : non.
    expect(keepSignal({ views: 3_030_073, authorFans: 56_461, isAd: false })).toBe(true);
    expect(keepSignal({ views: 508_149, authorFans: 56_461, isAd: false })).toBe(false);
    expect(keepSignal({ views: 168_850, authorFans: 1_801, isAd: true })).toBe(false);
  });

  it("admet dans la courbe une vidéo jeune et rapide, pas une vieille", () => {
    expect(curveCandidate({ views: 168_850, authorFans: 1_801, publishedAt: pub }, NOW)).toBe(true);
    // 15× ses abonnés, mais 1 250 vues/h : admise par la vitesse.
    expect(curveCandidate({ views: 30_000, authorFans: 2_000, publishedAt: NOW - 24 * HOUR }, NOW)).toBe(true);
    // 15× et 638 vues/h à H+47 : ni l'un ni l'autre.
    expect(curveCandidate({ views: 30_000, authorFans: 2_000, publishedAt: NOW - 47 * HOUR }, NOW)).toBe(false);
    expect(curveCandidate({ views: 5_939_334, authorFans: 3_332, publishedAt: NOW - 49 * HOUR }, NOW)).toBe(false);
  });

  it("donne le prochain relevé H+6, H+24, H+48 à plus de 30 minutes", () => {
    const t = NOW - 2 * HOUR;
    expect(nextCheckpointAt(t, NOW)).toBe(t + 6 * HOUR);
    expect(nextCheckpointAt(t, t + 5.75 * HOUR)).toBe(t + 24 * HOUR);
    expect(nextCheckpointAt(t, t + 30 * HOUR)).toBe(t + 48 * HOUR);
    expect(nextCheckpointAt(t, t + 47.6 * HOUR)).toBeUndefined();
  });

  it("espace les relevés de 2 h et n'en garde que 12", () => {
    const s0 = [{ at: NOW, views: 168_850 }];
    expect(addSnapshot(s0, NOW + HOUR, 169_400)).toEqual([{ at: NOW, views: 169_400 }]);
    expect(addSnapshot(s0, NOW + HOUR, 169_400, true)).toHaveLength(2);
    const many = Array.from({ length: 12 }, (_, i) => ({ at: NOW + i * 3 * HOUR, views: 1_000 + i }));
    const next = addSnapshot(many, NOW + 40 * HOUR, 9_999);
    expect(next).toHaveLength(12);
    expect(next[0].views).toBe(1_001);
    expect(next[11].views).toBe(9_999);
  });

  it("fait tourner les recherches sans en sauter ni en répéter", () => {
    expect(DISCOVERY_QUERIES).toHaveLength(60);
    const a = nextQueries(55, 10, DISCOVERY_QUERIES);
    expect(a.queries.map((x) => x.query)).toEqual([...DISCOVERY_QUERIES.slice(55), ...DISCOVERY_QUERIES.slice(0, 5)].map((x) => x.query));
    expect(a.cursor).toBe(5);
    expect(nextQueries(7, 0, DISCOVERY_QUERIES)).toEqual({ queries: [], cursor: 7 });
  });
});

describe("budget", () => {
  const d = normalizeBudget(null);
  const usage = (poste: string, credits: number, day = "2026-11-06") => ({ poste, credits, day });

  it("prévoit 178,22 $ au plus par défaut sous un plafond de 300 $ : recherche, courbe, comptes, réseaux, Instagram, transcriptions, pubs", () => {
    expect(d.capUsd).toBe(300);
    expect(plannedUsd(d)).toBeCloseTo((60 * 30 + 100 * 3 * 30 + 2_000 * 30 + 12_000 + 300 * 30 + 50 * 30 + 1_500) * SC_PRICE_PER_CREDIT, 6);
    expect(plannedUsd(d)).toBeCloseTo(178.224, 3);
  });

  it("des réglages d'avant la v4 prennent les postes relevés, les postes branchés et le plafond par défaut ; ceux de la v4 sont respectés", () => {
    const v1 = {
      capUsd: 60,
      postes: [
        { key: "search", qty: 60, on: true },
        { key: "curve", qty: 100, on: true },
        { key: "tiktok", qty: 200, on: false },
        { key: "demand", qty: 1_500, on: false },
      ],
      cutOrder: ["search", "transcript", "curve", "insta", "ai", "tiktok"],
      alert80: true,
    };
    // Les réglages réels de la prod au 06/11/2026 (v1, plafond 60 $).
    const m = normalizeBudget(v1);
    expect(m.capUsd).toBe(300);
    expect(m.postes.find((p) => p.key === "search")).toEqual({ key: "search", qty: 60, on: true });
    expect(m.postes.find((p) => p.key === "curve")).toEqual({ key: "curve", qty: 100, on: true });
    expect(m.postes.find((p) => p.key === "tiktok")).toEqual({ key: "tiktok", qty: 2_000, on: true });
    expect(m.postes.find((p) => p.key === "network")).toEqual({ key: "network", qty: 12_000, on: true });
    // Instagram, transcriptions et pubs, éteints tant qu'ils n'étaient pas branchés, s'allument.
    expect(m.postes.find((p) => p.key === "insta")).toEqual({ key: "insta", qty: 300, on: true });
    expect(m.postes.find((p) => p.key === "transcript")).toEqual({ key: "transcript", qty: 50, on: true });
    expect(m.postes.find((p) => p.key === "ads")).toEqual({ key: "ads", qty: 1_500, on: true });
    expect(m.cutOrder).toEqual(["search", "transcript", "curve", "insta", "ai", "tiktok", "ads", "network"]);
    // Une v2 (réglée après #454) passe aussi au cran au-dessus.
    const v2 = normalizeBudget({ ...v1, budgetVersion: 2, postes: [...v1.postes, { key: "network", qty: 900, on: true }] });
    expect([v2.capUsd, v2.postes.find((p) => p.key === "network")?.qty]).toEqual([300, 12_000]);
    // Une v4 est respectée telle quelle.
    const v3 = normalizeBudget({ ...v1, capUsd: 150, budgetVersion: 4, postes: [...v1.postes, { key: "network", qty: 900, on: true }] });
    expect(v3.capUsd).toBe(150);
    expect(v3.postes.find((p) => p.key === "tiktok")).toEqual({ key: "tiktok", qty: 200, on: false });
    expect(v3.postes.find((p) => p.key === "network")).toEqual({ key: "network", qty: 900, on: true });
  });

  it("garde éteints les postes pas encore branchés, borne les quantités, complète l'ordre de coupure", () => {
    const b = normalizeBudget({
      capUsd: -4,
      postes: [
        { key: "ai", qty: 6, on: true },
        { key: "tiktok", qty: 400, on: true },
        { key: "search", qty: 1_000, on: true },
        { key: "curve", qty: 87.6, on: false },
      ],
      cutOrder: ["curve", "curve", "inconnu", "demand"],
      alert80: false,
      budgetVersion: 4,
    });
    expect(b.capUsd).toBe(300);
    expect(b.postes.find((p) => p.key === "ai")?.on).toBe(false);
    expect(b.postes.find((p) => p.key === "tiktok")?.on).toBe(true);
    expect(b.postes.find((p) => p.key === "search")).toEqual({ key: "search", qty: 300, on: true });
    expect(b.postes.find((p) => p.key === "curve")).toEqual({ key: "curve", qty: 88, on: false });
    expect(b.cutOrder).toEqual(["curve", "search", "transcript", "ads", "insta", "ai", "network", "tiktok"]);
    expect(b.alert80).toBe(false);
  });

  it("donne à un passage sa part du jour, bornée par ce qui reste aujourd'hui", () => {
    const s = budgetState(d, []);
    expect(allowance(d, s, "search", 0, 4)).toBe(15);
    expect(allowance(d, s, "search", 55, 4)).toBe(5);
    expect(allowance(d, s, "search", 60, 4)).toBe(0);
    // 100 vidéos × 3 relevés = 300/jour → 13 par heure ; 2 000 relevés de comptes → 84 par heure.
    expect(allowance(d, s, "curve", 0, 24)).toBe(13);
    expect(allowance(d, s, "tiktok", 0, 24)).toBe(84);
    // Poste pas encore branché : rien.
    expect(allowance(d, s, "ai", 0, 1)).toBe(0);
  });

  /** Le budget de la phase 1 : recherche (60/jour) et courbe (100/jour) seules. */
  const p1 = (cap: number) => ({
    ...d,
    capUsd: cap,
    postes: d.postes.map((p) => (p.key === "curve" ? { ...p, qty: 100 } : ["tiktok", "network", "insta", "transcript", "ads"].includes(p.key) ? { ...p, on: false } : p)),
  });

  it("au plafond, tout s'arrête", () => {
    const b = { ...d, capUsd: 20 };
    // 10 640 crédits = 20,0032 $ (10 638 ne font que 19,9994 $).
    const s = budgetState(b, [usage("curve", 10_640, "2026-11-03")]);
    expect(s.capReached).toBe(true);
    expect(s.cut).toEqual(["search", "curve", "tiktok", "network", "insta", "transcript", "ads"]);
    expect(allowance(b, s, "curve", 0, 24)).toBe(0);
  });

  it("entre 80 et 100 %, coupe dans l'ordre jusqu'à ce que la projection tienne", () => {
    const b = p1(20);
    // 8 564 crédits = 16,10 $ : 80 % dépassés ; projection 16,10 + 0,82 (courbe) + 3,38 (recherche) = 20,30 $.
    const s = budgetState(b, [usage("curve", 8_564, "2026-11-04")]);
    expect(s.over80).toBe(true);
    expect(s.capReached).toBe(false);
    expect(s.cut).toEqual(["search"]);
    expect(s.projectedUsd).toBeLessThanOrEqual(20);
    expect(allowance(b, s, "search", 0, 4)).toBe(0);
    expect(allowance(b, s, "curve", 0, 24)).toBeGreaterThan(0);
    // Ordre inversé : c'est la courbe qui saute, et la recherche continue.
    const inv = { ...b, cutOrder: ["curve" as const, "search" as const, "transcript" as const, "insta" as const, "ai" as const, "network" as const, "tiktok" as const] };
    expect(budgetState(inv, [usage("curve", 8_564, "2026-11-04")]).cut).toEqual(["curve"]);
  });

  it("à 80 % sans dépassement prévu, rien n'est coupé ; un poste s'arrête à son enveloppe", () => {
    // 25 798 crédits de courbe = 48,50 $ : 80 % du plafond de 60 $, mais l'enveloppe
    // de la courbe (16,92 $) est déjà mangée ; il reste la recherche (3,38 $) → 51,88 $.
    const b = p1(60);
    const s = budgetState(b, [usage("curve", 25_798, "2026-11-02")]);
    expect(s.over80).toBe(true);
    expect(s.cut).toEqual([]);
    expect(s.projectedUsd).toBeCloseTo(48.5 + 3.384, 2);
    expect(allowance(b, s, "curve", 0, 24)).toBe(0);
    expect(allowance(b, s, "search", 0, 4)).toBe(15);
  });
});

// ─── Filtres de l'écran Signaux ─────────────────────────────────────────────

const sig = (handle: string, fans: number, views: number, ageH: number, lang: string, extra: Partial<FilterableSignal> = {}): FilterableSignal & { id: string } => ({
  id: handle,
  handle,
  fans,
  views,
  caption: extra.caption ?? `vidéo de @${handle}`,
  platform: extra.platform ?? "tiktok",
  lang,
  publishedAt: NOW - ageH * HOUR,
  ratio: views / Math.max(fans, 100),
  competitor: extra.competitor ?? null,
  app: extra.app ?? extra.competitor ?? null,
  status: extra.status ?? "nouveau",
});

/** Les vraies vidéos du test du 06/11/2026 (pseudos, abonnés, vues, âge). */
const DATA = [
  sig("reneelouisetech", 11_203, 2_391_751, 121, "en", { caption: "Your chats with ChatGPT are being watched if you don't do this!" }),
  sig("djkartierapp", 56_461, 3_030_073, 35, "en"),
  sig("thefern.app", 64, 58_679, 14, "en"),
  sig("johan_love8", 819, 206_233, 152, "fr", { caption: "Pour vous amuser un peu à distance, testez ça ! #love8app", app: "Love8" }),
  sig("cleversonmgallego", 3_389, 415_872, 84, "pt"),
  sig("arpegesauvage", 1_801, 168_850, 21, "fr"),
  sig("mundoyoutubebrs", 3_480, 230_287, 25, "pt"),
  sig("karahollowayy", 2_030, 56_753, 17, "en"),
  sig("fannyfloress_", 3_191, 64_042, 84, "es-am"),
  sig("dressai.co", 238, 25_478, 159, "fr", { caption: "DressAI est ENFIN disponible sur l'App Store" }),
  sig("bobstyle2.0", 639, 13_232, 144, "fr", { caption: "Le catalogue est énorme et ça s'appelle DressCode" }),
  sig("alex.maneja23", 2_445, 49_713, 116, "es-es"),
  sig("elo.stalk", 77, 38_383, 45, "fr", { competitor: null }),
  sig("s.ecrettacc.vero", 3_332, 5_939_334, 1_226, "en", { competitor: "The Ick", caption: "This is actually insane #theick" }),
  sig("joscissecretaccount2", 14, 8_704, 623, "en", { competitor: "The Ick" }),
  sig("martu.repli", 10, 10_338, 928, "es-am", { competitor: "The Ick" }),
];

const count = (f: Filters) => applyFilters(DATA, f, NOW).length;
const opt = (f: Filters, group: string, value: string) =>
  facets(DATA, f, NOW).groups.find((g) => g.key === group)!.options.find((o) => o.value === value)!;

describe("filtres de l'écran Signaux", () => {
  it("par défaut : les 7 derniers jours, sans les ignorées", () => {
    expect(count(defaultFilters())).toBe(13);
    expect(chips(defaultFilters())).toEqual([]);
  });

  it("OU dans un groupe, ET entre groupes", () => {
    const br = toggle(toggle(defaultFilters(), "langue", "pt"), "langue", "es-am");
    expect(count(br)).toBe(3);
    // + petits comptes (moins de 1 k abonnés) : aucune de ces trois → 0.
    expect(count(toggle(br, "taille", "xs"))).toBe(0);
    // + comptes de 1 k à 10 k : les trois.
    expect(count(toggle(br, "taille", "s"))).toBe(3);
  });

  it("le compteur d'une case dit ce qu'on obtient en la cochant", () => {
    const f = defaultFilters();
    expect(opt(f, "langue", "fr").count).toBe(5);
    expect(opt(f, "langue", "en").count).toBe(4);
    const fr = toggle(f, "langue", "fr");
    expect(count(fr)).toBe(5);
    // Cocher l'anglais en plus ajoute ses 4 : le compteur ne dépend pas de la case cochée du même groupe.
    expect(opt(fr, "langue", "en").count).toBe(4);
    expect(count(toggle(fr, "langue", "en"))).toBe(9);
  });

  it("une case à 0 ne se coche pas ; cochée puis tombée à 0, elle reste décochable", () => {
    const conc = toggle({ ...defaultFilters(), age: "90" }, "origine", "concurrent");
    expect(opt(conc, "langue", "pt")).toMatchObject({ count: 0, disabled: true, checked: false });
    const coincee = toggle(conc, "langue", "pt");
    expect(count(coincee)).toBe(0);
    expect(opt(coincee, "langue", "pt")).toMatchObject({ count: 0, checked: true, disabled: false });
  });

  it("résultat vide : propose de retirer un filtre, avec ce qu'on retrouve", () => {
    const vide = toggle(toggle(defaultFilters(), "origine", "concurrent"), "langue", "pt");
    expect(count(vide)).toBe(0);
    expect(suggestions(DATA, vide, NOW)).toEqual([{ key: "origine", count: 2 }]);
    // Sur toute la période : retirer la langue rend les 3 concurrents, l'origine les 2 vidéos BR ;
    // revenir à 7 jours ne rend rien, donc n'est pas proposé.
    const tout = { ...vide, age: "all" as const };
    expect(suggestions(DATA, tout, NOW)).toEqual([
      { key: "langue", count: 3 },
      { key: "origine", count: 2 },
    ]);
  });

  it("période et seuil : un seul choix, avec leurs compteurs", () => {
    const fc = facets(DATA, defaultFilters(), NOW);
    expect(fc.age.map((a) => [a.value, a.count])).toEqual([["1", 3], ["3", 6], ["7", 13], ["30", 14], ["90", 16], ["all", 16]]);
    // 200× et plus : reneelouisetech 213×, thefern.app 587×, johan_love8 252×, elo.stalk 384×, s.ecrettacc.vero 1 783×.
    expect(count({ ...defaultFilters(), age: "all", seuil: "200" })).toBe(5);
  });

  it("une pastille par case, une seule pour le statut, retirée une à une", () => {
    let f = toggle(toggle(defaultFilters(), "langue", "pt"), "langue", "es-am");
    f = { ...f, age: "30", q: "  app  " };
    f = toggle(f, "statut", "ignore");
    const c = chips(f);
    expect(c).toEqual([
      { kind: "q", value: "app" },
      { kind: "age", value: "30" },
      { kind: "group", key: "langue", value: "pt" },
      { kind: "group", key: "langue", value: "es-am" },
      { kind: "statut", values: ["nouveau", "enregistre", "adapte", "ignore"] },
    ]);
    const sansStatut = removeChip(f, c[4]);
    expect(sansStatut.sel.statut).toEqual(["nouveau", "enregistre", "adapte"]);
    expect(removeChip(f, c[2]).sel.langue).toEqual(["es-am"]);
  });

  it("les ignorées disparaissent par défaut et reviennent avec le statut « Ignorées »", () => {
    const data = DATA.map((s) => (s.handle === "thefern.app" ? { ...s, status: "ignore" as const } : s));
    expect(applyFilters(data, defaultFilters(), NOW).map((s) => s.handle)).not.toContain("thefern.app");
    expect(applyFilters(data, toggle(defaultFilters(), "statut", "ignore"), NOW).map((s) => s.handle)).toContain("thefern.app");
  });

  it("recherche dans la légende, le pseudo et le concurrent", () => {
    expect(applyFilters(DATA, { ...defaultFilters(), q: "dress" }, NOW).map((s) => s.handle)).toEqual(["dressai.co", "bobstyle2.0"]);
    expect(applyFilters(DATA, { ...defaultFilters(), age: "all", q: "the ick" }, NOW)).toHaveLength(3);
  });

  it("trie par vues ÷ abonnés, vitesse, vues ou date", () => {
    const top = (sort: Filters["sort"]) => applyFilters(DATA, { ...defaultFilters(), sort }, NOW).slice(0, 2).map((s) => s.handle);
    expect(top("ratio")).toEqual(["thefern.app", "elo.stalk"]);
    expect(top("views")).toEqual(["djkartierapp", "reneelouisetech"]);
    expect(top("recent")).toEqual(["thefern.app", "karahollowayy"]);
    expect(top("vph")).toEqual(["djkartierapp", "reneelouisetech"]);
  });

  it("tout effacer revient au défaut sans perdre le tri", () => {
    const f = toggle({ ...defaultFilters(), age: "90", sort: "views" }, "origine", "autre");
    const c = clearAll(f);
    expect(sameFilters(c, defaultFilters())).toBe(true);
    expect(c.sort).toBe("views");
  });

  it("les vues enregistrées se reconnaissent, et une vue modifiée n'en est plus une", () => {
    const conc = PRESETS.find((p) => p.id === "concurrents")!.patch(defaultFilters());
    expect(count(conc)).toBe(3);
    expect(PRESETS.filter((p) => sameFilters(p.patch(defaultFilters()), conc)).map((p) => p.id)).toEqual(["concurrents"]);
    const modif = toggle(conc, "langue", "en");
    expect(PRESETS.some((p) => sameFilters(p.patch(defaultFilters()), modif))).toBe(false);
  });

  it("le filtre App : ses valeurs viennent des données, une app à 0 se grise, l'adresse la garde", () => {
    const fc = facets(DATA, defaultFilters(), NOW).groups.find((g) => g.key === "app")!;
    expect(fc.options.map((o) => [o.value, o.count, o.disabled])).toEqual([
      ["Love8", 1, false],
      ["The Ick", 0, true],
    ]);
    const love = toggle(defaultFilters(), "app", "Love8");
    expect(applyFilters(DATA, love, NOW).map((s) => s.handle)).toEqual(["johan_love8"]);
    expect(chips(love)).toEqual([{ kind: "group", key: "app", value: "Love8" }]);
    const back = fromSearchParams(toSearchParams(toggle(love, "app", "The Ick")));
    expect(back.sel.app).toEqual(["Love8", "The Ick"]);
    // Une app inconnue d'un vieux lien est gardée, et reste décochable.
    const old = fromSearchParams(new URLSearchParams("a=Appli%20disparue"));
    expect(old.sel.app).toEqual(["Appli disparue"]);
    expect(facets(DATA, old, NOW).groups.find((g) => g.key === "app")!.options.find((o) => o.value === "Appli disparue")).toMatchObject({ checked: true, disabled: false });
  });

  it("l'adresse garde tout et seulement ce qui s'écarte du défaut", () => {
    expect(toSearchParams(defaultFilters()).toString()).toBe("");
    let f = toggle(toggle(defaultFilters(), "langue", "pt"), "origine", "autre");
    f = { ...f, age: "30", seuil: "50", q: "app", sort: "vph", sel: { ...f.sel, statut: [] } };
    const p = toSearchParams(f, new URLSearchParams("onglet=signaux"));
    expect(p.get("onglet")).toBe("signaux");
    expect(p.get("st")).toBe("-");
    const back = fromSearchParams(p);
    expect(sameFilters(back, f)).toBe(true);
    expect(back.sort).toBe("vph");
    // Un vieux lien avec des valeurs inconnues ne casse rien.
    const old = fromSearchParams(new URLSearchParams("l=fr,klingon&age=12&tri=hasard"));
    expect(old.sel.langue).toEqual(["fr"]);
    expect(old.age).toBe("7");
    expect(old.sort).toBe("ratio");
  });
});
