import { describe, expect, it } from "vitest";
// Modules PURS de convex/ importés en relatif (comme lib/remunerate.test.ts).
import { postKeyOf } from "../convex/postUrlShape";
import { cleDeLienPost } from "../convex/mcpWriteArgs";
import {
  accountOwnsLink,
  duplicateGroups,
  splitDuplicates,
  storedPostKey,
} from "../convex/postDuplicateGuard";
import * as convexRemunerate from "../convex/remunerate";
import { isRemunerated, payFlagsOfPublication } from "./remunerate";
import { payableAssignmentViews } from "./pricing-engine";

// Liens à la forme de la PROD (19/11/2026) : paramètres de partage, @ dans le
// chemin, liens courts — jamais la forme idéale seule.
const KELLY_TT =
  "https://www.tiktok.com/@thekellychapters_/video/7680276052102401313?_r=1&_t=ZN-8zG3bXq0nKp";
const KELLY_TT_NU = "https://www.tiktok.com/@thekellychapters_/video/7680276052102401313";
const NAIA_IG_1 = "https://www.instagram.com/reel/DfS8-i2tqyM/?cplk=ZWJyaWFpbHpiZDN1";
const NAIA_IG_2 = "https://www.instagram.com/naia.snytch/reel/DfS8-i2tqyM/?igsh=MTF5NXlmanZienRhdQ==";

describe("postKeyOf — la vidéo derrière le lien", () => {
  it("TikTok : l'id, quels que soient les paramètres de partage", () => {
    expect(postKeyOf(KELLY_TT)).toBe("tiktok:7680276052102401313");
    expect(postKeyOf(KELLY_TT_NU)).toBe(postKeyOf(KELLY_TT));
    expect(postKeyOf("https://www.tiktok.com/@kellyleydie/photo/7674657081571478817")).toBe(
      "tiktok:7674657081571478817",
    );
  });

  it("Instagram : le shortcode, avec ou sans @ devant, reel ou p", () => {
    expect(postKeyOf(NAIA_IG_1)).toBe("instagram:DfS8-i2tqyM");
    expect(postKeyOf(NAIA_IG_2)).toBe("instagram:DfS8-i2tqyM");
    expect(postKeyOf("https://www.instagram.com/p/DfS8-i2tqyM/")).toBe("instagram:DfS8-i2tqyM");
  });

  it("deux vidéos différentes ne partagent jamais une clé", () => {
    expect(postKeyOf("https://www.instagram.com/reel/DfVKhxPNXs0/?srtk=MW9l")).not.toBe(
      postKeyOf(NAIA_IG_1),
    );
    expect(postKeyOf("https://www.tiktok.com/@naia.snytch/video/7704077291558571286")).not.toBe(
      postKeyOf(KELLY_TT),
    );
  });

  it("lien court TikTok : sa clé est son adresse — deux partages, deux clés", () => {
    // Le cas qui impose de RÉSOUDRE avant la garde : 14 doublons sur 19 en prod.
    const a = postKeyOf("https://vm.tiktok.com/ZN8FgX8xN/");
    const b = postKeyOf("https://vm.tiktok.com/ZN8FpyAqj/");
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
    expect(postKeyOf("https://vm.tiktok.com/ZN8FgX8xN/")).toBe(a);
  });

  it("pas un lien → null ; la clé stockée d'une publication sans lien est vide", () => {
    expect(postKeyOf("")).toBeNull();
    expect(postKeyOf("pas un lien")).toBeNull();
    expect(storedPostKey(undefined)).toBe("");
    expect(storedPostKey("")).toBe("");
    expect(storedPostKey(NAIA_IG_1)).toBe("instagram:DfS8-i2tqyM");
  });

  it("l'outil MCP désigne un post avec la MÊME clé que la garde", () => {
    for (const u of [KELLY_TT, NAIA_IG_2, "https://youtube.com/shorts/abc123XYZ", "https://vt.tiktok.com/ZSqyHRGFk/"]) {
      expect(cleDeLienPost(u)).toBe(postKeyOf(u));
    }
  });
});

describe("splitDuplicates — qui garde les vues (arbitrage du 19/11/2026)", () => {
  const pub = (id: string, t: number, compte: string, postUrl: string) => ({
    _id: id,
    _creationTime: t,
    compte,
    postUrl,
  });

  it("TikTok : le compte qui POSSÈDE la vidéo garde, même créé après", () => {
    // Cas réel : 837 500 vues, publication @kellyleydie créée la première.
    const surAutreCompte = pub("dgq9z", 1_000, "@kellyleydie", KELLY_TT);
    const proprietaire = pub("dhh5d", 2_000, "@thekellychapters_", KELLY_TT);
    expect(accountOwnsLink(surAutreCompte)).toBe(false);
    expect(accountOwnsLink(proprietaire)).toBe(true);
    const { keeper, extras } = splitDuplicates([surAutreCompte, proprietaire]);
    expect(keeper._id).toBe("dhh5d");
    expect(extras.map((e) => e._id)).toEqual(["dgq9z"]);
  });

  it("même compte : la plus ancienne garde", () => {
    const g = splitDuplicates([
      pub("hkd14", 3_000, "@naia.snytch", NAIA_IG_1),
      pub("hh7a2", 1_000, "@naia.snytch", NAIA_IG_2),
      pub("hnm8n", 5_000, "@naia.snytch", NAIA_IG_1),
    ]);
    expect(g.keeper._id).toBe("hh7a2");
    expect(g.extras.map((e) => e._id)).toEqual(["hkd14", "hnm8n"]);
  });

  it("Instagram : le compte ne se lit pas dans le lien → la plus ancienne", () => {
    expect(accountOwnsLink({ compte: "@kelly.dgtl", postUrl: NAIA_IG_1 })).toBeNull();
    const g = splitDuplicates([
      pub("b", 2_000, "@thekellychapters", NAIA_IG_1),
      pub("a", 2_000, "@kelly.dgtl", NAIA_IG_1),
    ]);
    // À égalité d'ancienneté : l'id départage, pour qu'un rejeu rende la même.
    expect(g.keeper._id).toBe("a");
  });

  it("handle avec majuscules et @ : même compte", () => {
    expect(
      accountOwnsLink({
        compte: "@Irisdiaries101",
        postUrl: "https://www.tiktok.com/@irisdiaries101/video/7687811348679413013?_r=1",
      }),
    ).toBe(true);
  });
});

describe("duplicateGroups — sur le lien ACTUEL, pas la clé stockée", () => {
  it("regroupe par vidéo, ignore les uniques et les publications sans lien", () => {
    const groupes = duplicateGroups([
      { _id: "1", _creationTime: 1, compte: "@naia.snytch", postUrl: NAIA_IG_1 },
      { _id: "2", _creationTime: 2, compte: "@naia.snytch", postUrl: NAIA_IG_2 },
      { _id: "3", _creationTime: 3, compte: "@naia.snytch", postUrl: "https://www.instagram.com/reel/DfVKhxPNXs0/" },
      { _id: "4", _creationTime: 4, compte: "@naia.snytch", postUrl: undefined },
      { _id: "5", _creationTime: 5, compte: "@naia.snytch", postUrl: "" },
    ]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].key).toBe("instagram:DfS8-i2tqyM");
    expect(groupes[0].keeper._id).toBe("1");
    expect(groupes[0].extras.map((e) => e._id)).toEqual(["2"]);
  });
});

describe("payFlagsOfPublication — un doublon ne paie rien", () => {
  it("doublon → non rémunéré, même marqué rémunéré à la main", () => {
    const flags = payFlagsOfPublication({
      isWarmup: true,
      remunere: true,
      duplicateOf: { publicationId: "x", at: 1 },
    });
    expect(isRemunerated(flags)).toBe(false);
  });

  it("hors doublon → les drapeaux tels quels (cas Kelly, promo, chauffe)", () => {
    expect(isRemunerated(payFlagsOfPublication({ isWarmup: true, remunere: true }))).toBe(true);
    expect(isRemunerated(payFlagsOfPublication({ isWarmup: false }))).toBe(true);
    expect(isRemunerated(payFlagsOfPublication({ isWarmup: true }))).toBe(false);
    expect(isRemunerated(payFlagsOfPublication({}))).toBe(true);
  });

  it("réplique serveur STRICTEMENT identique", () => {
    for (const isWarmup of [undefined, true, false]) {
      for (const remunere of [undefined, true, false]) {
        for (const duplicateOf of [undefined, { publicationId: "x", at: 1 }]) {
          const pub = { isWarmup, remunere, duplicateOf };
          expect(convexRemunerate.payFlagsOfPublication(pub)).toEqual(payFlagsOfPublication(pub));
        }
      }
    }
  });

  it("fixe : une mission dont TOUS les posts sont des doublons ne paie plus son fixe", () => {
    const dup = { publicationId: "keeper", at: 1 };
    // Naia, 4 missions « Format parlé España » : TikTok ET Instagram en double.
    const toutEnDouble = payableAssignmentViews([
      { ...payFlagsOfPublication({ duplicateOf: dup }), views: 0 },
      { ...payFlagsOfPublication({ duplicateOf: dup }), views: 0 },
    ]);
    expect(toutEnDouble.hasPayablePost).toBe(false);
    // …mais une mission qui garde UN post à elle reste payée au fixe.
    const unPostAElle = payableAssignmentViews([
      { ...payFlagsOfPublication({ duplicateOf: dup }), views: 0 },
      { ...payFlagsOfPublication({}), views: 204 },
    ]);
    expect(unPostAElle.hasPayablePost).toBe(true);
    expect(unPostAElle.payableViews).toBe(204);
  });
});

describe("isVideoKey — seule une clé à identifiant prouve un doublon après coup", () => {
  it("vidéo TikTok / Instagram / YouTube : oui ; accueil TikTok, lien court : non", async () => {
    const { isVideoKey } = await import("../convex/postUrlShape");
    expect(isVideoKey(postKeyOf(KELLY_TT))).toBe(true);
    expect(isVideoKey(postKeyOf(NAIA_IG_1))).toBe(true);
    expect(isVideoKey(postKeyOf("https://youtu.be/abc123XYZ"))).toBe(true);
    // Un lien court mort mène à l'accueil : deux liens morts ≠ même vidéo.
    expect(isVideoKey(postKeyOf("https://www.tiktok.com/"))).toBe(false);
    expect(isVideoKey(postKeyOf("https://vm.tiktok.com/ZN8FgX8xN/"))).toBe(false);
    expect(isVideoKey(null)).toBe(false);
  });
});
