import { describe, it, expect } from "vitest";
import {
  identityOf,
  instagramProfileHandle,
  judgePostOwner,
  learnedOwnerIds,
  normalizeHandle,
  ownerIsPubHandle,
  tiktokProfileHandle,
  type CompteIdentity,
} from "../convex/postOwner";

/**
 * Les comptes et propriétaires ci-dessous sont recopiés de la prod (export et
 * runs Apify du 17-18/10/2026) : @ en casse mixte, URLs avec `?igsh=` et
 * `utm_source`, ids numériques en chaîne. C'est sur ces formes que la règle a
 * été mesurée — cf l'en-tête de `convex/postOwner.ts`.
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
    const r = identityOf(comptes, "@thekellychapters", "Instagram");
    expect(r.compte?._id).toBe("compte_kelly_chapters");
    expect(r.siblings.map((c) => c._id)).toEqual(["compte_kelly_dgtl"]);
  });

  it("jamais l'homonyme TikTok, ni comme compte ni comme sœur", () => {
    const r = identityOf(comptes, "@Cintia_secretacc", "Instagram");
    expect(r.compte?._id).toBe("compte_cintia");
    expect(r.siblings).toEqual([]);
  });

  it("casse différente entre la publication et le compte → même compte", () => {
    expect(identityOf(comptes, "@cintia_secretacc", "Instagram").compte?._id).toBe("compte_cintia");
  });

  it("compte de l'équipe : ses sœurs sont les autres comptes sans créatrice", () => {
    const r = identityOf(comptes, "@repackit.io", "Instagram");
    expect(r.compte?._id).toBe("ig_repackit");
    expect(r.siblings.map((c) => c._id)).toEqual(["ig_hope"]);
  });

  it("publication sans ligne `comptes` (compte supprimé, saisie à la main) → rien", () => {
    expect(identityOf(comptes, "@ladidi_secretacc", "Instagram")).toEqual({ compte: null, siblings: [] });
  });
});

describe("ownerIsPubHandle", () => {
  it("compare le propriétaire au @ de la publication, normalisés", () => {
    expect(ownerIsPubHandle("sarah_snytch", "@Sarah_snytch")).toBe(true);
    expect(ownerIsPubHandle("princiaconfort", "@quentin.snytch")).toBe(false);
    expect(ownerIsPubHandle(null, "@quentin.snytch")).toBe(false);
  });
});

describe("judgePostOwner", () => {
  it("LE CAS DU 18/10 : reel de @princiaconfort sur un compte confirmé → étranger", () => {
    const v = judgePostOwner({
      owner: PRINCIA,
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "foreign", ownerUsername: "princiaconfort" });
  });

  it("le même reel sur un compte JAMAIS confirmé → inconnu (rien n'est prouvé)", () => {
    const v = judgePostOwner({
      owner: PRINCIA,
      pubHandle: "@quentin.snytch",
      compte: QUENTIN,
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("propriétaire = le @ du compte → à elle, et son id est APPRIS", () => {
    const v = judgePostOwner({
      owner: QUENTIN_OWNER,
      pubHandle: "@quentin.snytch",
      compte: QUENTIN,
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", account: "self", learnOwnerId: "26602946124" });
  });

  it("id déjà appris → à elle, rien de plus à apprendre", () => {
    const v = judgePostOwner({
      owner: QUENTIN_OWNER,
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", account: "self", learnOwnerId: null });
  });

  it("@ en casse mixte en base (« @Sarah_snytch ») → à elle", () => {
    const v = judgePostOwner({
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
    const v = judgePostOwner({
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
    expect(v).toEqual({ kind: "own", account: "self", learnOwnerId: null });
  });

  it("@ du compte ≠ @ de l'URL : l'URL de profil désigne aussi le compte", () => {
    const v = judgePostOwner({
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
    expect(v).toEqual({ kind: "own", account: "self", learnOwnerId: "111" });
  });

  it("CAS KELLY : reel de son AUTRE compte, rattaché au compte confirmé → à elle", () => {
    const v = judgePostOwner({
      owner: { ownerUsername: "kelly.dgtl", ownerId: "38218721749" },
      pubHandle: "@thekellychapters",
      compte: { ...KELLY_CHAPTERS, instagramOwnerIds: ["14203951160"] },
      siblings: [KELLY_DGTL],
    });
    // À elle, mais l'id de @kelly.dgtl n'est PAS appris sur @thekellychapters :
    // ce n'est pas l'identité de ce compte-là — ni son profil (« sibling »).
    expect(v).toEqual({ kind: "own", account: "sibling", learnOwnerId: null });
  });

  it("CAS KELLY, compte sœur renommé : reconnu par l'id appris sur la sœur", () => {
    const v = judgePostOwner({
      owner: { ownerUsername: "kelly.renamed", ownerId: "38218721749" },
      pubHandle: "@thekellychapters",
      compte: { ...KELLY_CHAPTERS, instagramOwnerIds: ["14203951160"] },
      siblings: [{ ...KELLY_DGTL, instagramOwnerIds: ["38218721749"] }],
    });
    expect(v).toEqual({ kind: "own", account: "sibling", learnOwnerId: null });
  });

  it("CAS CINTIA : @ en base jamais le bon, compte jamais confirmé → inconnu, relevé", () => {
    const v = judgePostOwner({
      owner: { ownerUsername: "cintia.secretaa", ownerId: "38617191230" },
      pubHandle: "@Cintia_secretacc",
      compte: CINTIA,
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("propriétaire ABSENT → inconnu, même sur un compte confirmé", () => {
    const v = judgePostOwner({
      owner: { ownerUsername: null, ownerId: null },
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("id ABSENT : un renommage ne peut pas être exclu → inconnu", () => {
    const v = judgePostOwner({
      owner: { ownerUsername: "princiaconfort", ownerId: null },
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("drapeau déjà posé sur CE lien : un run sans propriétaire ne le lève pas", () => {
    const v = judgePostOwner({
      owner: { ownerUsername: null, ownerId: null },
      pubHandle: "@quentin.snytch",
      compte: { ...QUENTIN, instagramOwnerIds: ["26602946124"] },
      siblings: [],
      flaggedOwner: "princiaconfort",
    });
    expect(v).toEqual({ kind: "foreign", ownerUsername: "princiaconfort" });
  });

  it("drapeau déjà posé, mais le post est PROUVÉ à elle → à elle (le drapeau tombe)", () => {
    const v = judgePostOwner({
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
      judgePostOwner({
        owner: { ownerUsername: "sophia_seceretacc", ownerId: "36637622489" },
        pubHandle: "@Sophia_seceretacc",
        compte: null,
        siblings: [],
      }),
    ).toEqual({ kind: "own", account: "self", learnOwnerId: null });
    expect(
      judgePostOwner({
        owner: PRINCIA,
        pubHandle: "@ladidi_secretacc",
        compte: null,
        siblings: [],
      }),
    ).toEqual({ kind: "unknown" });
  });
});

/**
 * TIKTOK — comptes et auteurs recopiés de la prod : export du 18/10/2026 et
 * page publique de chaque publication relevée le même jour (`author.uniqueId`,
 * `author.id`). TikTok sert la vidéo par son id et ignore le @ de l'URL : seul
 * l'auteur de la page dit à qui est le post.
 */
const TT_SARAH: CompteIdentity = {
  _id: "tt_sarah",
  // Le @ en base est l'ANCIEN nom : la page dit @sarah_snytch.
  handle: "@sarah_olv8",
  plateforme: "TikTok",
  url: "https://www.tiktok.com/@sarah_olv8?_r=1&_t=ZG-9AFBfPBzHxh",
  creatorId: "creator_sarah_dc",
};
const IG_SARAH: CompteIdentity = {
  _id: "ig_sarah",
  handle: "@Sarah_snytch",
  plateforme: "Instagram",
  url: "https://www.instagram.com/sarah_snytch/",
  creatorId: "creator_sarah_dc",
};
const TT_KELLY_LEYDIE: CompteIdentity = {
  _id: "tt_kelly_leydie",
  handle: "@kellyleydie",
  plateforme: "TikTok",
  url: "https://www.tiktok.com/@kellyleydie?_r=1&_t=ZN-97cTIQPRhf4",
  creatorId: "creator_kelly",
};
const TT_KELLY_CHAPTERS: CompteIdentity = {
  _id: "tt_kelly_chapters",
  handle: "@thekellychapters_",
  plateforme: "TikTok",
  url: "https://www.tiktok.com/@thekellychapters_?_r=1&_t=ZN-98vfgYhTO0Q",
  creatorId: "creator_kelly",
};
const TT_MARINE: CompteIdentity = {
  _id: "tt_marine",
  handle: "@marine.bn07",
  plateforme: "TikTok",
  url: "https://www.tiktok.com/@marine.bn07",
  creatorId: "creator_marine",
};
const TT_MARIE: CompteIdentity = {
  _id: "tt_marie",
  handle: "@marriyaaahsmile",
  plateforme: "TikTok",
  url: "https://www.tiktok.com/@marriyaaahsmile?_r=1&_t=ZN-99ZHUkG4eHu",
  creatorId: "creator_marie",
};
const AUTEUR = {
  sarahSnytch: { ownerUsername: "sarah_snytch", ownerId: "7690714507761468438" },
  kellyleydie: { ownerUsername: "kellyleydie", ownerId: "7656852187148796931" },
  thekellychapters: { ownerUsername: "thekellychapters_", ownerId: "7673976005312971798" },
  marriyaaahsmile: { ownerUsername: "marriyaaahsmile", ownerId: "7683186780840985622" },
  marieRvlation: { ownerUsername: "marie.rvlation", ownerId: "7678007501723485206" },
  // Vidéo 7676941579743005984 : supprimée depuis, la page ne rend plus d'id.
  sarahkl02: { ownerUsername: "sarahkl02", ownerId: "7600000000000000002" },
};

describe("tiktokProfileHandle", () => {
  it("lit le @ d'une URL de profil TikTok, traceurs de partage compris", () => {
    expect(tiktokProfileHandle(TT_SARAH.url)).toBe("sarah_olv8");
    expect(tiktokProfileHandle("tiktok.com/@Marine.bn07")).toBe("marine.bn07");
  });
  it("sans @, lien de vidéo, autre plateforme : pas un profil TikTok", () => {
    // Forme vue en base sur @sarahkl02 : sans @, ce n'est pas une adresse TikTok.
    expect(tiktokProfileHandle("www.tiktok.com/julie.kl31")).toBeNull();
    expect(
      tiktokProfileHandle("https://www.tiktok.com/@sarah_snytch/video/7697209634930642209"),
    ).toBeNull();
    expect(tiktokProfileHandle(IG_SARAH.url)).toBeNull();
    expect(tiktokProfileHandle(undefined)).toBeNull();
  });
});

describe("TikTok — identité du compte", () => {
  it("le compte TIKTOK du @ et ses sœurs TikTok, jamais l'homonyme Instagram", () => {
    const comptes = [TT_SARAH, IG_SARAH, TT_KELLY_LEYDIE, TT_KELLY_CHAPTERS];
    const kelly = identityOf(comptes, "@kellyleydie", "TikTok");
    expect(kelly.compte?._id).toBe("tt_kelly_leydie");
    expect(kelly.siblings.map((c) => c._id)).toEqual(["tt_kelly_chapters"]);
    // @Sarah_snytch existe en Instagram, chez la même créatrice : ce n'est pas
    // un compte TikTok, ni une sœur de @sarah_olv8.
    expect(identityOf(comptes, "@sarah_olv8", "TikTok")).toEqual({
      compte: TT_SARAH,
      siblings: [],
    });
  });

  it("les ids appris se lisent sur la plateforme du compte, jamais sur l'autre", () => {
    expect(learnedOwnerIds({ ...TT_SARAH, tiktokOwnerIds: ["1"], instagramOwnerIds: ["2"] })).toEqual(["1"]);
    expect(learnedOwnerIds({ ...IG_SARAH, tiktokOwnerIds: ["1"], instagramOwnerIds: ["2"] })).toEqual(["2"]);
  });
});

describe("judgePostOwner — TikTok", () => {
  it("CAS MARINE (22/08) : vidéo de @sarahkl02, autre créatrice, sur un compte confirmé → étranger", () => {
    const v = judgePostOwner({
      owner: AUTEUR.sarahkl02,
      pubHandle: "@marine.bn07",
      compte: { ...TT_MARINE, tiktokOwnerIds: ["7600000000000000001"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "foreign", ownerUsername: "sarahkl02" });
  });

  it("la même vidéo sur un compte JAMAIS confirmé → inconnu (rien n'est prouvé)", () => {
    const v = judgePostOwner({
      owner: AUTEUR.sarahkl02,
      pubHandle: "@marine.bn07",
      compte: TT_MARINE,
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("auteur = le @ du compte → à elle, et l'id de la page est APPRIS", () => {
    const v = judgePostOwner({
      owner: AUTEUR.marriyaaahsmile,
      pubHandle: "@marriyaaahsmile",
      compte: TT_MARIE,
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", account: "self", learnOwnerId: "7683186780840985622" });
  });

  it("CAS SARAH : @ en base = ancien nom, compte jamais confirmé → inconnu, relevé (21 vidéos)", () => {
    const v = judgePostOwner({
      owner: AUTEUR.sarahSnytch,
      pubHandle: "@sarah_olv8",
      compte: TT_SARAH,
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });

  it("CAS SARAH, compte confirmé avant le renommage : même id → à elle", () => {
    const v = judgePostOwner({
      owner: AUTEUR.sarahSnytch,
      pubHandle: "@sarah_olv8",
      compte: { ...TT_SARAH, tiktokOwnerIds: ["7690714507761468438"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "own", account: "self", learnOwnerId: null });
  });

  it("CAS KELLY : vidéo de @kellyleydie rattachée à @thekellychapters_ → à elle, compte sœur", () => {
    const v = judgePostOwner({
      owner: AUTEUR.kellyleydie,
      pubHandle: "@thekellychapters_",
      compte: { ...TT_KELLY_CHAPTERS, tiktokOwnerIds: ["7673976005312971798"] },
      siblings: [TT_KELLY_LEYDIE],
    });
    // « sibling » : ses vues sont à Kelly, ses abonnés sont ceux de @kellyleydie.
    expect(v).toEqual({ kind: "own", account: "sibling", learnOwnerId: null });
  });

  it("CAS MARIE : compte confirmé, vidéo d'un compte qu'elle n'a pas déclaré → étranger…", () => {
    const v = judgePostOwner({
      owner: AUTEUR.marieRvlation,
      pubHandle: "@marriyaaahsmile",
      compte: { ...TT_MARIE, tiktokOwnerIds: ["7683186780840985622"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "foreign", ownerUsername: "marie.rvlation" });
  });

  it("…jusqu'à ce que ce compte soit déclaré à son nom : alors compte sœur, à elle", () => {
    const v = judgePostOwner({
      owner: AUTEUR.marieRvlation,
      pubHandle: "@marriyaaahsmile",
      compte: { ...TT_MARIE, tiktokOwnerIds: ["7683186780840985622"] },
      siblings: [
        { _id: "tt_marie2", handle: "@marie.rvlation", plateforme: "TikTok", creatorId: "creator_marie" },
      ],
    });
    expect(v).toEqual({ kind: "own", account: "sibling", learnOwnerId: null });
  });

  it("un id Instagram appris ne confirme PAS un compte TikTok", () => {
    const v = judgePostOwner({
      owner: AUTEUR.sarahkl02,
      pubHandle: "@marine.bn07",
      compte: { ...TT_MARINE, instagramOwnerIds: ["26602946124"] },
      siblings: [],
    });
    expect(v).toEqual({ kind: "unknown" });
  });
});
