import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BATCH,
  ACCOUNT_TEXTS_MAX,
  NATURE_BATCH,
  NATURE_REFRESH_MS,
  EXCLUDED_KINDS,
  LEAD_MIN_ACCOUNTS,
  SWARM_KINDS,
  WEAK_SHARE,
  accountAnswer,
  accountPrompt,
  accountTexts,
  natureAnswer,
  natureDue,
  naturePrompt,
  outOfScope,
  shownInSwarm,
  verdictAction,
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

  it("ce que le Radar et Swarm gardent (définition du 14/11) : apps, SaaS, jeux mobiles ; écarté seulement sur un verdict net", () => {
    expect(SWARM_KINDS).toEqual(["app", "saas", "jeu_mobile"]);
    expect(EXCLUDED_KINDS).toEqual(["jeu", "ecommerce", "marque", "media"]);
    const n = (kind: (typeof EXCLUDED_KINDS)[number] | (typeof SWARM_KINDS)[number] | "autre", digital = true, aboutIt: "oui" | "non" | "incertain" = "oui") => ({ kind, digital, aboutIt });
    for (const k of SWARM_KINDS) expect(outOfScope(n(k))).toBe(false);
    for (const k of EXCLUDED_KINDS) expect(outOfScope(n(k))).toBe(true);
    // Non numérique : écarté, quel que soit le type.
    expect(outOfScope(n("app", false))).toBe(true);
    // Pas de verdict net : gardée — pas encore jugée, ses créateurs n'en disent pas assez, ou numérique mais pas rangée.
    expect(outOfScope(undefined)).toBe(false);
    expect(outOfScope(null)).toBe(false);
    expect(outOfScope(n("ecommerce", true, "incertain"))).toBe(false);
    expect(outOfScope(n("app", false, "incertain"))).toBe(false);
    expect(outOfScope(n("autre"))).toBe(false);
    // Ses créateurs parlent d'autre chose (« non ») : l'IA décrit ce dont ils parlent, pas le produit — rejoué sur la
    // prod le 14/11, Umax et Airbuds sortaient « non numériques ». Gardée ; c'est son réseau qui se juge, compte par compte.
    expect(outOfScope(n("autre", false, "non"))).toBe(false);
    expect(outOfScope(n("media", true, "non"))).toBe(false);
    // Une app qui a sa fiche App Store est numérique : seule l'e-commerce l'écarte.
    expect(outOfScope(n("ecommerce"), true)).toBe(true);
    expect(outOfScope(n("app", false), true)).toBe(false);
    expect(outOfScope(n("media"), true)).toBe(false);
    expect(outOfScope(n("jeu"), true)).toBe(false);
    expect(shownInSwarm(n("ecommerce"))).toBe(false);
    expect(shownInSwarm(n("jeu_mobile"))).toBe(true);
  });

  it("jugée une fois, rejugée au bout de 30 jours", () => {
    expect(natureDue({}, NOW)).toBe(true);
    expect(natureDue({ natureAt: NOW - NATURE_REFRESH_MS + 1 }, NOW)).toBe(false);
    expect(natureDue({ natureAt: NOW - NATURE_REFRESH_MS }, NOW)).toBe(true);
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

  it("l'IA lit le produit (nom, phrase, fiche App Store, recherches), le compte, sa bio et ses dernières vidéos", () => {
    const p = accountPrompt([
      { id: "c1", handle: "lea.revise", bio: "", texts: [], app: { name: "Knowunity", searches: ["knowunity"], pitch: "App de fiches de révision" } },
    ]);
    expect(p).toContain("product: Knowunity — App de fiches de révision");
    expect(p).toContain("account: @lea.revise");
    expect(p).toContain("bio: (empty)");
    expect(p).toContain("latest videos (on-screen text — caption): (none)");
  });
});

describe("Radar — jugement, phase B : ce que fait chaque verdict (définition du 14/11)", () => {
  const actif = { status: "active" as const, matchedBy: "caption" as const };
  const suivies: Record<string, { id: string; active: boolean }> = { "the cringe": { id: "cringe", active: true }, arkose: { id: "arkose", active: false } };
  const followed = (name: string) => suivies[name.toLowerCase()] ?? null;

  it("rien à voir : en pause ; placement : marqué, gardé ; pousse et incertain : rien", () => {
    expect(verdictAction({ verdict: "sans_rapport" }, actif, followed)).toEqual({ kind: "pause" });
    expect(verdictAction({ verdict: "placement" }, actif, followed)).toEqual({ kind: "placement" });
    expect(verdictAction({ verdict: "pousse" }, actif, followed)).toEqual({ kind: "none" });
    expect(verdictAction({ verdict: "incertain" }, actif, followed)).toEqual({ kind: "none" });
  });

  it("une autre app : déplacé si on la suit ; en pause si elle est en pause ; sinon une piste, suivie dès 2 comptes", () => {
    expect(verdictAction({ verdict: "autre_app", other: "The Cringe" }, actif, followed)).toEqual({ kind: "move", to: "cringe" });
    expect(verdictAction({ verdict: "autre_app", other: "Arkose" }, actif, followed)).toEqual({ kind: "pause" });
    expect(verdictAction({ verdict: "autre_app", other: "Mokascore" }, actif, followed)).toEqual({ kind: "lead", product: "Mokascore" });
    // Sans nom, on ne peut rien en faire.
    expect(verdictAction({ verdict: "autre_app", other: "  " }, actif, followed)).toEqual({ kind: "none" });
    expect(LEAD_MIN_ACCOUNTS).toBe(2);
  });

  it("jamais un compte déjà en pause, gardé à la main ou ajouté à la main", () => {
    expect(verdictAction({ verdict: "sans_rapport" }, { ...actif, status: "paused" }, followed)).toEqual({ kind: "none" });
    expect(verdictAction({ verdict: "sans_rapport" }, { ...actif, keptByHand: true }, followed)).toEqual({ kind: "none" });
    expect(verdictAction({ verdict: "sans_rapport" }, { ...actif, matchedBy: "manual" }, followed)).toEqual({ kind: "none" });
  });
});

