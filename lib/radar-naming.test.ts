import { describe, expect, it } from "vitest";
import { isSmallAccount, mergeKnown, NAMING_PER_RUN, NAMING_QUERIES, namingText, SMALL_MAX_FANS } from "../convex/radarNamingMath";
import { candidatesOf, domainsIn, findApp, SEED_APPS } from "../convex/radarNetworkMath";

/**
 * Radar — les petits réseaux (13/11/2026) : les tournures qui nomment un produit, cherchées dans tout TikTok sans
 * seuil de vues. Les légendes et textes à l'écran d'essai sont ceux relevés les 12 et 13/11 chez Shortfy et TrendSaaS.
 */
describe("Radar — petits réseaux : les tournures qui nomment un produit", () => {
  it("16 tournures sur quatre langues, chacune une fois, une page par passage", () => {
    expect(NAMING_QUERIES).toHaveLength(16);
    expect(new Set(NAMING_QUERIES.map((q) => `${q.query}·${q.region}`)).size).toBe(16);
    expect(NAMING_PER_RUN).toBe(16);
    expect([...new Set(NAMING_QUERIES.map((q) => q.lang))]).toEqual(["fr", "en", "es", "pt"]);
    expect(NAMING_QUERIES.map((q) => q.query)).toEqual(expect.arrayContaining(["le site c'est", "le nom du site c'est", "l'ia c'est", "the website is called", "o site se chama"]));
    for (const q of NAMING_QUERIES) expect(q.region).toMatch(/^[A-Z]{2}$/);
  });

  it("un petit compte : moins de 10 000 abonnés", () => {
    expect(SMALL_MAX_FANS).toBe(10_000);
    // Les comptes de TrendSaaS (0 à 428 abonnés), @potron.me (2 763), @sarah_shortfy (17).
    for (const fans of [0, 17, 428, 2_763, 9_999]) expect(isSmallAccount(fans)).toBe(true);
    // @zinedine.gsbb (16 200), @juan.tikitaka (276 100) : des comptes installés.
    for (const fans of [10_000, 16_200, 276_100]) expect(isSmallAccount(fans)).toBe(false);
  });

  it("le site se lit dans la légende comme dans le texte à l'écran", () => {
    // TrendSaaS : rien dans la légende, le site à l'écran.
    const v = { caption: "pq j’apprends ça que mtn frr😭 #argent #tiktokfrance", hook: "Le nom du site c'est Glowsaas.ai" };
    expect(namingText(v)).toBe("pq j’apprends ça que mtn frr😭 #argent #tiktokfrance Le nom du site c'est Glowsaas.ai");
    expect(domainsIn(namingText(v))).toEqual(["glowsaas.ai"]);
    expect(domainsIn(namingText({ caption: "L’ia c’est «glowsaas.ai» #business #argent" }))).toEqual(["glowsaas.ai"]);
    expect(namingText({ caption: "Enregistrez cette vidéo au cas où ;)" })).toBe("Enregistrez cette vidéo au cas où ;)");
    // Une vidéo qui nomme une app déjà suivie est reconnue comme telle, pas proposée une seconde fois.
    expect(findApp(namingText({ caption: "Enregistre bien, au cas où !", hook: "Shortfy.io🤖" }), "xzfly0", SEED_APPS)?.name).toBe("Shortfy");
    expect(findApp(namingText({ caption: "Jvais vite aller charbonner moi", hook: "Site : trendsaas.ai" }), "n.styy__", SEED_APPS)?.name).toBe("TrendSaaS");
  });

  it("les pages de liens, cagnottes et messageries ne sont pas des apps", () => {
    expect(domainsIn("mon lien onelink.me/abcd et discord.gg/xyz, cagnotte gofund.me/1 — paypal.me/moi")).toEqual([]);
    expect(domainsIn("le jeu est sur itch.io, promo whop.com")).toEqual([]);
    // Seul un compte mentionné ou un site fait une app repérée ; sans mention, un site suffit.
    expect(candidatesOf({ caption: "Le site c'est glowsaas.ai (lien onelink.me/x)", authorId: "42" })).toEqual([{ key: "glowsaas.ai", kind: "domain", label: "glowsaas.ai" }]);
  });
});

describe("Radar — petits réseaux : le témoin du jour", () => {
  it("les apps suivies retrouvées par ces recherches : vidéos additionnées, comptes réunis, les plus portées d'abord", () => {
    const jour = mergeKnown([], [
      { slug: "trendsaas", author: "sofian.klm92" },
      { slug: "shortfy", author: "potron.me" },
      { slug: "trendsaas", author: "n.styy__" },
      { slug: "trendsaas", author: "sofian.klm92" },
    ]);
    expect(jour).toEqual([
      { slug: "trendsaas", videos: 3, authors: ["sofian.klm92", "n.styy__"] },
      { slug: "shortfy", videos: 1, authors: ["potron.me"] },
    ]);
    // Le passage suivant du même jour s'ajoute.
    expect(mergeKnown(jour, [{ slug: "shortfy", author: "xzfly0" }, { slug: "shortfy", author: "potron.me" }, { slug: "shortfy", author: "gasp_viral" }])).toEqual([
      { slug: "shortfy", videos: 4, authors: ["potron.me", "xzfly0", "gasp_viral"] },
      { slug: "trendsaas", videos: 3, authors: ["sofian.klm92", "n.styy__"] },
    ]);
    expect(mergeKnown([], [])).toEqual([]);
  });

  it("au plus 30 comptes gardés par app, les vidéos toutes comptées", () => {
    const beaucoup = Array.from({ length: 40 }, (_, i) => ({ slug: "shortfy", author: `compte${i}` }));
    const [k] = mergeKnown([], beaucoup);
    expect([k.videos, k.authors.length]).toEqual([40, 30]);
  });
});
