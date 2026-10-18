import { describe, it, expect } from "vitest";
import {
  identityOf,
  instagramProfileHandle,
  judgeInstagramOwner,
  normalizeHandle,
  ownerIsPubHandle,
  type CompteIdentity,
} from "../convex/instagramOwner";

/**
 * Les comptes et propriétaires ci-dessous sont recopiés de la prod (export et
 * runs Apify du 17-18/10/2026) : @ en casse mixte, URLs avec `?igsh=` et
 * `utm_source`, ids numériques en chaîne. C'est sur ces formes que la règle a
 * été mesurée — cf l'en-tête de `convex/instagramOwner.ts`.
 */

const QUENTIN: CompteIdentity = {
  _id: "compte_quentin",
  handle: "@quentin.snytch",
  plateforme: "Instagram",
  url: "https://www.instagram.com/quentin.snytch/",
  creatorId: "creator_quentin",
};
const KELLY_DGTL: CompteIdentity = {
  _id: "compte_kelly_dgtl",
  handle: "@kelly.dgtl",
  plateforme: "Instagram",
  url: "https://www.instagram.com/kelly.dgtl?igsh=MWw0ZG1mM3g2ZDY1cw%3D%3D&utm_source=qr",
  creatorId: "creator_kelly",
};
const KELLY_CHAPTERS: CompteIdentity = {
  _id: "compte_kelly_chapters",
  handle: "@thekellychapters",
  plateforme: "Instagram",
  url: "https://www.instagram.com/thekellychapters?stkn=MWZhMWl2Nzc4MmwwbQ%3D%3D&utm_source=qr",
  creatorId: "creator_kelly",
};
const CINTIA: CompteIdentity = {
  _id: "compte_cintia",
  handle: "@Cintia_secretacc",
  plateforme: "Instagram",
  url: "https://www.instagram.com/cintia_secretacc?igsi=d2g3cWdjYmdlemow&utm_source=qr",
  creatorId: "creator_cintia",
};

const PRINCIA = { ownerUsername: "princiaconfort", ownerId: "78077867125" };
const QUENTIN_OWNER = { ownerUsername: "quentin.snytch", ownerId: "26602946124" };

describe("normalizeHandle", () => {
  it("minuscules, sans @ ni espaces", () => {
    expect(normalizeHandle("@Sarah_snytch")).toBe("sarah_snytch");
    expect(normalizeHandle("  @Cintia_secretacc ")).toBe("cintia_secretacc");
    expect(normalizeHandle("princiaconfort")).toBe("princiaconfort");
  });
  it("vide ou absent → null, jamais une chaîne vide qui égalerait une autre", () => {
    expect(normalizeHandle("")).toBeNull();
    expect(normalizeHandle("@")).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
    expect(normalizeHandle(undefined)).toBeNull();
  });
});

describe("instagramProfileHandle", () => {
  it("lit le @ d'une URL de profil, traceurs et schéma absents compris", () => {
    expect(instagramProfileHandle(CINTIA.url)).toBe("cintia_secretacc");
    expect(
      instagramProfileHandle(
        "https://instagram.com/jujuublush?vrfl=bmNpdXM5YTl2cWs%3D&utm_source=qr",
      ),
    ).toBe("jujuublush");
    expect(instagramProfileHandle("www.instagram.com/Elena_secretacc1")).toBe(
      "elena_secretacc1",
    );
  });
  it("un lien de POST, d'une autre plateforme ou illisible n'est pas un profil", () => {
    expect(instagramProfileHandle("https://www.instagram.com/reel/Del5lejNGaI/")).toBeNull();
    expect(instagramProfileHandle("https://www.tiktok.com/@cintia_secretacc")).toBeNull();
    expect(instagramProfileHandle("pas une url")).toBeNull();
    expect(instagramProfileHandle(undefined)).toBeNull();
  });
});

describe("identityOf", () => {
  const comptes: CompteIdentity[] = [
    QUENTIN,
    KELLY_DGTL,
    KELLY_CHAPTERS,
    CINTIA,
    // Homonyme TikTok : le @ seul ne désigne pas un compte (cf recordAccountProfile).
    { _id: "tt_cintia", handle: "@Cintia_secretacc", plateforme: "TikTok", creatorId: "creator_cintia" },
    // Compte de l'équipe, sans créatrice.
    { _id: "ig_repackit", handle: "@repackit.io", plateforme: "Instagram" },
    { _id: "ig_hope", handle: "@hopemedia2026", plateforme: "Instagram" },
  ];

  it("le compte INSTAGRAM du @, et les autres comptes Instagram de sa créatrice", () => {
    const r = identityOf(comptes, "@thekellychapters");
    expect(r.compte?._id).toBe("compte_kelly_chapters");
    expect(r.siblings.map((c) => c._id)).toEqual(["compte_kelly_dgtl"]);
  });

  it("jamais l'homonyme TikTok, ni comme compte ni comme sœur", () => {
    const r = identityOf(comptes, "@Cintia_secretacc");
    expect(r.compte?._id).toBe("compte_cintia");
    expect(r.siblings).toEqual([]);
  });

  it("casse différente entre la publication et le compte → même compte", () => {
    expect(identityOf(comptes, "@cintia_secretacc").compte?._id).toBe("compte_cintia");
  });

  it("compte de l'équipe : ses sœurs sont les autres comptes sans créatrice", () => {
    const r = identityOf(comptes, "@repackit.io");
    expect(r.compte?._id).toBe("ig_repackit");
    expect(r.siblings.map((c) => c._id)).toEqual(["ig_hope"]);
  });

  it("publication sans ligne `comptes` (compte supprimé, saisie à la main) → rien", () => {
    expect(identityOf(comptes, "@ladidi_secretacc")).toEqual({ compte: null, siblings: [] });
  });
});

describe("ownerIsPubHandle", () => {
  it("compare le propriétaire au @ de la publication, normalisés", () => {
    expect(ownerIsPubHandle("sarah_snytch", "@Sarah_snytch")).toBe(true);
    expect(ownerIsPubHandle("princiaconfort", "@quentin.snytch")).toBe(false);
    expect(ownerIsPubHandle(null, "@quentin.snytch")).toBe(false);
  });
});

describe("judgeInstagramOwner", () => {
  it("LE CAS DU 18/10 : reel de @princiaconfort sur un compte confirmé → étranger", () => {
    const v = judgeInstagramOwner({
      owner: PRINCIA,
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "foreign", ownerUsername: "princiaconfort" });
  });

  it("le même reel sur un compte JAMAIS confirmé → inconnu (rien n'est prouvé)", () => {
    const v = judgeInstagramOwner({
      owner: PRINCIA,
      pubHandle: "@quentin.snytch",
      compte: QUENTIN,
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("propriétaire = le @ du compte → à elle, et son id est APPRIS", () => {
    const v = judgeInstagramOwner({
      owner: QUENTIN_OWNER,
      pubHandle: "@quentin.snytch",
      compte: QUENTIN,
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", learnOwnerId: "26602946124" });
  });

  it("id déjà appris → à elle, rien de plus à apprendre", () => {
    const v = judgeInstagramOwner({
      owner: QUENTIN_OWNER,
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", learnOwnerId: null });
  });

  it("@ en casse mixte en base (« @Sarah_snytch ») → à elle", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: "sarah_snytch", ownerId: "15422485402" },
      pubHandle: "@Sarah_snytch",
      compte: {
        _id: "compte_sarah",
        handle: "@Sarah_snytch",
        plateforme: "Instagram",
        url: "https://www.instagram.com/sarah_snytch/",
        creatorId: "creator_sarah",
        instagramOwnerIds: ["15422485402"],
      },
      siblings: [],
    });
    expect(v.kind).toBe("own");
  });

  it("compte RENOMMÉ sur Instagram : nouveau @, même id appris → à elle", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: "sarah_olv8", ownerId: "15422485402" },
      pubHandle: "@Sarah_snytch",
      compte: {
        _id: "compte_sarah",
        handle: "@Sarah_snytch",
        plateforme: "Instagram",
        creatorId: "creator_sarah",
        instagramOwnerIds: ["15422485402"],
      },
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", learnOwnerId: null });
  });

  it("@ du compte ≠ @ de l'URL : l'URL de profil désigne aussi le compte", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: "kellyleydie", ownerId: "111" },
      pubHandle: "@kelly.leydie",
      compte: {
        _id: "compte_kl",
        handle: "@kelly.leydie",
        plateforme: "Instagram",
        url: "https://www.instagram.com/kellyleydie/",
        instagramOwnerIds: ["999"],
      },
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", learnOwnerId: "111" });
  });

  it("CAS KELLY : reel de son AUTRE compte, rattaché au compte confirmé → à elle", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: "kelly.dgtl", ownerId: "38218721749" },
      pubHandle: "@thekellychapters",
      compte: { ...KELLY_CHAPTERS, instagramOwnerIds: ["14203951160"] },
      siblings: [KELLY_DGTL],
    });
    // À elle, mais l'id de @kelly.dgtl n'est PAS appris sur @thekellychapters :
    // ce n'est pas l'identité de ce compte-là.
    expect(v).toEqual({ kind: "own", learnOwnerId: null });
  });

  it("CAS KELLY, compte sœur renommé : reconnu par l'id appris sur la sœur", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: "kelly.renamed", ownerId: "38218721749" },
      pubHandle: "@thekellychapters",
      compte: { ...KELLY_CHAPTERS, instagramOwnerIds: ["14203951160"] },
      siblings: [{ ...KELLY_DGTL, instagramOwnerIds: ["38218721749"] }],
    });
    expect(v.kind).toBe("own");
  });

  it("CAS CINTIA : @ en base jamais le bon, compte jamais confirmé → inconnu, relevé", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: "cintia.secretaa", ownerId: "38617191230" },
      pubHandle: "@Cintia_secretacc",
      compte: CINTIA,
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("propriétaire ABSENT → inconnu, même sur un compte confirmé", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: null, ownerId: null },
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("id ABSENT : un renommage ne peut pas être exclu → inconnu", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: "princiaconfort", ownerId: null },
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("drapeau déjà posé sur CE lien : un run sans propriétaire ne le lève pas", () => {
    const v = judgeInstagramOwner({
      owner: { ownerUsername: null, ownerId: null },
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
      flaggedOwner: "princiaconfort",
    });
    expect(v).toEqual({ kind: "foreign", ownerUsername: "princiaconfort" });
  });

  it("drapeau déjà posé, mais le post est PROUVÉ à elle → à elle (le drapeau tombe)", () => {
    const v = judgeInstagramOwner({
      owner: QUENTIN_OWNER,
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
      flaggedOwner: "princiaconfort",
    });
    expect(v.kind).toBe("own");
  });

  it("publication sans ligne `comptes` : @ égal → à elle (rien à apprendre) ; sinon inconnu", () => {
    expect(
      judgeInstagramOwner({
        owner: { ownerUsername: "sophia_seceretacc", ownerId: "36637622489" },
        pubHandle: "@Sophia_seceretacc",
        compte: null,
        siblings: [],
      }),
    ).toEqual({ kind: "own", learnOwnerId: null });
    expect(
      judgeInstagramOwner({
        owner: PRINCIA,
        pubHandle: "@ladidi_secretacc",
        compte: null,
        siblings: [],
      }),
    ).toEqual({ kind: "unknown" });
  });
});
