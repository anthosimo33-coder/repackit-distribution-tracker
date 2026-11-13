import { describe, expect, it } from "vitest";
import {
  STORE_COUNTRIES,
  STORE_FEEDS,
  STORE_MAX_TAG_VIDEOS,
  STORE_MIN_CREATORS,
  STORE_PROFILES_PER_TAG,
  alreadyFollowed,
  checkStoreApp,
  citesStoreApp,
  fetchEmbedPage,
  profileEmbedUrl,
  runStoreQueue,
  tagEmbedUrl,
  type PageFetch,
  type TagVerdict,
  creatorEvidence,
  cutJson,
  feedsForRun,
  firstCheckAt,
  handleCarries,
  isBrandAccount,
  isRecentRelease,
  nextCheckAfter,
  parseProfileEmbed,
  parseStoreFeed,
  parseTagEmbed,
  profilesToRead,
  storeBrand,
  storeFeedUrl,
  storeTags,
  storeVerdict,
  tagCore,
  tagVerdict,
  type AuthorProfile,
  type Read,
  type TagPage,
} from "../convex/radarStoreMath";

/**
 * Radar — les apps des classements (12/11/2026). Les noms, pseudos et bios ci-dessous sont ceux lus ce jour-là
 * sur les classements App Store et les pages publiques de TikTok, pendant la mesure sur 900 apps.
 */
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 12, 0);
const profil = (o: Partial<AuthorProfile> = {}): AuthorProfile => ({ fans: 200, bio: "", verified: false, descs: [], ...o });
const page = (videos: number, auteurs: string[], views = 1_000_000): TagPage => ({ videos, views, items: auteurs.map((author) => ({ author, desc: "" })) });

describe("Radar — classements App Store : les listes", () => {
  it("six pays (France et États-Unis en tête, comme avant le 13/11/2026), gratuites et plus rentables, 22 genres : 264 listes", () => {
    expect(STORE_FEEDS).toHaveLength(264);
    // Les 88 premières listes n'ont pas bougé : le curseur déjà avancé en prod garde son sens.
    expect(STORE_COUNTRIES).toEqual(["fr", "us", "gb", "es", "mx", "br"]);
    expect(new Set(STORE_FEEDS.slice(0, 88).map((f) => f.country))).toEqual(new Set(["fr", "us"]));
    expect(storeFeedUrl(STORE_FEEDS[88])).toBe("https://itunes.apple.com/gb/rss/topfreeapplications/limit=200/json");
    expect(storeFeedUrl({ country: "fr", list: "topfreeapplications", genre: "6017" })).toBe("https://itunes.apple.com/fr/rss/topfreeapplications/limit=200/genre=6017/json");
    // Sans genre : le classement général.
    expect(storeFeedUrl({ country: "us", list: "topgrossingapplications", genre: "" })).toBe("https://itunes.apple.com/us/rss/topgrossingapplications/limit=200/json");
  });

  it("un passage lit 30 listes à partir du curseur, et reprend au début après la dernière", () => {
    const a = feedsForRun(0);
    expect(a.feeds).toHaveLength(30);
    expect(a.feeds[0]).toEqual(STORE_FEEDS[0]);
    expect(a.next).toBe(30);
    const fin = feedsForRun(260);
    expect(fin.feeds.map((f) => STORE_FEEDS.indexOf(f)).slice(0, 6)).toEqual([260, 261, 262, 263, 0, 1]);
    expect(fin.next).toBe(26);
    // Le curseur de la prod au 13/11/2026 (60, sur 88 listes alors) continue où il en était.
    expect(feedsForRun(60).feeds[0]).toEqual(STORE_FEEDS[60]);
    // Un curseur hors bornes (une liste retirée du code depuis) ne casse rien.
    expect(feedsForRun(1_000).feeds).toHaveLength(30);
    expect(feedsForRun(3, 2, STORE_FEEDS.slice(0, 4))).toEqual({ feeds: [STORE_FEEDS[3], STORE_FEEDS[0]], next: 1 });
  });

  it("une liste rend ses apps : identifiant, nom, éditeur, genre, date de sortie", () => {
    const entree = (id: string, nom: string, editeur: string) => ({
      "im:name": { label: nom },
      "im:artist": { label: editeur },
      id: { attributes: { "im:id": id, "im:bundleId": "x.y" } },
      category: { attributes: { label: "Éducation" } },
      "im:releaseDate": { label: "2025-08-14T00:00:00-07:00" },
    });
    expect(parseStoreFeed({ feed: { entry: [entree("6749000111", "Drawly: dessiner sur ipad", "Drawly Ltd"), entree("abc", "Sans identifiant", "x"), entree("12", "  ", "x")] } })).toEqual([
      { storeId: "6749000111", name: "Drawly: dessiner sur ipad", artist: "Drawly Ltd", genre: "Éducation", released: "2025-08-14" },
    ]);
    // Une liste d'une seule app arrive sans tableau ; une liste vide, sans rien.
    expect(parseStoreFeed({ feed: { entry: entree("1", "Seule", "x") } })).toHaveLength(1);
    expect(parseStoreFeed({ feed: {} })).toEqual([]);
    expect(parseStoreFeed(null)).toEqual([]);
  });
});

describe("Radar — classements App Store : du nom au hashtag", () => {
  it("la marque est le nom sans son slogan", () => {
    expect(storeBrand("Drawly: dessiner sur ipad")).toBe("Drawly");
    expect(storeBrand("Love8 - App für Paare")).toBe("Love8");
    expect(storeBrand("Hush : Chat & Confidences")).toBe("Hush");
    expect(storeBrand("Champi · Carte Champignons")).toBe("Champi");
    expect(storeBrand("Ride_IQ")).toBe("Ride_IQ");
  });

  it("deux hashtags par app : la marque, et la marque suivie de « app »", () => {
    expect(storeTags("Drawly: dessiner sur ipad", "Drawly Ltd")).toEqual(["drawly", "drawlyapp"]);
    expect(storeTags("Alta Daily: Digital AI Closet", "Alta")).toEqual(["altadaily", "altadailyapp"]);
    expect(storeTags("Créateur Musique IA - Mozart", "NineG")).toEqual(["createurmusiqueia", "createurmusiqueiaapp", "nineg"]);
    // Déjà « app » à la fin : pas de « rizzappapp ».
    expect(storeTags("Rizz App", "x")).toEqual(["rizzapp"]);
  });

  it("un nom qui est une phrase : on lit le hashtag de l'éditeur, sans sa forme de société", () => {
    expect(storeTags("Hearing Aid Pro 3 for AirPods", "Sule Demir")).toEqual(["suledemir"]);
    expect(storeTags("Expedite for Drivers", "Dlivrd, LLC")).toEqual(["expeditefordrivers", "expeditefordriversapp", "dlivrd"]);
    // Ni marque lisible ni éditeur utilisable : rien à lire.
    expect(storeTags("AI", "Workflow Agency Holding International, LLC")).toEqual([]);
  });

  it("le nom de l'app dans un hashtag : « livenapp » → « liven »", () => {
    expect(tagCore("livenapp")).toBe("liven");
    expect(tagCore("drawly")).toBe("drawly");
    // Trop court pour être une marque suivie de « app ».
    expect(tagCore("snapp")).toBe("snapp");
  });
});

describe("Radar — classements App Store : les pages publiques de TikTok", () => {
  const html = (data: string) => `<html><script id="__FRONTITY_CONNECT_STATE__">{"source":{"data":{"/embed/tag/x":{${data}}}}}</script></html>`;

  it("la page d'un hashtag : ses compteurs et les auteurs de ses vidéos", () => {
    const p = parseTagEmbed(
      html(
        `"videoList":[{"id":"1","desc":"Mon dessin {du jour} \\"cool\\" #drawly","authorUniqueId":"kate.drawly3","playCount":120},{"id":"2","desc":"","authorUniqueId":""},{"id":"3","desc":"x","authorUniqueId":"emily.drawly"}],"isError":false,"embedInfo":{"viewCount":"192576472","videoCount":"12776","code":200}`,
      ),
    );
    expect(p).toEqual({ videos: 12_776, views: 192_576_472, items: [{ author: "kate.drawly3", desc: 'Mon dessin {du jour} "cool" #drawly' }, { author: "emily.drawly", desc: "x" }] });
  });

  it("une page servie sans ses données n'est pas une page vide : `null`", () => {
    expect(parseTagEmbed("<html>Please wait...</html>")).toBeNull();
    // Un hashtag qui existe sans vidéo, lui, se lit.
    expect(parseTagEmbed(html(`"videoList":[],"embedInfo":{"viewCount":"0","videoCount":"0"}`))).toEqual({ videos: 0, views: 0, items: [] });
  });

  it("le profil d'un auteur : abonnés, bio, dernières légendes", () => {
    const p = parseProfileEmbed(html(`"videoList":[{"desc":"Growth everyday #livenapp"},{"desc":"#fyp"}],"userInfo":{"followerCount":689,"signature":"Liven App Content Ambassador","verified":false}`));
    expect(p).toEqual({ fans: 689, bio: "Liven App Content Ambassador", verified: false, descs: ["Growth everyday #livenapp", "#fyp"] });
    // Un compte privé n'a pas de liste de vidéos.
    expect(parseProfileEmbed(html(`"userInfo":{"followerCount":3}`))).toBeNull();
  });

  it("la valeur qui suit une clé : un objet ou un tableau entier, sinon rien", () => {
    expect(cutJson('{"a":{"b":[1,{"c":"}"}]},"d":2}', '"a":')).toEqual({ b: [1, { c: "}" }] });
    expect(cutJson('{"a":null}', '"a":')).toBeUndefined();
    expect(cutJson('{"a":[1,2', '"a":')).toBeUndefined();
    expect(cutJson("{}", '"a":')).toBeUndefined();
  });
});

describe("Radar — classements App Store : un auteur est-il un compte créateur de l'app ?", () => {
  it("son pseudo porte l'app comme un mot, avec autre chose à côté", () => {
    for (const [h, app] of [["kate.drawly3", "drawly"], ["laure_love8", "love8"], ["crush_tracker_liv", "crushtracker"], ["ola.airbuds", "airbuds"], ["mewen.clutch", "clutch"]] as const) {
      expect(handleCarries(h, app), h).toBe(true);
    }
    // Noyé dans un autre mot, ou seul (c'est alors le compte de la marque), ou trop court.
    for (const [h, app] of [["frenzywaterpark", "frenzy"], ["theparrotlady", "parrot"], ["pocketfmdrama", "pocketfm"], ["drawly", "drawly"], ["ana.flo", "flo"]] as const) {
      expect(handleCarries(h, app), h).toBe(false);
    }
  });

  it("le compte de la marque n'est pas un compte créateur", () => {
    expect(isBrandAccount("getwyndy", "wyndy", false)).toBe(true);
    expect(isBrandAccount("rapfame_app", "rapfame", false)).toBe(true);
    expect(isBrandAccount("drawly.official", "drawly", false)).toBe(true);
    expect(isBrandAccount("kate.drawly3", "drawly", false)).toBe(false);
    // Certifié : une marque ou une célébrité, jamais une ambassadrice.
    expect(isBrandAccount("kate.drawly3", "drawly", true)).toBe(true);
    expect(creatorEvidence("getwyndy", "wyndy", profil({ bio: "Wyndy app" }))).toBeNull();
  });

  it("le texte nomme l'app : le mot entier, suivi ou non de « app »", () => {
    expect(citesStoreApp("Growth everyday #livenapp #fyp", "liven")).toBe(true);
    expect(citesStoreApp("télécharge Bibly gratuitement ici", "bibly")).toBe(true);
    expect(citesStoreApp("L'app c'est Clutch.", "clutch")).toBe(true);
    // « flo » n'est pas dans « flower », « liven » pas dans « enliven ».
    expect(citesStoreApp("my flower garden", "flo")).toBe(false);
    expect(citesStoreApp("enlivening day", "liven")).toBe(false);
    // Un nom long écrit en plusieurs mots.
    expect(citesStoreApp("I use Alta Daily every morning", "altadaily")).toBe(true);
    expect(citesStoreApp("my bib ly", "bibly")).toBe(false);
  });

  it("sa bio la nomme AVEC un mot d'app (ambassadrice, app, télécharge…) ou mentionne son compte", () => {
    // Liven, Bibly, Stompers, Gauth : bios lues le 12/11/2026.
    expect(creatorEvidence("kate.wellbeing", "liven", profil({ bio: "your wellness bestie 🐒 Liven app ambassador @kateuk_ugc" }))).toBe("bio");
    expect(creatorEvidence("lucille_255", "bibly", profil({ bio: "nous disons tous ˗ˋˏ Amen ˎˊ˗ télécharge Bibly gratuitement ici" }))).toBe("bio");
    expect(creatorEvidence("chanwalks", "stompers", profil({ bio: "Stompers Ambassador   :D" }))).toBe("bio");
    expect(creatorEvidence("studywithrishab", "gauth", profil({ bio: "study with me and @Gauth 📝" }))).toBe("bio");
    // Le mot seul ne prouve rien : une voiture, un perroquet.
    expect(creatorEvidence("juskess", "roomster", profil({ bio: "Owner of the glorious skoda roomster" }))).toBeNull();
    expect(creatorEvidence("birdmom", "parrot", profil({ bio: "Parrot mom of 3 🦜" }))).toBeNull();
  });

  it("ou la moitié de ses vidéos, et au moins 5, la citent", () => {
    const descs = (n: number, total: number) => Array.from({ length: total }, (_, i) => (i < n ? "new sketch #drawly" : "#fyp"));
    expect(creatorEvidence("cute_artcat", "drawly", profil({ descs: descs(13, 13) }))).toBe("half");
    expect(creatorEvidence("cute_artcat", "drawly", profil({ descs: descs(5, 10) }))).toBe("half");
    expect(creatorEvidence("cute_artcat", "drawly", profil({ descs: descs(4, 4) }))).toBeNull();
    expect(creatorEvidence("cute_artcat", "drawly", profil({ descs: descs(5, 11) }))).toBeNull();
  });

  it("sans profil lu, seul le pseudo peut prouver", () => {
    expect(creatorEvidence("kate.drawly3", "drawly", undefined)).toBe("handle");
    expect(creatorEvidence("cute_artcat", "drawly", null)).toBeNull();
  });
});

describe("Radar — classements App Store : le verdict", () => {
  it("on ne lit les profils que d'un hashtag ni trop petit ni trop gros, et de ses 8 premiers auteurs", () => {
    const dix = Array.from({ length: 10 }, (_, i) => `a${i}`);
    expect(STORE_PROFILES_PER_TAG).toBe(8);
    expect(profilesToRead(page(12_776, dix))).toEqual(dix.slice(0, 8));
    expect(profilesToRead({ videos: 500, views: 1, items: [...dix, ...dix].map((author) => ({ author, desc: "" })) })).toEqual(dix.slice(0, 8));
    expect(profilesToRead(page(19, dix))).toEqual([]);
    expect(profilesToRead(page(STORE_MAX_TAG_VIDEOS + 1, dix))).toEqual([]);
    expect(profilesToRead(page(500, ["a", "b"]))).toEqual([]);
  });

  it("Drawly : sept comptes sur sept sont des comptes créateurs → un réseau", () => {
    const auteurs = ["cute_artcat", "the.art.flow_", "tinyfox501", "kate.drawly3"];
    const profils = new Map<string, AuthorProfile | null>([
      ["cute_artcat", profil({ descs: Array.from({ length: 13 }, () => "#drawly") })],
      ["the.art.flow_", profil({ bio: "Digital art made with love", descs: Array.from({ length: 13 }, () => "made with #drawly") })],
      ["tinyfox501", profil({ bio: "iPad doodles — get the Drawly app" })],
    ]);
    const v = tagVerdict("drawly", page(12_776, auteurs), profils);
    expect(v).toEqual({ tag: "drawly", videos: 12_776, views: 1_000_000, creators: [{ handle: "cute_artcat", why: "half" }, { handle: "the.art.flow_", why: "half" }, { handle: "tinyfox501", why: "bio" }, { handle: "kate.drawly3", why: "handle" }] });
    expect(storeVerdict([v])).toEqual({ outcome: "network", best: v });
  });

  it("un hashtag de plus de 100 000 vidéos est un mot courant : aucun compte n'y compte, même au bon pseudo", () => {
    // #parrot : 1 870 255 vidéos.
    const v = tagVerdict("parrot", page(1_870_255, ["aro_parrot", "lola.parrot", "theparrotlady"]), new Map());
    expect(v.creators).toEqual([]);
    expect(storeVerdict([v]).outcome).toBe("none");
  });

  it("il faut deux comptes créateurs ; entre deux hashtags, celui qui en a le plus", () => {
    expect(STORE_MIN_CREATORS).toBe(2);
    const un = tagVerdict("liven", page(25_111, ["kate.liven", "x", "y"]), new Map());
    const deux = tagVerdict("livenapp", page(625, ["kate.liven", "bob_liven", "z"]), new Map());
    expect(un.creators).toHaveLength(1);
    expect(storeVerdict([un]).outcome).toBe("none");
    expect(storeVerdict([un, deux])).toEqual({ outcome: "network", best: deux });
    expect(storeVerdict([])).toEqual({ outcome: "none", best: null });
  });
});

describe("Radar — classements App Store : le contrôle d'une app", () => {
  const lecteurs = (tags: Record<string, Read<TagPage>>, profils: Record<string, Read<AuthorProfile>> = {}, stop = () => false) => {
    const lus = { tags: [] as string[], profils: [] as string[] };
    return {
      lus,
      read: {
        tag: async (t: string) => (lus.tags.push(t), tags[t] ?? "absent"),
        profile: async (h: string) => (lus.profils.push(h), profils[h] ?? "absent"),
        stopped: stop,
      },
    };
  };
  const drawly = { name: "Drawly: dessiner sur ipad", artist: "Drawly Ltd" };

  it("déjà suivie : rien n'est lu", async () => {
    const { lus, read } = lecteurs({});
    expect(await checkStoreApp({ name: "Retain Cards: KI-Karteikarten", artist: "x" }, [{ strong: ["retaincards", "retain.cards"] }], read, new Map())).toEqual({ outcome: "known" });
    expect(lus).toEqual({ tags: [], profils: [] });
    expect(alreadyFollowed(["livenapp"], [{ strong: ["liven"] }])).toBe(true);
    expect(alreadyFollowed(["theick"], [{ strong: ["theick.io", "theickio"] }])).toBe(true);
    expect(alreadyFollowed(["drawly"], [{ strong: ["liven"] }])).toBe(false);
    // L'égalité, pas l'inclusion : « cal » est dans « calai », « e2e » dans tout ce qui commence pareil.
    expect(alreadyFollowed(["cal", "calapp"], [{ strong: ["calai"] }])).toBe(false);
    // Suivie sous son hashtag prouvé (« hushapp ») : « hush » comme « hushapp » la désignent, « hushai » non.
    expect(alreadyFollowed(["hushapp"], [{ strong: ["hushapp"] }])).toBe(true);
    expect(alreadyFollowed(["hush"], [{ strong: ["hushapp"] }])).toBe(true);
    expect(alreadyFollowed(["hushai"], [{ strong: ["hushapp"] }])).toBe(false);
  });

  it("ses deux hashtags sont lus, puis les profils des auteurs — une seule fois chacun", async () => {
    const auteurs = ["kate.drawly3", "cute_artcat", "tinyfox501"];
    const { lus, read } = lecteurs({ drawly: page(12_776, auteurs), drawlyapp: page(31, auteurs) }, { tinyfox501: profil({ bio: "get the Drawly app" }) });
    const cache = new Map<string, AuthorProfile | null>();
    const r = await checkStoreApp(drawly, [], read, cache);
    expect(lus.tags).toEqual(["drawly", "drawlyapp"]);
    expect(lus.profils).toEqual(auteurs);
    expect(r).toMatchObject({ outcome: "network", best: { tag: "drawly", creators: [{ handle: "kate.drawly3", why: "handle" }, { handle: "tinyfox501", why: "bio" }] } });
    // Le profil d'un compte illisible reste « inconnu » : on ne le redemande pas.
    expect(cache.get("cute_artcat")).toBeNull();
  });

  it("aucun hashtag : pas de réseau", async () => {
    const { read } = lecteurs({});
    expect(await checkStoreApp(drawly, [], read, new Map())).toEqual({ outcome: "none", best: null });
  });

  it("une page de hashtag que TikTok ne sert pas : l'app est illisible, on n'en conclut rien", async () => {
    const { lus, read } = lecteurs({ drawly: "suspect" });
    expect(await checkStoreApp(drawly, [], read, new Map())).toEqual({ outcome: "unreadable" });
    expect(lus.tags).toEqual(["drawly"]);
  });

  it("un profil que TikTok ne sert pas : sans lui pas de réseau → l'app est illisible, pas « sans réseau » ; il sera redemandé", async () => {
    const auteurs = ["kate.drawly3", "mia_art", "fan"];
    const cache = new Map<string, AuthorProfile | null>();
    const refuse = lecteurs({ drawly: page(12_776, auteurs) }, { mia_art: "suspect" });
    // Un seul compte prouvé (le pseudo), et un auteur qu'on n'a pas pu lire.
    expect(await checkStoreApp(drawly, [], refuse.read, cache)).toEqual({ outcome: "unreadable" });
    // Le profil refusé n'est pas retenu : le contrôle suivant le redemande, et conclut.
    expect(cache.has("mia_art")).toBe(false);
    const servi = lecteurs({ drawly: page(12_776, auteurs) }, { mia_art: profil({ bio: "get the Drawly app" }) });
    expect(await checkStoreApp(drawly, [], servi.read, cache)).toMatchObject({ outcome: "network", best: { creators: [{ handle: "kate.drawly3" }, { handle: "mia_art" }] } });
    expect(servi.lus.profils).toEqual(["mia_art"]);
    // Quand le réseau est prouvé sans lui, le profil refusé ne change rien.
    const assez = lecteurs({ drawly: page(12_776, ["kate.drawly3", "luna.drawly", "mia_art"]) }, { mia_art: "suspect" });
    expect(await checkStoreApp(drawly, [], assez.read, new Map())).toMatchObject({ outcome: "network" });
  });

  it("le passage s'arrête en cours d'app : rien n'est conclu pour elle", async () => {
    let pages = 0;
    const { lus, read } = lecteurs({ drawly: page(12_776, ["a", "b", "c"]) }, {}, () => pages >= 2);
    const compte = { ...read, tag: async (t: string) => (pages++, read.tag(t)), profile: async (h: string) => (pages++, read.profile(h)) };
    expect(await checkStoreApp(drawly, [], compte, new Map())).toEqual({ outcome: "stopped" });
    // Arrêté à la deuxième page : le hashtag, un profil, et plus rien.
    expect(lus).toEqual({ tags: ["drawly"], profils: ["a"] });
    // Arrêté dès la page du hashtag : aucun profil n'est demandé.
    pages = 0;
    const tot = lecteurs({ drawly: page(12_776, ["a", "b", "c"]) }, {}, () => pages >= 1);
    expect(await checkStoreApp(drawly, [], { ...tot.read, tag: async (t: string) => (pages++, tot.read.tag(t)) }, new Map())).toEqual({ outcome: "stopped" });
    expect(tot.lus).toEqual({ tags: ["drawly"], profils: [] });
  });
});

describe("Radar — classements App Store : un passage du contrôle", () => {
  const tagHtml = (videos: number, auteurs: string[]) =>
    `<script>{"videoList":${JSON.stringify(auteurs.map((a) => ({ authorUniqueId: a, desc: "" })))},"embedInfo":{"viewCount":"${videos * 1_000}","videoCount":"${videos}"}}</script>`;
  const profilHtml = (bio: string) => `<script>{"videoList":[],"userInfo":{"followerCount":120,"signature":${JSON.stringify(bio)}}}</script>`;
  const ok = (text: string): PageFetch => ({ kind: "ok", text });
  const absent: PageFetch = { kind: "absent" };
  const refus = (reason = "HTTP 403"): PageFetch => ({ kind: "suspect", reason });
  /** Un faux TikTok : chaque adresse rend ce qu'on lui a donné, « absent » sinon. Note les pages demandées, les pauses, les écritures. */
  const tiktok = (pagesByUrl: Record<string, PageFetch>) => {
    const journal = { urls: [] as string[], pauses: 0, ecrits: [] as { app: string; outcome: string; best: TagVerdict | null }[] };
    return {
      journal,
      io: {
        page: async (url: string) => (journal.urls.push(url), pagesByUrl[url] ?? absent),
        pause: async () => void journal.pauses++,
        apply: async (app: { name: string }, outcome: string, best: TagVerdict | null) => void journal.ecrits.push({ app: app.name, outcome, best }),
      },
    };
  };
  const app = (nom: string) => ({ name: `${nom}: slogan`, artist: "Inc." });

  it("une app à réseau, une app sans hashtag : chacune est écrite, une pause entre deux pages", async () => {
    const { journal, io } = tiktok({
      [tagEmbedUrl("drawly")]: ok(tagHtml(12_776, ["kate.drawly3", "mia_art", "fan"])),
      [profileEmbedUrl("mia_art")]: ok(profilHtml("get the Drawly app")),
    });
    const run = await runStoreQueue([app("Drawly"), app("Zzzunknown")], [], io);
    expect(journal.urls).toEqual([tagEmbedUrl("drawly"), profileEmbedUrl("kate.drawly3"), profileEmbedUrl("mia_art"), profileEmbedUrl("fan"), tagEmbedUrl("drawlyapp"), tagEmbedUrl("zzzunknown"), tagEmbedUrl("zzzunknownapp")]);
    // Une pause AVANT chaque page sauf la première.
    expect(journal.pauses).toBe(6);
    expect(run).toEqual({ checked: 2, pages: 7, stopped: null });
    expect(journal.ecrits.map((e) => [e.app, e.outcome, e.best?.creators.map((c) => c.handle) ?? null])).toEqual([
      ["Drawly: slogan", "network", ["kate.drawly3", "mia_art"]],
      ["Zzzunknown: slogan", "none", null],
    ]);
  });

  it("on ne commence pas une app qu'on ne pourrait pas finir : le plafond de pages arrête le passage", async () => {
    const { journal, io } = tiktok({});
    // 2 pages par app ici (deux hashtags absents) ; plafond de 5 pages avec une marge de 2 par app.
    const run = await runStoreQueue([app("Aaaa"), app("Bbbb"), app("Cccc"), app("Dddd")], [], io, { pages: 5, perApp: 2, breaker: 5 });
    expect(run).toEqual({ checked: 2, pages: 4, stopped: null });
    expect(journal.ecrits.map((e) => e.app)).toEqual(["Aaaa: slogan", "Bbbb: slogan"]);
  });

  it("cinq pages refusées d'affilée arrêtent le passage, sans rien conclure pour l'app en cours", async () => {
    const { journal, io } = tiktok({});
    const refuse = { ...io, page: async (url: string) => (journal.urls.push(url), refus()) };
    const run = await runStoreQueue(["Aaaa", "Bbbb", "Cccc", "Dddd", "Eeee", "Ffff"].map(app), [], refuse);
    // Chaque app s'arrête à son premier hashtag refusé (« illisible », revue demain) ; la cinquième déclenche l'arrêt.
    expect(run).toEqual({ checked: 4, pages: 5, stopped: "HTTP 403" });
    expect(journal.ecrits.map((e) => e.outcome)).toEqual(["unreadable", "unreadable", "unreadable", "unreadable"]);
  });

  it("une page servie remet le compteur à zéro : des refus épars n'arrêtent rien", async () => {
    const pages: Record<string, PageFetch> = {};
    for (const n of ["aaaa", "cccc", "eeee", "gggg", "iiii", "kkkk"]) pages[tagEmbedUrl(n)] = refus();
    const { io } = tiktok(pages);
    const run = await runStoreQueue(["Aaaa", "Bbbb", "Cccc", "Dddd", "Eeee", "Ffff", "Gggg", "Hhhh", "Iiii", "Jjjj", "Kkkk"].map(app), [], io);
    expect(run.stopped).toBeNull();
    expect(run.checked).toBe(11);
  });

  it("une page de hashtag servie sans ses données compte comme un refus ; un profil vide ou inexistant, non", async () => {
    const vide = tiktok({ [tagEmbedUrl("aaaa")]: ok("<html>Please wait…</html>") });
    await runStoreQueue([app("Aaaa")], [], vide.io);
    expect(vide.journal.ecrits.map((e) => e.outcome)).toEqual(["unreadable"]);
    // Cinq de suite : arrêt, avec son motif.
    const cinq = tiktok(Object.fromEntries(["aaaa", "bbbb", "cccc", "dddd", "eeee"].map((n) => [tagEmbedUrl(n), ok("<html></html>")])));
    expect((await runStoreQueue(["Aaaa", "Bbbb", "Cccc", "Dddd", "Eeee"].map(app), [], cinq.io)).stopped).toBe("page de hashtag sans données");
    // Huit profils inexistants ou privés d'affilée : le passage continue et conclut.
    const auteurs = Array.from({ length: 8 }, (_, i) => `auteur${i}`);
    const prives = tiktok({ [tagEmbedUrl("aaaa")]: ok(tagHtml(500, auteurs)), [profileEmbedUrl("auteur0")]: ok("<script>{}</script>") });
    expect(await runStoreQueue([app("Aaaa")], [], prives.io)).toEqual({ checked: 1, pages: 10, stopped: null });
    expect(prives.journal.ecrits.map((e) => e.outcome)).toEqual(["none"]);
  });

  it("des profils refusés d'affilée arrêtent aussi le passage", async () => {
    const auteurs = Array.from({ length: 8 }, (_, i) => `auteur${i}`);
    const { journal, io } = tiktok({ [tagEmbedUrl("aaaa")]: ok(tagHtml(500, auteurs)), ...Object.fromEntries(auteurs.map((a) => [profileEmbedUrl(a), refus("HTTP 429")])) });
    expect(await runStoreQueue([app("Aaaa")], [], io)).toEqual({ checked: 0, pages: 6, stopped: "HTTP 429" });
    expect(journal.ecrits).toEqual([]);
  });

  it("une page TikTok : 400 et 404 disent « n'existe pas », tout autre refus est suspect", async () => {
    const faux = (status: number, body = "x") => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await fetchEmbedPage("https://x", faux(200, "<html>ok</html>"))).toEqual({ kind: "ok", text: "<html>ok</html>" });
    expect(await fetchEmbedPage("https://x", faux(400))).toEqual({ kind: "absent" });
    expect(await fetchEmbedPage("https://x", faux(404))).toEqual({ kind: "absent" });
    expect(await fetchEmbedPage("https://x", faux(403))).toEqual({ kind: "suspect", reason: "HTTP 403" });
    expect(await fetchEmbedPage("https://x", faux(429))).toEqual({ kind: "suspect", reason: "HTTP 429" });
    const panne = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await fetchEmbedPage("https://x", panne)).toMatchObject({ kind: "suspect", reason: expect.stringContaining("ECONNRESET") });
  });
});

describe("Radar — classements App Store : la file", () => {
  it("une app sortie depuis moins de trois ans passe un an devant les autres", () => {
    expect(isRecentRelease("2026-06-12", NOW)).toBe(true);
    expect(isRecentRelease("2024-01-01", NOW)).toBe(true);
    expect(isRecentRelease("2023-12-31", NOW)).toBe(false);
    expect(isRecentRelease("", NOW)).toBe(false);
    expect(firstCheckAt("2025-08-14", NOW)).toBe(NOW - 365 * DAY);
    expect(firstCheckAt("2019-03-31", NOW)).toBe(NOW);
  });

  it("revue dans 60 jours sans réseau, 180 avec, le lendemain quand TikTok ne l'a pas servie", () => {
    expect(nextCheckAfter("none", NOW)).toBe(NOW + 60 * DAY);
    expect(nextCheckAfter("network", NOW)).toBe(NOW + 180 * DAY);
    expect(nextCheckAfter("known", NOW)).toBe(NOW + 180 * DAY);
    expect(nextCheckAfter("unreadable", NOW)).toBe(NOW + DAY);
  });
});
