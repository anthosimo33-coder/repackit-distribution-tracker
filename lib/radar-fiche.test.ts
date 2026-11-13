import { describe, expect, it } from "vitest";
import {
  candidateFiche,
  ficheApp,
  fichePatterns,
  handNiche,
  marketAbout,
  MARKET_ABOUT_MAX,
  NICHE_BATCH,
  NICHE_BY_HAND,
  NICHE_RETRY_MS,
  NICHE_SCHEMA,
  NICHE_SYSTEM,
  NICHE_WAIT_MS,
  NICHES,
  nicheAnswer,
  nicheDue,
  nicheEvidence,
  nichePrompt,
  nicheTexts,
  nicheToWrite,
  PITCH_MAX,
  type NicheToJudge,
} from "../convex/radarFicheMath";

/**
 * Radar — la fiche d'une app suivie (13/11/2026) : sa niche et ce qu'elle fait en une phrase (dites par une IA,
 * la niche posée à la main faisant foi), sa fiche App Store et ce que ses campagnes paient (recopiées de l'app
 * repérée dont elle vient).
 */
const NOW = Date.UTC(2026, 10, 13, 12, 0);
const DAY = 86_400_000;

describe("Radar — fiche d'une app : les niches", () => {
  it("les 11 niches de Swarm y sont toutes, 5 de plus pour les nouvelles sources, « Autres » en dernier", () => {
    const swarm = ["Séduction IA", "Études", "Couple", "Santé et physique", "Langues", "Jalousie et ex", "Side hustle", "Social et loisirs", "Foi", "Beauté IA", "Autres"];
    for (const n of swarm) expect(NICHES).toContain(n);
    expect(NICHES.filter((n) => !swarm.includes(n))).toEqual(["Rencontres", "Bien-être mental", "Finance", "Productivité", "Création de contenu"]);
    expect(NICHES.at(-1)).toBe("Autres");
    expect(new Set(NICHES).size).toBe(NICHES.length);
    // L'IA ne peut répondre que par une niche de la liste, et lit ce que chacune recouvre.
    expect(NICHE_SCHEMA.properties.products.items.properties.niche.enum).toEqual([...NICHES]);
    for (const n of NICHES) expect(NICHE_SYSTEM).toContain(`"${n}"`);
  });

  it("la niche posée à la main se retrouve par le nom, quelle que soit sa graphie ; les « Autres » de Swarm sont laissés à l'IA", () => {
    expect(handNiche("Rizz App")).toBe("Séduction IA");
    expect(handNiche("rizz app")).toBe("Séduction IA");
    expect(handNiche("TrendSaaS")).toBe("Side hustle");
    expect(handNiche("The Ick")).toBe("Jalousie et ex");
    expect(handNiche("Cal AI")).toBe("Santé et physique");
    expect(handNiche("Bible Chat")).toBe("Foi");
    for (const autres of ["Sunsay", "SafeNow", "Palima", "Kairo Alarme", "Koro AI", "Bitepal"]) expect(handNiche(autres)).toBeUndefined();
    expect(NICHE_BY_HAND.size).toBe(45);
    for (const niche of NICHE_BY_HAND.values()) expect(NICHES).toContain(niche);
  });
});

describe("Radar — fiche d'une app : quand la demander", () => {
  const app = { createdAt: NOW - 2 * 3_600_000 };

  it("une app jamais décrite est demandée dès qu'on a de quoi lire, ou au bout d'un jour", () => {
    expect(NICHE_BATCH).toBe(20);
    expect(nicheDue(app, 1, NOW)).toBe(true);
    // Rien à lire encore (ses comptes sont relevés dans l'heure) : elle attend.
    expect(nicheDue(app, 0, NOW)).toBe(false);
    expect(nicheDue({ createdAt: NOW - NICHE_WAIT_MS }, 0, NOW)).toBe(true);
  });

  it("décrite, elle ne l'est plus ; sans phrase, elle est redemandée une semaine plus tard", () => {
    expect(nicheDue({ ...app, nicheAt: NOW - 30 * DAY, pitch: "App qui compte les calories" }, 9, NOW)).toBe(false);
    expect(nicheDue({ ...app, nicheAt: NOW - NICHE_RETRY_MS + 1 }, 9, NOW)).toBe(false);
    expect(nicheDue({ ...app, nicheAt: NOW - NICHE_RETRY_MS }, 9, NOW)).toBe(true);
  });
});

describe("Radar — fiche d'une app : ce que l'IA lit", () => {
  it("les textes des créateurs : propres, sur une ligne, chacun une fois, huit au plus", () => {
    expect(nicheTexts(["  Le nom du site\nc'est koro.ai  ", undefined, null, "", "ok", "le nom du site c'est KORO.AI", "Enregistre ça"])).toEqual(["Le nom du site c'est koro.ai", "Enregistre ça"]);
    expect(nicheTexts(Array.from({ length: 20 }, (_, i) => `Texte numéro ${i} de la liste`))).toHaveLength(8);
    expect(nicheTexts(["Première bio du compte", "Deuxième bio du compte", "Troisième bio", "Quatrième bio"], 3)).toHaveLength(3);
    expect(nicheTexts(["x".repeat(400)])[0]).toHaveLength(160);
  });

  const koro: NicheToJudge = {
    id: "app1",
    name: "Koro AI",
    searches: ["koroai", "#koroai"],
    store: { genre: "Productivité", artist: "Koro Labs" },
    texts: ['Ce site transforme mes cours en "fiches"', "Le nom du site c'est koro"],
    bios: ["J'utilise : koro.ai"],
  };
  const road: NicheToJudge = { id: "app2", name: "Open Road", searches: ["openroad"], market: { productKind: "app", about: "Open Road is a drive tracker for iOS." }, texts: [], bios: [] };

  it("chaque app arrive avec son nom, ses motifs, sa fiche App Store ou sa campagne, et ce que ses créateurs écrivent", () => {
    const prompt = nichePrompt([koro, road]);
    expect(prompt).toContain('id: app1\nname: Koro AI\nsearch terms: koroai, #koroai\napp store: genre "Productivité", publisher "Koro Labs"');
    // Les guillemets d'un texte ne cassent pas la citation.
    expect(prompt).toContain(`creators write: "Ce site transforme mes cours en 'fiches'" | "Le nom du site c'est koro"`);
    expect(prompt).toContain(`creator bios: "J'utilise : koro.ai"`);
    expect(prompt).toContain("id: app2\nname: Open Road\nsearch terms: openroad\npaid campaign (mobile app): Open Road is a drive tracker for iOS.\ncreators write: (nothing read yet)");
    expect(prompt).not.toContain("app2\nname: Open Road\nsearch terms: openroad\napp store");
  });

  it("ce qu'on sait d'une app se compte : fiche, texte de campagne, chaque texte de créateur", () => {
    expect(nicheEvidence(koro)).toBe(4);
    expect(nicheEvidence(road)).toBe(1);
    expect(nicheEvidence({ texts: [], bios: [], market: { productKind: "software" } })).toBe(0);
  });
});

describe("Radar — fiche d'une app : ce qu'on garde de la réponse de l'IA", () => {
  const batch = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("une ligne par app demandée, une niche de la liste, une phrase propre", () => {
    const got = nicheAnswer(
      {
        products: [
          { id: "a", niche: "Études", pitch: '  « Site qui transforme un cours\nen fiches de révision. »  ' },
          { id: "b", niche: "Trading", pitch: "App de suivi de trajets en voiture" },
          { id: "c", niche: "Autres", pitch: "" },
          { id: "a", niche: "Foi", pitch: "Répétée : ignorée, la première réponse reste" },
          { id: "zz", niche: "Foi", pitch: "Inventée : ignorée, personne ne l'a demandée" },
          null,
          "x",
        ],
      },
      batch,
    );
    expect(got).toEqual([
      { id: "a", niche: "Études", pitch: "Site qui transforme un cours en fiches de révision" },
      // Une niche hors liste devient « Autres » ; la phrase reste.
      { id: "b", niche: "Autres", pitch: "App de suivi de trajets en voiture" },
      { id: "c", niche: "Autres", pitch: "" },
    ]);
    // « d » n'a pas de réponse : elle sera redemandée.
    expect(got.map((g) => g.id)).not.toContain("d");
  });

  it("une phrase qui ne dit rien est vidée, une phrase trop longue coupée ; une réponse illisible ne rend rien", () => {
    expect(nicheAnswer({ products: [{ id: "a", niche: "Foi", pitch: "App" }] }, batch)).toEqual([{ id: "a", niche: "Foi", pitch: "" }]);
    expect(nicheAnswer({ products: [{ id: "a", niche: "Foi", pitch: "y".repeat(400) }] }, batch)[0].pitch).toHaveLength(PITCH_MAX);
    expect(nicheAnswer({ products: [{ id: "a", niche: 3, pitch: 4 }] }, batch)).toEqual([{ id: "a", niche: "Autres", pitch: "" }]);
    for (const raw of [null, "texte", {}, { products: "non" }]) expect(nicheAnswer(raw, batch)).toEqual([]);
  });

  it("la niche posée à la main fait foi, la phrase vient de l'IA", () => {
    expect(nicheToWrite("Rizz App", { niche: "Rencontres", pitch: "Clavier IA qui souffle des réponses pour draguer" })).toEqual({ niche: "Séduction IA", nicheBy: "hand", pitch: "Clavier IA qui souffle des réponses pour draguer" });
    expect(nicheToWrite("Koro AI", { niche: "Études", pitch: "Site qui transforme un cours en fiches" })).toEqual({ niche: "Études", nicheBy: "ai", pitch: "Site qui transforme un cours en fiches" });
    // Sans phrase : la niche est écrite, la phrase laissée telle qu'elle était.
    expect(nicheToWrite("Koro AI", { niche: "Autres", pitch: "" })).toEqual({ niche: "Autres", nicheBy: "ai" });
  });
});

describe("Radar — fiche d'une app : ce qu'elle reprend de l'app repérée", () => {
  const store = { storeId: "6740000001", artist: "Koro Labs", genre: "Productivité", released: "2026-02-03", tag: "koroaiapp", tagVideos: 1_125, tagViews: 1_125_000, creators: [{ handle: "lea.koroai", why: "handle" as const }] };
  const market = { source: "contentrewards", productKind: "app" as const, handle: "openroadapp", org: "Clipix", campaignUrl: "https://contentrewards.com/c/campaigns/x", campaigns: 2, creators: 46, views: 589_966, spentCents: 73_700, rateCents: 125, about: "A drive tracker." };

  it("sa fiche App Store, sans la preuve du contrôle ; ses campagnes, sans le pseudo du produit", () => {
    expect(candidateFiche({ store })).toEqual({ store: { storeId: "6740000001", artist: "Koro Labs", genre: "Productivité", released: "2026-02-03" } });
    expect(candidateFiche({ market })).toEqual({
      market: { source: "contentrewards", productKind: "app", org: "Clipix", campaignUrl: "https://contentrewards.com/c/campaigns/x", campaigns: 2, creators: 46, views: 589_966, spentCents: 73_700, rateCents: 125, about: "A drive tracker." },
    });
    // Sans tarif à la vue ni description : ces champs n'existent pas.
    expect(candidateFiche({ market: { ...market, rateCents: undefined, about: undefined } }).market).toEqual({ source: "contentrewards", productKind: "app", org: "Clipix", campaignUrl: "https://contentrewards.com/c/campaigns/x", campaigns: 2, creators: 46, views: 589_966, spentCents: 73_700 });
    // Un compte mentionné ou un site cité n'a pas de fiche à donner.
    expect(candidateFiche({})).toEqual({});
  });

  it("une app repérée déjà suivie se retrouve par le hashtag qui la prouvait, ou par le nom de son produit", () => {
    expect(fichePatterns({ kind: "store", label: "Koro AI: fiches", store })).toEqual(["koroai"]);
    expect(fichePatterns({ kind: "market", label: "Open Road", market })).toEqual(["openroad", "openroadapp"]);
    expect(fichePatterns({ kind: "mention", label: "@koro" })).toEqual([]);
    expect(fichePatterns({ kind: "domain", label: "koro.ai" })).toEqual([]);
  });

  it("l'app suivie d'une app repérée : par un de ses motifs d'abord, sinon par son nom", () => {
    const apps = [
      { name: "Koro", strong: ["koroai"] },
      { name: "Open Road", strong: ["roadtrip"] },
      { name: "Autre", strong: ["autreapp"] },
    ];
    // Le hashtag « koroaiapp » est le motif « koroai » de l'app nommée « Koro ».
    expect(ficheApp({ kind: "store", label: "Koro AI", store }, apps)?.name).toBe("Koro");
    // Aucun motif en commun (« openroad », « openroadapp ») : c'est son nom qui la désigne.
    expect(ficheApp({ kind: "market", label: "open road", market }, apps)?.name).toBe("Open Road");
    expect(ficheApp({ kind: "market", label: "Inconnue", market: { ...market, handle: "" } }, apps)).toBeUndefined();
    // Un motif fait foi avant le nom.
    expect(ficheApp({ kind: "store", label: "Autre", store }, apps)?.name).toBe("Koro");
  });

  it("la description d'une campagne est rangée sur une ligne, 300 caractères au plus", () => {
    expect(marketAbout("  Open Road\n is a drive   tracker. ")).toBe("Open Road is a drive tracker.");
    expect(marketAbout("z".repeat(900))).toHaveLength(MARKET_ABOUT_MAX);
    expect(marketAbout(undefined)).toBe("");
  });
});
