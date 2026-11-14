import { describe, expect, it } from "vitest";
import { NAMING_QUERIES } from "../convex/radarNamingMath";
import { productHashtags, hashtagCandidates } from "../convex/radarNetworkMath";
import {
  SC_PRICE_PER_CREDIT,
  addSnapshot,
  allowance,
  budgetState,
  curveCandidate,
  keepSignal,
  langBucket,
  nextCheckpointAt,
  foundByLabel,
  nextQueries,
  normalizeBudget,
  allowanceUsd,
  parseScVideo,
  plannedUsd,
  BALANCE_PROBE_MS,
  CREDIT_RESERVE,
  creditAlert,
  creditTier,
  daysOfCredits,
  needsBalanceProbe,
  recentPerDay,
  tierDefers,
  ECONOMY_DAYS,
  SURVIVAL_DAYS,
} from "../convex/radarSignalsMath";
import {
  DISCOVERY_QUERIES,
  DISCOVERY_ROTATION,
  WEB_QUERIES,
  isWebFind,
  MONEY_HASHTAGS,
  MONEY_QUERIES,
  discoveryRotation,
  hashtagsOf,
  isRelationFind,
  signalThemes,
} from "../convex/radarDiscoveryQueries";
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

  it("une trouvaille « app pour couple » se reconnaît à la recherche qui l'a ramenée (10/11/2026)", () => {
    // Les `foundBy` relevés en prod : la tournure, puis le marché.
    expect(isRelationFind(["app for couples·us"])).toBe(true);
    expect(isRelationFind(["this app·us", "app para parejas·mx"])).toBe(true);
    expect(isRelationFind(["app pour couple·fr"])).toBe(true);
    expect(isRelationFind(["app para casal·br"])).toBe(true);
    // Les deux autres tournures « de niche » ne ramènent rien de la niche (0 vidéo sur 7) ; les recherches de réseau non plus.
    expect(isRelationFind(["achei um app·br"])).toBe(false);
    expect(isRelationFind(["app that tells you·us"])).toBe(false);
    expect(isRelationFind(["réseau Rizz App"])).toBe(false);
    expect(isRelationFind([])).toBe(false);
    // Chaque tournure reconnue est bien une recherche qui tourne.
    for (const q of ["app pour couple", "app para casal", "app para parejas", "app for couples"]) expect(DISCOVERY_QUERIES.some((d) => d.query === q)).toBe(true);
  });

  it("fait tourner les recherches sans en sauter ni en répéter", () => {
    expect(DISCOVERY_QUERIES).toHaveLength(60);
    expect(MONEY_QUERIES).toHaveLength(76);
    // Un tour : les 7 tournures de niche, les 76 du thème argent, les 22 des produits web, puis 13 des 53 autres.
    const niche = ["app pour couple", "app para casal", "app para parejas", "app para parejas", "app for couples", "achei um app", "app that tells you"].sort();
    expect(WEB_QUERIES).toHaveLength(22);
    expect(DISCOVERY_ROTATION).toHaveLength(5 * (7 + 76 + 22) + 53);
    expect(DISCOVERY_ROTATION.slice(0, 7).map((x) => x.query).sort()).toEqual(niche);
    expect(DISCOVERY_ROTATION.slice(7, 83)).toEqual(MONEY_QUERIES);
    expect(DISCOVERY_ROTATION.slice(83, 105)).toEqual(WEB_QUERIES);
    // Un tour fait 7 + 76 + 22 + 13 = 118 recherches.
    expect(DISCOVERY_ROTATION.slice(118, 125).map((x) => x.query).sort()).toEqual(niche);
    expect(DISCOVERY_ROTATION.slice(125, 201)).toEqual(MONEY_QUERIES);
    // 150 recherches par jour, dont 32 aux tournures qui nomment un produit (deux passages) : 118 pour la découverte.
    // D'où que reparte le curseur, la niche, l'argent et les produits web passent chaque jour.
    const parJour = 150 - 2 * NAMING_QUERIES.length;
    expect(parJour).toBe(118);
    const label = (x: { query: string; region: string }) => `${x.query}·${x.region}`;
    const quotidiennes = new Set([...DISCOVERY_QUERIES.filter((x) => niche.includes(x.query)), ...MONEY_QUERIES, ...WEB_QUERIES].map(label));
    expect(quotidiennes.size).toBe(7 + 76 + 22);
    for (const depart of [0, 1, 50, 96, 118, 300, 400, DISCOVERY_ROTATION.length - 1]) {
      const jour = new Set(nextQueries(depart, parJour, DISCOVERY_ROTATION).queries.map(label));
      expect([...quotidiennes].filter((q) => !jour.has(q))).toEqual([]);
    }
    const autres = DISCOVERY_ROTATION.filter((x) => DISCOVERY_QUERIES.includes(x) && !niche.includes(x.query)).map(label);
    expect(new Set(autres).size).toBe(53);
    expect(autres).toHaveLength(53);
    // Sans tournure de niche ni quotidienne, la rotation est la liste telle quelle ; sans thème, celle d'avant le 12/11.
    const horsNiche = DISCOVERY_QUERIES.filter((x) => !niche.includes(x.query));
    expect(discoveryRotation(horsNiche)).toEqual(horsNiche);
    expect(discoveryRotation(DISCOVERY_QUERIES)).toHaveLength(5 * 7 + 53);
    // Le thème seul (sans niche) passe aussi à chaque tour.
    const seul = discoveryRotation(horsNiche, 13, MONEY_QUERIES);
    expect(seul).toHaveLength(5 * 76 + 53);
    expect(seul.slice(89, 165)).toEqual(MONEY_QUERIES);
    const a = nextQueries(55, 10, DISCOVERY_QUERIES);
    expect(a.queries.map((x) => x.query)).toEqual([...DISCOVERY_QUERIES.slice(55), ...DISCOVERY_QUERIES.slice(0, 5)].map((x) => x.query));
    expect(a.cursor).toBe(5);
    expect(nextQueries(7, 0, DISCOVERY_QUERIES)).toEqual({ queries: [], cursor: 7 });
  });
});

describe("thème « argent » (12/11/2026)", () => {
  it("dans les 5 marchés, chaque tournure unique, aucune déjà dans la rotation des apps", () => {
    const parMarche = (r: string) => MONEY_QUERIES.filter((x) => x.region === r);
    expect(["FR", "BR", "MX", "ES", "US"].map((r) => parMarche(r).length)).toEqual([15, 14, 15, 16, 16]);
    expect(parMarche("FR").every((x) => x.lang === "fr") && parMarche("BR").every((x) => x.lang === "pt") && parMarche("US").every((x) => x.lang === "en")).toBe(true);
    expect([...parMarche("MX"), ...parMarche("ES")].every((x) => x.lang === "es")).toBe(true);
    const labels = MONEY_QUERIES.map(foundByLabel);
    expect(new Set(labels).size).toBe(76);
    const apps = new Set(DISCOVERY_QUERIES.map(foundByLabel));
    expect(labels.filter((l) => apps.has(l))).toEqual([]);
  });

  it("range dans le thème ce que ses recherches ramènent, et ce qui porte un hashtag du thème", () => {
    // Les `foundBy` tels que la découverte les écrit : la tournure, puis le marché.
    expect(signalThemes(["side hustle·us"], "")).toEqual(["argent"]);
    expect(signalThemes(["renda extra·br"], "")).toEqual(["argent"]);
    expect(signalThemes(["this app·us", "argent en ligne·fr"], "")).toEqual(["argent"]);
    // Une tournure d'app, ou une tournure du thème dans un marché où elle ne tourne pas, ne suffit pas.
    expect(signalThemes(["this app·us", "réseau Rizz App"], "my favorite app")).toEqual([]);
    expect(signalThemes(["renda extra·us"], "")).toEqual([]);
    // Légendes réelles relevées par le Radar (12/11/2026) : Fluencify, Newly.
    expect(signalThemes(["réseau Fluencify"], "Why am I only finding out about this NOW? Let me see where this takes me! 😭🥹\n\n#UGCJourney #UGCCreator #MakeMoneyOnline #Fluencify #ContentCreator")).toEqual(["argent"]);
    expect(signalThemes([], "Como se cadastrar na fluencify e começar a ganhar em dolar 💵 #ugccreator #techugc #ugc #fluencify\n#creatorsearchinsights ")).toEqual(["argent"]);
    expect(signalThemes([], "Si quieres hacer tu propio aplicación utiliza newly#españa🇪🇸 #parati #trucostiktok #dinero #ganadinero ")).toEqual(["argent"]);
    // Casse et accents ne comptent pas.
    expect(signalThemes([], "#GagnerDeLArgent")).toEqual(["argent"]);
    expect(signalThemes([], "#ganharemdólar")).toEqual(["argent"]);
    // Le mot sans dièse, #ugc seul, #workfromhome, un hashtag qui commence pareil : non.
    expect(signalThemes([], "side hustle tips, make money online")).toEqual([]);
    expect(signalThemes([], "#ugc #workfromhome #fyp #sidehustler")).toEqual([]);
    // Une vidéo d'app ordinaire (The Ick, 06/11/2026) reste hors du thème.
    expect(signalThemes(["this app·us"], "This is actually insane #theick")).toEqual([]);
  });

  it("lit les hashtags d'une légende, collés ou non au texte", () => {
    expect(hashtagsOf("utiliza newly#españa🇪🇸 #parati #Revenu_Passif")).toEqual(["espana", "parati", "revenu_passif"]);
    expect(hashtagsOf("aucun hashtag")).toEqual([]);
    expect([...MONEY_HASHTAGS].every((t) => t === t.toLowerCase() && !/[#\s]/.test(t) && t === t.normalize("NFD").replace(/\p{M}/gu, ""))).toBe(true);
  });
});

describe("budget", () => {
  const d = normalizeBudget(null);
  const usage = (poste: string, credits: number, day = "2026-11-06") => ({ poste, credits, day });

  it("prévoit 632,74 $ au plus par défaut sous un plafond de 650 $ : 150 recherches/jour, courbe, 9 000 relevés de comptes/jour, réseaux, Instagram, transcriptions, pubs, et 2 $ d'analyse IA", () => {
    expect(d.capUsd).toBe(650);
    expect(plannedUsd(d)).toBeCloseTo((150 * 30 + 100 * 3 * 30 + 9_000 * 30 + 40_000 + 300 * 30 + 50 * 30 + 1_500) * SC_PRICE_PER_CREDIT + 2, 6);
    expect(plannedUsd(d)).toBeCloseTo(632.74, 2);
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
    expect(m.capUsd).toBe(650);
    // La découverte passe à 150 recherches/jour (v9) : la niche, l'argent et les produits web chaque jour, les autres en rotation.
    expect(m.postes.find((p) => p.key === "search")).toEqual({ key: "search", qty: 150, on: true });
    expect(m.postes.find((p) => p.key === "curve")).toEqual({ key: "curve", qty: 100, on: true });
    // 9 000 relevés/jour et 40 000 crédits de recherche des réseaux par mois depuis la v8 (13/11/2026).
    expect(m.postes.find((p) => p.key === "tiktok")).toEqual({ key: "tiktok", qty: 9_000, on: true });
    expect(m.postes.find((p) => p.key === "network")).toEqual({ key: "network", qty: 40_000, on: true });
    // Instagram, transcriptions et pubs, éteints tant qu'ils n'étaient pas branchés, s'allument.
    expect(m.postes.find((p) => p.key === "insta")).toEqual({ key: "insta", qty: 300, on: true });
    expect(m.postes.find((p) => p.key === "transcript")).toEqual({ key: "transcript", qty: 50, on: true });
    expect(m.postes.find((p) => p.key === "ads")).toEqual({ key: "ads", qty: 1_500, on: true });
    expect(m.cutOrder).toEqual(["search", "transcript", "curve", "insta", "ai", "tiktok", "ads", "network"]);
    // Une v2 (réglée après #454) passe aussi au cran au-dessus.
    const v2 = normalizeBudget({ ...v1, budgetVersion: 2, postes: [...v1.postes, { key: "network", qty: 900, on: true }] });
    expect([v2.capUsd, v2.postes.find((p) => p.key === "network")?.qty]).toEqual([650, 40_000]);
    // Une v4 garde son plafond ; ses relevés et ses réseaux passent au cran de la v8, comme ceux d'une v7.
    const v3 = normalizeBudget({ ...v1, capUsd: 150, budgetVersion: 4, postes: [...v1.postes, { key: "network", qty: 900, on: true }] });
    expect(v3.capUsd).toBe(150);
    expect(v3.postes.find((p) => p.key === "tiktok")).toEqual({ key: "tiktok", qty: 9_000, on: true });
    expect(v3.postes.find((p) => p.key === "network")).toEqual({ key: "network", qty: 40_000, on: true });
    const v7 = normalizeBudget({ ...v1, capUsd: 150, budgetVersion: 7, postes: [{ key: "tiktok", qty: 200, on: false }, { key: "insta", qty: 80, on: true }] });
    expect(v7.postes.find((p) => p.key === "tiktok")).toEqual({ key: "tiktok", qty: 9_000, on: true });
    expect(v7.postes.find((p) => p.key === "insta")).toEqual({ key: "insta", qty: 80, on: true });
    // Réglés en v8, ils sont respectés.
    const v8 = normalizeBudget({ ...v1, budgetVersion: 8, postes: [{ key: "tiktok", qty: 3_000, on: true }, { key: "network", qty: 900, on: false }] });
    expect(v8.postes.find((p) => p.key === "tiktok")).toEqual({ key: "tiktok", qty: 3_000, on: true });
    expect(v8.postes.find((p) => p.key === "network")).toEqual({ key: "network", qty: 900, on: false });
  });

  it("d'une v4, l'analyse IA (pas encore branchée) prend son défaut ; borne les quantités, complète l'ordre de coupure", () => {
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
    expect(b.capUsd).toBe(650);
    expect(b.postes.find((p) => p.key === "ai")).toEqual({ key: "ai", qty: 2, on: true });
    expect(b.postes.find((p) => p.key === "tiktok")?.on).toBe(true);
    // D'une v4, la découverte prend aussi son défaut (150/jour) ; en v9, une quantité réglée est bornée.
    expect(b.postes.find((p) => p.key === "search")).toEqual({ key: "search", qty: 150, on: true });
    const search = (qty: number, budgetVersion: number) => normalizeBudget({ postes: [{ key: "search", qty, on: true }], budgetVersion }).postes.find((p) => p.key === "search");
    expect(search(1_000, 9)).toEqual({ key: "search", qty: 300, on: true });
    // Réglée avant la v9 (20/jour en v6, 40 en v7) : elle passe à 150 ; une quantité réglée en v9 est gardée.
    expect(search(20, 6)).toEqual({ key: "search", qty: 150, on: true });
    expect(search(40, 7)).toEqual({ key: "search", qty: 150, on: true });
    expect(search(40, 9)).toEqual({ key: "search", qty: 40, on: true });
    expect(b.postes.find((p) => p.key === "curve")).toEqual({ key: "curve", qty: 88, on: false });
    expect(b.cutOrder).toEqual(["curve", "ai", "search", "transcript", "ads", "insta", "network", "tiktok"]);
    expect(b.alert80).toBe(false);
    // En v5, l'analyse IA réglée est respectée, et le plafond d'une v4 est gardé.
    const v5 = normalizeBudget({ capUsd: 150, postes: [{ key: "ai", qty: 5, on: false }], cutOrder: [], alert80: true, budgetVersion: 6 });
    expect([v5.capUsd, v5.postes.find((p) => p.key === "ai")]).toEqual([150, { key: "ai", qty: 5, on: false }]);
  });

  it("l'analyse IA se paie en dollars : comptée dans la dépense et le plafond, bornée par son enveloppe, coupée la première", () => {
    const s = budgetState(d, [usage("tiktok", 1_000), { poste: "ai", credits: 0, usd: 0.5 }]);
    expect(s.byPoste.ai.usd).toBe(0.5);
    expect(s.spentCredits).toBe(1_000);
    expect(s.spentUsd).toBeCloseTo(1_000 * SC_PRICE_PER_CREDIT + 0.5, 6);
    expect(allowanceUsd(d, s, "ai")).toBeCloseTo(1.5, 6);
    // Enveloppe mangée : rien.
    expect(allowanceUsd(d, budgetState(d, [{ poste: "ai", credits: 0, usd: 2 }]), "ai")).toBe(0);
    // Éteinte : rien. Un poste en crédits n'a pas d'allocation en dollars.
    const off = { ...d, postes: d.postes.map((p) => (p.key === "ai" ? { ...p, on: false } : p)) };
    expect(allowanceUsd(off, budgetState(off, []), "ai")).toBe(0);
    expect(allowanceUsd(d, budgetState(d, []), "search")).toBe(0);
    // Entre 80 et 100 % avec une projection qui dépasse : l'IA saute la première.
    const serre = { ...d, capUsd: 200 };
    const st = budgetState(serre, [usage("tiktok", 90_000, "2026-11-05")]);
    expect(st.cut[0]).toBe("ai");
    expect(allowanceUsd(serre, st, "ai")).toBe(0);
  });

  it("le solde réel borne chaque poste : sous la réserve, plus rien ne part, et une sonde relit le solde (14/11/2026)", () => {
    const now = 1_794_000_000_000;
    const lu = (remaining: number, age = 0) => ({ remaining, seenAt: now - age, now });
    // Jamais lu : seul le budget compte (dev, e2e, premier passage).
    const libre = budgetState(d, [], null);
    expect([libre.balanceLeft, libre.reserveReached, libre.balanceStale]).toEqual([null, false, false]);
    expect(allowance(d, libre, "tiktok", 0, 24)).toBe(375);
    // 7 784 en compte (le 13/11/2026) : la part d'un passage tient, le réseau est borné par le solde moins la réserve.
    const s = budgetState(d, [], lu(7_784));
    expect(s.balanceLeft).toBe(7_784 - CREDIT_RESERVE);
    expect(allowance(d, s, "tiktok", 0, 24)).toBe(375);
    expect(allowance(d, s, "network", 0, 1)).toBe(1_333);
    expect(allowance(d, budgetState(d, [], lu(CREDIT_RESERVE + 200)), "network", 0, 1)).toBe(200);
    // Sous la réserve : rien, tous postes confondus (la paie peut partager la clé).
    const bas = budgetState(d, [], lu(CREDIT_RESERVE - 1));
    expect([bas.balanceLeft, bas.reserveReached, bas.balanceStale]).toEqual([0, true, false]);
    for (const k of ["search", "curve", "tiktok", "network", "insta", "transcript", "ads"] as const) expect(allowance(d, bas, k, 0, 1)).toBe(0);
    // La sonde (un appel d'un crédit de la tâche des relevés, hors postes) : sous la réserve, solde lu il y a 50 min
    // ou plus — moins que la période de la tâche (1 h), sinon elle en sauterait une sur deux.
    expect(BALANCE_PROBE_MS).toBeLessThan(60 * 60_000);
    const vieux = budgetState(d, [], lu(CREDIT_RESERVE - 1, BALANCE_PROBE_MS));
    expect([vieux.balanceStale, needsBalanceProbe(vieux)]).toEqual([true, true]);
    expect(allowance(d, vieux, "tiktok", 0, 24)).toBe(0);
    expect(needsBalanceProbe(budgetState(d, [], lu(CREDIT_RESERVE - 1, BALANCE_PROBE_MS - 1)))).toBe(false);
    // Au-dessus de la réserve, ou solde jamais lu : pas de sonde.
    expect(needsBalanceProbe(budgetState(d, [], lu(CREDIT_RESERVE + 1, 10 * BALANCE_PROBE_MS)))).toBe(false);
    expect(needsBalanceProbe(libre)).toBe(false);
    // Le poste des relevés éteint ne bloque pas la sonde : elle ne passe pas par ses réglages.
    const off = { ...d, postes: d.postes.map((p) => (p.key === "tiktok" ? { ...p, on: false } : p)) };
    expect(needsBalanceProbe(budgetState(off, [], lu(CREDIT_RESERVE - 1, BALANCE_PROBE_MS)))).toBe(true);
  });

  it("combien de jours avant l'arrêt à la réserve, et quelle alerte envoyer (une par jour et par genre)", () => {
    const jour = (day: string, credits: number) => ({ poste: "tiktok", credits, day });
    const usage = [jour("2026-11-11", 1_500), jour("2026-11-12", 1_400), jour("2026-11-13", 5_500), { poste: "network", credits: 100, day: "2026-11-13" }, jour("2026-11-14", 900)];
    const parJour = (1_500 + 1_400 + 5_600) / 3;
    // Les 3 derniers jours COMPLETS (aujourd'hui exclu).
    expect(daysOfCredits(8_500, usage, "2026-11-14")).toBeCloseTo(8_500 / parJour, 6);
    expect(daysOfCredits(8_500, [jour("2026-11-14", 900)], "2026-11-14")).toBeNull();
    expect(daysOfCredits(8_500, [jour("2026-11-13", 0)], "2026-11-14")).toBeNull();
    const etat = (remaining: number | null) => budgetState(d, [], remaining === null ? null : { remaining, seenAt: 0, now: 0 });
    // Le temps compté est celui AVANT L'ARRÊT : le solde au-dessus de la réserve. 9 000 en compte = 7 500 utilisables,
    // 2,6 jours au rythme de 2 833/jour : « low », même si le solde brut tiendrait 3,2 jours.
    expect(creditAlert(etat(20_000), usage, "2026-11-14", {})).toBeNull();
    expect(creditAlert(etat(9_000), usage, "2026-11-14", {})).toEqual({ kind: "low", days: (9_000 - CREDIT_RESERVE) / parJour });
    expect(creditAlert(etat(9_000), usage, "2026-11-14", { low: "2026-11-14" })).toBeNull();
    expect(creditAlert(etat(9_000), usage, "2026-11-15", { low: "2026-11-14" })?.kind).toBe("low");
    // Réserve atteinte : « reserve » (même quand « low » est déjà parti), une fois par jour.
    expect(creditAlert(etat(CREDIT_RESERVE), usage, "2026-11-14", { low: "2026-11-14" })).toEqual({ kind: "reserve", days: null });
    expect(creditAlert(etat(CREDIT_RESERVE), usage, "2026-11-14", { reserve: "2026-11-14" })).toBeNull();
    // Solde jamais lu : aucune alerte (absent n'est pas nul).
    expect(creditAlert(etat(null), usage, "2026-11-14", {})).toBeNull();
  });

  it("les paliers du solde (14/11) : rien ne change au-delà de 2 jours ; ensuite on REPORTE, les comptes suivis jamais", () => {
    expect([ECONOMY_DAYS, SURVIVAL_DAYS]).toEqual([2, 1]);
    // 2 000 crédits par jour : 4 000 au-dessus de la réserve = 2 jours pile, normal ; un crédit de moins, économie.
    expect(creditTier(4_000, 2_000)).toEqual({ tier: "normal", daysLeft: 2 });
    expect(creditTier(3_999, 2_000).tier).toBe("economie");
    expect(creditTier(2_000, 2_000).tier).toBe("economie");
    expect(creditTier(1_999, 2_000).tier).toBe("survie");
    expect(creditTier(0, 2_000)).toEqual({ tier: "reserve", daysLeft: 0 });
    // Rythme ou solde inconnus : rien ne change (absent n'est pas nul).
    expect(creditTier(10, null).tier).toBe("normal");
    expect(creditTier(null, 2_000).tier).toBe("normal");
    // Le rythme : les 3 derniers jours complets, aujourd'hui exclu.
    const jour = (day: string, credits: number) => ({ poste: "tiktok", credits, day });
    expect(recentPerDay([jour("2026-11-11", 1_000), jour("2026-11-12", 2_000), jour("2026-11-13", 3_000), jour("2026-11-14", 9_999)], "2026-11-14")).toBe(2_000);
    // L'état du budget coupe découverte, transcriptions et pubs en économie et en survie ; rien d'autre.
    const lu = (remaining: number) => ({ remaining, seenAt: 0, now: 0, perDay: 2_000 });
    expect(budgetState(d, [], lu(CREDIT_RESERVE + 10_000)).cut).toEqual([]);
    const eco = budgetState(d, [], lu(CREDIT_RESERVE + 3_000));
    expect([eco.tier, [...eco.cut].sort()]).toEqual(["economie", ["ads", "search", "transcript"]]);
    for (const k of ["tiktok", "network", "insta", "curve"] as const) expect(eco.cut).not.toContain(k);
    expect(allowance(d, eco, "search", 0, 4)).toBe(0);
    expect(allowance(d, eco, "tiktok", 0, 24)).toBeGreaterThan(0);
    expect(budgetState(d, [], lu(CREDIT_RESERVE + 1_000)).tier).toBe("survie");
    // Ce que chaque palier reporte en plus, hors postes.
    expect(tierDefers("normal")).toEqual({ deep: false, routine: false, firstReads: false });
    expect(tierDefers("economie")).toEqual({ deep: true, routine: false, firstReads: false });
    expect(tierDefers("survie")).toEqual({ deep: true, routine: true, firstReads: true });
    expect(tierDefers("reserve")).toEqual({ deep: false, routine: false, firstReads: false });
  });

  it("l'alerte d'un palier part une fois par jour, même si « moins de 3 jours » est déjà parti", () => {
    const jour = (day: string, credits: number) => ({ poste: "tiktok", credits, day });
    const usage = [jour("2026-11-11", 2_000), jour("2026-11-12", 2_000), jour("2026-11-13", 2_000)];
    const etat = (remaining: number) => budgetState(d, [], { remaining, seenAt: 0, now: 0 });
    expect(creditAlert(etat(CREDIT_RESERVE + 5_000), usage, "2026-11-14", {})?.kind).toBe("low");
    expect(creditAlert(etat(CREDIT_RESERVE + 3_000), usage, "2026-11-14", { low: "2026-11-14" })?.kind).toBe("economie");
    expect(creditAlert(etat(CREDIT_RESERVE + 3_000), usage, "2026-11-14", { low: "2026-11-14", economie: "2026-11-14" })).toBeNull();
    expect(creditAlert(etat(CREDIT_RESERVE + 1_000), usage, "2026-11-14", { low: "2026-11-14", economie: "2026-11-14" })?.kind).toBe("survie");
  });

  it("donne à un passage sa part du jour, bornée par ce qui reste aujourd'hui", () => {
    const s = budgetState(d, []);
    // 150 recherches/jour en 4 passages : 38 par passage, bornées par le reste du jour.
    expect(allowance(d, s, "search", 0, 4)).toBe(38);
    expect(allowance(d, s, "search", 130, 4)).toBe(20);
    expect(allowance(d, s, "search", 150, 4)).toBe(0);
    // 100 vidéos × 3 relevés = 300/jour → 13 par heure ; 9 000 relevés de comptes → 375 par heure.
    expect(allowance(d, s, "curve", 0, 24)).toBe(13);
    expect(allowance(d, s, "tiktok", 0, 24)).toBe(375);
    // Poste payé en dollars (l'analyse IA) : pas de crédits.
    expect(allowance(d, s, "ai", 0, 1)).toBe(0);
  });

  /** Le budget de la phase 1 : recherche (60/jour) et courbe (100/jour) seules. */
  const p1 = (cap: number) => ({
    ...d,
    capUsd: cap,
    postes: d.postes.map((p) =>
      p.key === "curve" ? { ...p, qty: 100 } : p.key === "search" ? { ...p, qty: 60 } : ["tiktok", "network", "insta", "transcript", "ads", "ai"].includes(p.key) ? { ...p, on: false } : p,
    ),
  });

  it("au plafond, tout s'arrête", () => {
    const b = { ...d, capUsd: 20 };
    // 10 640 crédits = 20,0032 $ (10 638 ne font que 19,9994 $).
    const s = budgetState(b, [usage("curve", 10_640, "2026-11-03")]);
    expect(s.capReached).toBe(true);
    expect(s.cut).toEqual(["search", "curve", "tiktok", "network", "insta", "transcript", "ads", "ai"]);
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
  multiplier: extra.multiplier ?? null,
  ...(extra.themes ? { themes: extra.themes } : {}),
});

const NEWLY = "Si quieres hacer tu propio aplicación utiliza newly#españa🇪🇸 #parati #trucostiktok #dinero #ganadinero ";

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
  // Légende réelle (relevée le 12/11/2026) : #dinero #ganadinero, thème « argent » par la vraie règle.
  sig("alex.maneja23", 2_445, 49_713, 116, "es-es", { caption: NEWLY, themes: signalThemes([], NEWLY) }),
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

  it("le thème « argent » : un filtre comme les autres, dans l'adresse et en vue enregistrée (12/11/2026)", () => {
    const f = toggle(defaultFilters(), "theme", "argent");
    expect(applyFilters(DATA, f, NOW).map((s) => s.handle)).toEqual(["alex.maneja23"]);
    expect(opt(defaultFilters(), "theme", "argent")).toMatchObject({ count: 1, disabled: false });
    expect(chips(f)).toEqual([{ kind: "group", key: "theme", value: "argent" }]);
    expect(toSearchParams(f).toString()).toBe("th=argent");
    expect(fromSearchParams(new URLSearchParams("th=argent,inconnu")).sel.theme).toEqual(["argent"]);
    const vue = PRESETS.find((p) => p.id === "argent")!.patch({ ...defaultFilters(), age: "90" });
    expect(sameFilters(vue, f)).toBe(true);
    // Combiné à une langue : ET entre groupes.
    expect(count(toggle(f, "langue", "fr"))).toBe(0);
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
    // Tri inconnu : le défaut, vues ÷ médiane du compte.
    expect(old.sort).toBe("mediane");
  });
});

describe("tri par défaut : vues ÷ médiane du compte", () => {
  it("les vidéos de comptes suivis d'abord, par fois-la-médiane ; les autres ensuite, par vues ÷ abonnés", () => {
    // Réels du 07/11/2026 : 417× (Snitchy), 257× (RecentFollow) ; et deux vidéos de la découverte sans médiane.
    const data = [
      sig("decouverte_forte", 10, 200_000, 20, "en"),
      sig("leoniesophie.secrets", 1_000, 606_722, 30, "autre", { multiplier: 417.3 }),
      sig("decouverte_faible", 5_000, 60_000, 20, "en"),
      sig("mari279785", 2_000, 655_980, 40, "es-am", { multiplier: 256.6 }),
    ];
    expect(defaultFilters().sort).toBe("mediane");
    expect(applyFilters(data, defaultFilters(), NOW).map((s) => s.handle)).toEqual(["leoniesophie.secrets", "mari279785", "decouverte_forte", "decouverte_faible"]);
    // L'ancien ordre reste un clic plus loin.
    expect(applyFilters(data, { ...defaultFilters(), sort: "ratio" }, NOW)[0].handle).toBe("decouverte_forte");
  });
});

describe("produits web (lot 5 du dig, 14/11/2026)", () => {
  it("« ce site » et la pub déclarée dans chaque langue, 4 marchés de plus ; chaque tournure unique et pas déjà ailleurs", () => {
    const label = (x: { query: string; region: string }) => `${x.query}·${x.region}`;
    expect(new Set(WEB_QUERIES.map(label)).size).toBe(WEB_QUERIES.length);
    const ailleurs = new Set([...DISCOVERY_QUERIES, ...MONEY_QUERIES].map(label));
    expect(WEB_QUERIES.filter((x) => ailleurs.has(label(x)))).toEqual([]);
    expect([...new Set(WEB_QUERIES.map((x) => x.region))].sort()).toEqual(["BR", "DE", "ES", "FR", "IT", "MX", "NL", "PL", "US"]);
    expect(isWebFind("diese seite·de")).toBe(true);
    expect(isWebFind("ce site·fr")).toBe(true);
    expect(isWebFind("cette app·fr")).toBe(false);
  });

  it("les hashtags qui pourraient nommer un produit : ni mise en avant, ni pub déclarée, ni le mot du sujet", () => {
    expect(productHashtags("diese seite ist so crazy 🫡😱 #jobstep #ki #lebenslauf #bewerbungen #viral")).toEqual(["jobstep", "lebenslauf", "bewerbungen"]);
    expect(productHashtags("5€ pour 4 burgers ? 🤔 #pimzi #courses #pascher #Économies #fyp #pourtoi")).toEqual(["pimzi", "courses", "pascher", "economies"]);
    expect(productHashtags("Anzeige | nicht schlecht #anzeige #ad #werbung #2026 #app #website")).toEqual([]);
    expect(productHashtags("trop court #cv #ia, trop long #" + "a".repeat(31))).toEqual([]);
    expect(hashtagCandidates("#pimzi #pimzi")).toEqual([{ key: "#pimzi", kind: "hashtag", label: "pimzi" }]);
  });
});

