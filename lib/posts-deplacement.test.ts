import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { cibleDeplacee, deplacerPostsCore, paires, refusDeplacement } from "../convex/postsDeplacement";

/**
 * `deplacer_posts` — cas du 04/11/2026 : Ilona renomme son TikTok `@ilosnitchy`
 * en `@ilosnytch`, l'équipe déclare le nouveau @ et archive l'ancien ; 4 posts
 * publiés restent sur la fiche archivée. Formes reprises de la prod.
 */
const ilona = "md7d03e8nw6exfdmnexh30y5b98h0aqr" as Id<"creators">;
const autre = "md7autre000000000000000000000000" as Id<"creators">;
const compte = (id: string, handle: string, x: Partial<Doc<"comptes">> = {}) =>
  ({ _id: id as Id<"comptes">, handle, plateforme: "TikTok", creatorId: ilona, status: "actif", actif: true, ...x }) as Doc<"comptes">;

const ancien = compte("jd7f4g7jxbw14szwja31jfqg158haak2", "@ilosnitchy", { status: "archived", actif: false });
const nouveau = compte("jd7c99emkmcpjebzgrd895gdw58hj1yy", "@ilosnytch");
const insta = compte("jd7f5an89fr8bpz1a7chfcmbrd8hgjxh", "@ilona.snytch", { plateforme: "Instagram" });
const post = (id: string) => id as Id<"publications">;

describe("refusDeplacement", () => {
  it("permis : même créatrice, même plateforme, départ archivé", () => {
    expect(refusDeplacement(ancien, nouveau)).toBeNull();
  });
  it("refusé vers un compte archivé", () => {
    expect(refusDeplacement(nouveau, ancien)).toMatch(/archivé/);
  });
  it("refusé d'une plateforme à l'autre", () => {
    expect(refusDeplacement(ancien, insta)).toMatch(/plateforme/);
  });
  it("refusé vers le compte d'une autre créatrice (la paie en dépend)", () => {
    expect(refusDeplacement(ancien, compte("jd7x", "@ailleurs", { creatorId: autre }))).toMatch(/même créatrice/);
  });
  it("refusé vers un compte interne (sans créatrice)", () => {
    expect(refusDeplacement(ancien, compte("jd7y", "@interne", { creatorId: undefined }))).toMatch(/même créatrice/);
  });
  it("refusé sur place", () => {
    expect(refusDeplacement(ancien, ancien)).toMatch(/déjà/);
  });
});

describe("paires", () => {
  it("un @ sur TikTok ET Instagram : seule la paire de même plateforme reste", () => {
    const tiktokJu = compte("jd7a", "@juliettesnytch");
    const instaJu = compte("jd7b", "@juliettesnytch", { plateforme: "Instagram" });
    const nouveauTiktok = compte("jd7c", "@juju");
    expect(paires([tiktokJu, instaJu], [nouveauTiktok])).toEqual([[tiktokJu, nouveauTiktok]]);
  });
  it("jamais vers un compte d'une autre créatrice", () => {
    expect(paires([ancien], [compte("jd7x", "@ilosnytch", { creatorId: autre })])).toEqual([]);
  });
});

describe("cibleDeplacee", () => {
  const p1 = post("j97b36x3pb6r9st7x0ax7sj1fs8hhqpk");
  const publiee = {
    targets: [
      { platform: "TikTok" as const, accountId: ancien._id, publicationId: p1, publishedUrl: "https://www.tiktok.com/@ilosnitchy/video/7704073874983456033" },
      { platform: "Instagram" as const, accountId: insta._id, publicationId: post("j97insta") },
    ],
  };

  it("la cible qui porte le post passe sur le nouveau compte, l'autre plateforme ne bouge pas", () => {
    expect(cibleDeplacee(publiee, new Set([p1]), ancien._id, nouveau._id)).toEqual({
      targets: [{ ...publiee.targets[0], accountId: nouveau._id }, publiee.targets[1]],
    });
  });
  it("une mission qui ne porte pas le post : rien à écrire", () => {
    expect(cibleDeplacee(publiee, new Set([post("j97ailleurs")]), ancien._id, nouveau._id)).toBeNull();
  });
  it("une cible qui vise déjà un autre compte n'est pas écrasée", () => {
    const m = { targets: [{ ...publiee.targets[0], accountId: insta._id }] };
    expect(cibleDeplacee(m, new Set([p1]), ancien._id, nouveau._id)).toBeNull();
  });
  it("legacy (une seule cible sur la mission)", () => {
    expect(cibleDeplacee({ publicationId: p1, accountId: ancien._id }, new Set([p1]), ancien._id, nouveau._id)).toEqual({
      accountId: nouveau._id,
    });
  });
});

describe("deplacerPostsCore", () => {
  it("réécrit le handle des posts ET le compte des cibles ; l'aller-retour rend l'état d'origine", async () => {
    const docs = new Map<string, Record<string, unknown>>([
      ["p1", { _id: "p1", compte: "@ilosnitchy", plateforme: "TikTok" }],
      ["a1", { _id: "a1", targets: [{ platform: "TikTok", accountId: ancien._id, publicationId: "p1" }] }],
    ]);
    const origine = JSON.stringify([...docs.values()]);
    const db = {
      patch: async (id: string, patch: Record<string, unknown>) => {
        docs.set(id, { ...docs.get(id), ...patch });
      },
    } as unknown as Parameters<typeof deplacerPostsCore>[0]["db"];
    const lire = () => ({
      posts: [docs.get("p1")] as unknown as Doc<"publications">[],
      missions: [docs.get("a1")] as unknown as Doc<"assignments">[],
    });

    await deplacerPostsCore({ db }, lire().posts, lire().missions, ancien._id, nouveau);
    expect(docs.get("p1")!.compte).toBe("@ilosnytch");
    expect((docs.get("a1")!.targets as { accountId: string }[])[0].accountId).toBe(nouveau._id);

    await deplacerPostsCore({ db }, lire().posts, lire().missions, nouveau._id, ancien);
    expect(JSON.stringify([...docs.values()])).toBe(origine);
  });
});
