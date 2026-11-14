import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BATCH,
  ACCOUNT_SYSTEM,
  ACCOUNT_TEXTS_MAX,
  JUDGE_VERSION,
  NATURE_BATCH,
  NATURE_SYSTEM,
  NATURE_VERSION,
  NATURE_REFRESH_MS,
  SWARM_KINDS,
  WEAK_SHARE,
  accountAnswer,
  accountPrompt,
  accountTexts,
  groupedByApp,
  judgeCursorOf,
  natureAnswer,
  natureDue,
  naturePrompt,
  productName,
  shownInSwarm,
  weakProof,
} from "../convex/radarJudgeMath";

/**
 * Radar — le jugement sémantique, phase A (lot 4 du dig, 14/11/2026) : l'IA juge ce qu'est chaque app et si un compte
 * à preuve faible pousse bien son produit ; rien n'agit encore.
 */
const NOW = Date.UTC(2026, 10, 14, 15, 0);

describe("Radar — jugement : quels comptes ont une preuve faible", () => {
  it("aucune preuve, liste de départ non prouvée, pseudo ou bio sans aucune vidéo qui cite, vidéos minoritaires", () => {
    expect(WEAK_SHARE).toBe(0.5);
    expect(weakProof({ by: null, cites: 0, of: 10 }, "caption")).toBe("aucune");
    expect(weakProof({ by: "seed", cites: 1, of: 10 }, "seed")).toBe("liste_non_prouvee");
    expect(weakProof({ by: "handle", cites: 0, of: 8 }, "caption")).toBe("pseudo_seul");
    expect(weakProof({ by: "bio", cites: 0, of: 8 }, "caption")).toBe("bio_seule");
    expect(weakProof({ by: "videos", cites: 4, of: 10 }, "caption")).toBe("videos_minoritaires");
  });

  it("une preuve forte n'est pas jugée ; un compte ajouté à la main jamais", () => {
    expect(weakProof({ by: "videos", cites: 5, of: 10 }, "caption")).toBeNull();
    expect(weakProof({ by: "handle", cites: 1, of: 8 }, "caption")).toBeNull();
    expect(weakProof({ by: "bio", cites: 2, of: 8 }, "seed")).toBeNull();
    expect(weakProof({ by: "manual", cites: 0, of: 3 }, "manual")).toBeNull();
    expect(weakProof({ by: null, cites: 0, of: 3 }, "manual")).toBeNull();
    // Pas de vidéo du tout : la part ne se calcule pas, la preuve par vidéos ne peut pas être minoritaire.
    expect(weakProof({ by: "videos", cites: 0, of: 0 }, "caption")).toBeNull();
  });
});

describe("Radar — jugement : ce qu'est une app", () => {
  const batch = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];

  it("une ligne par app demandée, des valeurs de la liste ; une app inventée, répétée ou mal remplie saute", () => {
    expect(NATURE_BATCH).toBe(20);
    const raw = {
      products: [
        { id: "a1", digital: true, kind: "app", aboutIt: "oui", why: "  Les vidéos montrent l'appli de flashcards  " },
        { id: "a1", digital: false, kind: "marque", aboutIt: "non", why: "doublon" },
        { id: "zz", digital: true, kind: "app", aboutIt: "oui", why: "inventée" },
        { id: "a2", digital: "oui", kind: "app", aboutIt: "oui", why: "mal remplie" },
        { id: "a3", digital: false, kind: "lieu", aboutIt: "non", why: "type hors liste" },
      ],
    };
    expect(natureAnswer(raw, batch)).toEqual([{ id: "a1", nature: { digital: true, kind: "app", aboutIt: "oui", why: "Les vidéos montrent l'appli de flashcards" } }]);
    expect(natureAnswer(null, batch)).toEqual([]);
  });

  it("ce que Swarm montre (définition du 14/11) : apps, SaaS, jeux mobiles ; pas encore jugée = montrée", () => {
    expect(SWARM_KINDS).toEqual(["app", "saas", "jeu_mobile"]);
    expect(shownInSwarm({ digital: true, kind: "app" })).toBe(true);
    expect(shownInSwarm({ digital: true, kind: "saas" })).toBe(true);
    expect(shownInSwarm({ digital: true, kind: "jeu_mobile" })).toBe(true);
    for (const kind of ["jeu", "ecommerce", "marque", "media", "autre"] as const) expect(shownInSwarm({ digital: true, kind })).toBe(false);
    // Non numérique : jamais, quel que soit le type rendu.
    expect(shownInSwarm({ digital: false, kind: "app" })).toBe(false);
    expect(shownInSwarm(undefined)).toBe(true);
    expect(shownInSwarm(null)).toBe(true);
  });

  it("jugée une fois, rejugée au bout de 30 jours, ou tout de suite si ses définitions ont changé", () => {
    expect(natureDue({}, NOW)).toBe(true);
    expect(natureDue({ natureAt: NOW - NATURE_REFRESH_MS + 1, natureV: NATURE_VERSION }, NOW)).toBe(false);
    expect(natureDue({ natureAt: NOW - NATURE_REFRESH_MS, natureV: NATURE_VERSION }, NOW)).toBe(true);
    // Jugée hier sous les définitions v1 (FreeDrama « media ») : rejugée.
    expect(NATURE_VERSION).toBe(2);
    expect(natureDue({ natureAt: NOW - 3_600_000 }, NOW)).toBe(true);
  });

  it("une app pour regarder des séries est une app ; le média, c'est le contenu (v2)", () => {
    expect(NATURE_SYSTEM).toContain("apps to watch series or videos");
    expect(NATURE_SYSTEM).toContain("never the app or the site used to watch, read or listen to it");
  });

  it("l'IA lit la fiche, la phrase connue et ce qu'écrivent ses comptes ; rien n'est inventé quand on ne sait rien", () => {
    const p = naturePrompt([
      { id: "a1", name: "Arkose+", searches: ["arkose"], pitch: "Salle d'escalade", store: { genre: "Health & Fitness", artist: "Arkose" }, texts: ["séance de bloc"], bios: [] },
      { id: "a2", name: "Rien", searches: [], texts: [], bios: [] },
    ]);
    expect(p).toContain("known summary: Salle d'escalade");
    expect(p).toContain('app store: genre "Health & Fitness", publisher "Arkose"');
    expect(p).toContain('creators write: "séance de bloc"');
    expect(p).toContain("creators write: (nothing read yet)");
    expect(p).toContain("search terms: (none)");
  });
});

describe("Radar — jugement : pousse-t-il CE produit ?", () => {
  it("ses textes : texte à l'écran puis légende, chacun une fois, 10 au plus", () => {
    expect(ACCOUNT_TEXTS_MAX).toBe(10);
    const vids = [
      { hook: "pov ton crush répond", caption: "#rizzapp" },
      { hook: "pov ton crush répond", caption: "#rizzapp" },
      { caption: "Ma routine" },
      { hook: null, caption: "" },
      ...Array.from({ length: 12 }, (_, i) => ({ caption: `vidéo ${i}` })),
    ];
    const t = accountTexts(vids);
    expect(t.slice(0, 2)).toEqual(["pov ton crush répond — #rizzapp", "Ma routine"]);
    expect(t).toHaveLength(10);
  });

  it("v2 : les vidéos qui citent l'app d'abord, même plus anciennes que les 10 dernières", () => {
    // mfernandaugc : 4 vidéos sur 20 citent Fluencify, aucune parmi les 10 dernières — v1 la jugeait « sans rapport ».
    const vids = [
      ...Array.from({ length: 16 }, (_, i) => ({ caption: `rotina fitness ${i} #emagrecer` })),
      ...Array.from({ length: 4 }, (_, i) => ({ caption: `aprendendo inglês com #fluencify ${i}` })),
    ];
    const cites = (v: { caption?: string | null }) => (v.caption ?? "").includes("fluencify");
    const t = accountTexts(vids, 10, cites);
    expect(t.slice(0, 4)).toEqual([0, 1, 2, 3].map((i) => `aprendendo inglês com #fluencify ${i}`));
    expect(t[4]).toBe("rotina fitness 0 #emagrecer");
    expect(t).toHaveLength(10);
    // Sans la règle, aucune n'est lue.
    expect(accountTexts(vids).some((x) => x.includes("fluencify"))).toBe(false);
    // Une citation en fin de longue légende n'est pas coupée (les autres textes, si).
    const long = [{ caption: `${"Treino de pernas completo para iniciantes ".repeat(6)}#fluencify` }, { caption: "x".repeat(300) }];
    const [first, second] = accountTexts(long, 10, cites);
    expect(first.endsWith("#fluencify")).toBe(true);
    expect(second.length).toBeLessThanOrEqual(180);
  });

  it("un verdict de la liste par compte demandé ; « autre » ne se garde que pour « autre_app »", () => {
    expect(ACCOUNT_BATCH).toBe(12);
    const raw = {
      accounts: [
        { id: "c1", verdict: "autre_app", other: "TextVibe", why: "Ferme d'histoires de textos" },
        { id: "c2", verdict: "sans_rapport", other: "Hush", why: "Une chanteuse : « hush » est le titre de sa chanson" },
        { id: "c3", verdict: "peut-être", other: "", why: "hors liste" },
        { id: "c9", verdict: "pousse", other: "", why: "inventé" },
      ],
    };
    expect(accountAnswer(raw, [{ id: "c1" }, { id: "c2" }, { id: "c3" }])).toEqual([
      { id: "c1", verdict: "autre_app", other: "TextVibe", why: "Ferme d'histoires de textos" },
      { id: "c2", verdict: "sans_rapport", why: "Une chanteuse : « hush » est le titre de sa chanson" },
    ]);
  });

  it("« autre app » nomme UNE app ; une liste ou une description devient « incertain »", () => {
    expect(productName("Moka Score")).toBe("Moka Score");
    expect(productName("Heavenly: Bible Verse Widgets")).toBe("Heavenly: Bible Verse Widgets");
    expect(productName("StemUp, SimpleStudy")).toBe("");
    expect(productName("web de révision TKA (site non nommé)")).toBe("");
    expect(productName("Airbuds (appli de musique Spotify)")).toBe("");
    expect(productName("une application de quiz pour réviser le bac")).toBe("");
    const raw = { accounts: [{ id: "c1", verdict: "autre_app", other: "StemUp, SimpleStudy", why: "deux apps d'étude" }] };
    expect(accountAnswer(raw, [{ id: "c1" }])).toEqual([{ id: "c1", verdict: "incertain", why: "deux apps d'étude" }]);
  });

  it("v2 : le parcours d'une version d'avant repart du début ; un passage range ses comptes par app", () => {
    expect(judgeCursorOf({ judgeCursor: "c-v1" })).toBeNull();
    expect(judgeCursorOf({ judgeCursor: "c-v2", judgeCursorV: JUDGE_VERSION })).toBe("c-v2");
    expect(judgeCursorOf({ judgeCursorV: JUDGE_VERSION })).toBeNull();
    expect(judgeCursorOf(null)).toBeNull();
    const items = [{ appId: "b", h: 1 }, { appId: "a", h: 2 }, { appId: "b", h: 3 }, { appId: "a", h: 4 }];
    expect(groupedByApp(items).map((x) => x.h)).toEqual([2, 4, 1, 3]);
  });

  it("v2 : placement = une ou deux vidéos ; un nom absent des textes d'un compte de liste = incertain", () => {
    expect(JUDGE_VERSION).toBe(2);
    expect(ACCOUNT_SYSTEM).toContain("names the product in only one or two videos");
    expect(ACCOUNT_SYSTEM).toContain("Three or more videos naming the product is never a placement");
    expect(ACCOUNT_SYSTEM).toContain("found through a list of the product's creators, answer \"incertain\"");
    expect(ACCOUNT_SYSTEM).toContain("never against another account's product");
  });

  it("l'IA lit le produit (nom, phrase, fiche App Store, recherches), le compte, sa bio et ses dernières vidéos", () => {
    const p = accountPrompt([
      {
        id: "c1",
        handle: "lea.revise",
        bio: "",
        texts: [],
        app: { name: "Knowunity", searches: ["knowunity"], pitch: "App de fiches de révision" },
        evidence: { cites: 3, of: 11, bioNames: false, source: "seed" },
      },
    ]);
    expect(p).toContain("product: Knowunity — App de fiches de révision");
    expect(p).toContain("account: @lea.revise");
    expect(p).toContain("bio: (empty)");
    expect(p).toContain("evidence: 3 of 11 stored videos contain the product's name or tag (listed first); bio names it: no; account found through a list of the product's creators");
    expect(p).toContain("videos (on-screen text — caption), those naming the product first, then the latest: (none)");
  });
});
