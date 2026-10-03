import { describe, it, expect } from "vitest";
import { compteProfileUrl, lienDiffereDuHandle } from "./compte-profile-url";

// Les entrées reprennent la FORME des comptes de production (2026-09-24) :
// handle avec point, URL de partage chargée de traceurs, URL sans schéma,
// casse mixte.

describe("compteProfileUrl — l'URL collée prime quand elle désigne un compte", () => {
  it("TikTok : le handle affiché diffère du vrai compte (cas @kelly.leydie)", () => {
    expect(
      compteProfileUrl({
        plateforme: "TikTok",
        handle: "@kelly.leydie",
        url: "https://www.tiktok.com/@kellyleydie?_r=1&_t=ZN-97cTIQPRhf4",
      }),
    ).toBe("https://www.tiktok.com/@kellyleydie");
  });

  it("Instagram : les paramètres de partage sont retirés", () => {
    expect(
      compteProfileUrl({
        plateforme: "Instagram",
        handle: "@kelly.dgtl",
        url: "https://www.instagram.com/kelly.dgtl?igsh=MWw0ZG1mM3g2ZDY1cw%3D%3D",
      }),
    ).toBe("https://www.instagram.com/kelly.dgtl/");
  });

  it("un lien de POST collé à la place du profil donne quand même le compte", () => {
    expect(
      compteProfileUrl({
        plateforme: "TikTok",
        handle: "@ang_creates",
        url: "https://www.tiktok.com/@ang_creates/video/7418820013112345678",
      }),
    ).toBe("https://www.tiktok.com/@ang_creates");
  });

  it("YouTube : une URL de chaîne par identifiant est gardée telle quelle", () => {
    expect(
      compteProfileUrl({
        plateforme: "YouTube",
        handle: "@anthotest",
        url: "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw?si=abc",
      }),
    ).toBe("https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw");
  });
});

describe("compteProfileUrl — Facebook et Snapchat", () => {
  it("Facebook : un lien de vidéo de Page donne la Page, sans traceur", () => {
    expect(
      compteProfileUrl({
        plateforme: "Facebook",
        handle: "Kelly Snytch",
        url: "https://m.facebook.com/kelly.snytch/videos/1284539976120931/?mibextid=wwXIfr",
      }),
    ).toBe("https://www.facebook.com/kelly.snytch");
  });

  it("Facebook : un profil sans nom d'utilisateur garde son identifiant numérique", () => {
    expect(
      compteProfileUrl({
        plateforme: "Facebook",
        handle: "Kelly Martin",
        url: "https://www.facebook.com/profile.php?id=61554471234567&mibextid=ZbWKwL",
      }),
    ).toBe("https://www.facebook.com/profile.php?id=61554471234567");
  });

  it("Snapchat : l'adresse /add/ est reconstruite sans les paramètres de partage", () => {
    expect(
      compteProfileUrl({
        plateforme: "Snapchat",
        handle: "@kelly.snytch",
        url: "https://www.snapchat.com/add/kelly.snytch?share_id=MTIzNDU2&locale=fr-FR",
      }),
    ).toBe("https://www.snapchat.com/add/kelly.snytch");
  });

  it("Snapchat : sans URL, le handle mène au profil public", () => {
    expect(
      compteProfileUrl({ plateforme: "Snapchat", handle: "@kelly.snytch", url: null }),
    ).toBe("https://www.snapchat.com/add/kelly.snytch");
  });

  it("un Reel Facebook (sans nom de compte) laisse le handle reprendre la main", () => {
    expect(
      compteProfileUrl({
        plateforme: "Facebook",
        handle: "kelly.snytch",
        url: "https://www.facebook.com/reel/1284539976120931",
      }),
    ).toBe("https://www.facebook.com/kelly.snytch");
  });
});

describe("compteProfileUrl — le handle reprend la main quand l'URL ne désigne rien", () => {
  it("URL sans schéma ni @ (cas @sarahkl02 → www.tiktok.com/julie.kl31)", () => {
    expect(
      compteProfileUrl({
        plateforme: "TikTok",
        handle: "@sarahkl02",
        url: "www.tiktok.com/julie.kl31",
      }),
    ).toBe("https://www.tiktok.com/@sarahkl02");
  });

  it("URL d'une AUTRE plateforme que celle du compte", () => {
    expect(
      compteProfileUrl({
        plateforme: "TikTok",
        handle: "@introvertgela",
        url: "https://www.instagram.com/introvertgela",
      }),
    ).toBe("https://www.tiktok.com/@introvertgela");
  });

  it("pas d'URL du tout (cas @julia.ty05)", () => {
    expect(
      compteProfileUrl({ plateforme: "TikTok", handle: "@julia.ty05" }),
    ).toBe("https://www.tiktok.com/@julia.ty05");
    expect(
      compteProfileUrl({
        plateforme: "Instagram",
        handle: "@Elizabeth.snytch",
        url: null,
      }),
    ).toBe("https://www.instagram.com/Elizabeth.snytch/");
    expect(
      compteProfileUrl({ plateforme: "YouTube", handle: "anthotest", url: "" }),
    ).toBe("https://www.youtube.com/@anthotest");
  });
});

describe("compteProfileUrl — aucun lien plutôt qu'un lien mort", () => {
  it("handle qui n'est pas un nom de compte, et URL inexploitable", () => {
    expect(
      compteProfileUrl({
        plateforme: "TikTok",
        handle: "Compte de Julie (ancien)",
        url: "pas une url",
      }),
    ).toBeNull();
    expect(
      compteProfileUrl({ plateforme: "Instagram", handle: "@" }),
    ).toBeNull();
  });

  it("une URL de profil piégée ne sort jamais de l'hôte de la plateforme", () => {
    expect(
      compteProfileUrl({
        plateforme: "TikTok",
        handle: "@kelly.leydie",
        url: "https://tiktok.com.evil.example/@kellyleydie",
      }),
    ).toBe("https://www.tiktok.com/@kelly.leydie");
  });
});

// Les trois comptes de la coquille du 03/10/2026, tels qu'en prod.
describe("lienDiffereDuHandle — le lien ouvre-t-il un autre compte que le @ ?", () => {
  it("Instagram : @Sarah_snytch avec un lien vers sarah_snitch1 → signalé", () => {
    expect(
      lienDiffereDuHandle({
        plateforme: "Instagram",
        handle: "@Sarah_snytch",
        url: "https://www.instagram.com/sarah_snitch1?stkn=MXZmcmY4Y2tuanprYg%3D%3D&utm_source=qr",
      }),
    ).toBe("https://www.instagram.com/sarah_snitch1/");
  });

  it("TikTok : @quentin.snitch avec un lien vers quentin.snytch → signalé", () => {
    expect(
      lienDiffereDuHandle({
        plateforme: "TikTok",
        handle: "@quentin.snitch",
        url: "https://www.tiktok.com/@quentin.snytch?_r=1&_t=ZG-9AEPclowI5o",
      }),
    ).toBe("https://www.tiktok.com/@quentin.snytch");
  });

  it("le même compte à la casse près (@Sarah_snytch / sarah_snytch) → rien à signaler", () => {
    expect(
      lienDiffereDuHandle({
        plateforme: "Instagram",
        handle: "@Sarah_snytch",
        url: "https://www.instagram.com/sarah_snytch/?igsh=MWx5ZjQ0YXkyOTBvcA%3D%3D",
      }),
    ).toBeNull();
  });

  it("pas de lien, ou un lien qui ne désigne aucun compte → rien à comparer", () => {
    expect(lienDiffereDuHandle({ plateforme: "TikTok", handle: "@quentin.snytch" })).toBeNull();
    expect(
      lienDiffereDuHandle({
        plateforme: "TikTok",
        handle: "@quentin.snytch",
        url: "https://www.instagram.com/quentin.snytch/",
      }),
    ).toBeNull();
  });
});
