import { describe, it, expect } from "vitest";
import {
  isTikTokShortlink,
  handleFromPostUrl,
  accountUrlCheck,
} from "./post-url-account";

describe("isTikTokShortlink", () => {
  it("détecte vm./vt.tiktok.com, pas une URL canonique", () => {
    expect(isTikTokShortlink("https://vm.tiktok.com/ZGeAbc123/")).toBe(true);
    expect(isTikTokShortlink("https://vt.tiktok.com/ZSxyz/")).toBe(true);
    expect(
      isTikTokShortlink("https://www.tiktok.com/@khaby.lame/video/72"),
    ).toBe(false);
  });
});

describe("handleFromPostUrl", () => {
  it("TikTok : /@handle/video/… → handle sans @, minuscule", () => {
    expect(
      handleFromPostUrl("https://www.tiktok.com/@Khaby.Lame/video/72", "TikTok"),
    ).toBe("khaby.lame");
  });
  it("YouTube : /@chaine/… → handle ; /watch → null", () => {
    expect(handleFromPostUrl("https://youtube.com/@MaChaine/shorts/x", "YouTube")).toBe(
      "machaine",
    );
    expect(handleFromPostUrl("https://youtube.com/watch?v=abc", "YouTube")).toBeNull();
    expect(handleFromPostUrl("https://youtu.be/abc", "YouTube")).toBeNull();
  });
  it("Instagram : /username/reel/… → username ; /p|/reel racine → null", () => {
    expect(
      handleFromPostUrl("https://instagram.com/coolgirl/reel/CxYz", "Instagram"),
    ).toBe("coolgirl");
    expect(handleFromPostUrl("https://instagram.com/p/CxYz/", "Instagram")).toBeNull();
    expect(
      handleFromPostUrl("https://instagram.com/reel/CxYz/", "Instagram"),
    ).toBeNull();
  });
  it("Facebook : /page/videos/… → page ; Reel, partage, fb.watch, profile.php → null", () => {
    expect(
      handleFromPostUrl("https://www.facebook.com/Kelly.Snytch/videos/1284539976120931/", "Facebook"),
    ).toBe("kelly.snytch");
    expect(
      handleFromPostUrl("https://www.facebook.com/kelly.snytch/posts/pfbid02abcDEF", "Facebook"),
    ).toBe("kelly.snytch");
    expect(handleFromPostUrl("https://www.facebook.com/reel/1284539976120931", "Facebook")).toBeNull();
    expect(
      handleFromPostUrl("https://www.facebook.com/share/r/1AbCdEfGh2/?mibextid=wwXIfr", "Facebook"),
    ).toBeNull();
    expect(handleFromPostUrl("https://fb.watch/uXyZ12aBcD/", "Facebook")).toBeNull();
    expect(
      handleFromPostUrl("https://www.facebook.com/profile.php?id=61554471234567", "Facebook"),
    ).toBeNull();
  });
  it("Snapchat : /@handle/spotlight/… et /add/handle → handle ; /spotlight nu → null", () => {
    expect(
      handleFromPostUrl(
        "https://www.snapchat.com/@Kelly.Snytch/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYa2pqcm5vbmlsAaChyLxkAaChyHOWAAAAAQ",
        "Snapchat",
      ),
    ).toBe("kelly.snytch");
    expect(
      handleFromPostUrl("https://www.snapchat.com/add/kelly.snytch?share_id=abc&locale=fr-FR", "Snapchat"),
    ).toBe("kelly.snytch");
    expect(
      handleFromPostUrl(
        "https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYa2pqcm5vbmlsAaChyLxkAaChyHOWAAAAAQ",
        "Snapchat",
      ),
    ).toBeNull();
    expect(handleFromPostUrl("https://www.snapchat.com/t/AbCdEf12", "Snapchat")).toBeNull();
  });
  it("URL invalide → null", () => {
    expect(handleFromPostUrl("pas une url", "TikTok")).toBeNull();
  });
});

describe("accountUrlCheck", () => {
  it("match (à l'@ et à la casse près)", () => {
    expect(
      accountUrlCheck(
        "https://www.tiktok.com/@Khaby.Lame/video/72",
        "TikTok",
        "@khaby.lame",
      ).status,
    ).toBe("match");
  });
  it("mismatch : URL d'un autre compte", () => {
    const r = accountUrlCheck(
      "https://www.tiktok.com/@autre.compte/video/1",
      "TikTok",
      "@khaby.lame",
    );
    expect(r.status).toBe("mismatch");
    expect(r.detected).toBe("autre.compte");
    expect(r.expected).toBe("khaby.lame");
  });
  it("shortlink → unverifiable EXPLICITE (jamais un faux ok)", () => {
    const r = accountUrlCheck(
      "https://vm.tiktok.com/ZGeAbc123/",
      "TikTok",
      "@khaby.lame",
    );
    expect(r.status).toBe("unverifiable");
    expect(r.reason).toBe("shortlink");
  });
  it("plateforme sans handle dans l'URL → unverifiable", () => {
    expect(
      accountUrlCheck("https://instagram.com/p/CxYz/", "Instagram", "@moi").reason,
    ).toBe("no-handle-in-url");
    expect(
      accountUrlCheck("https://youtu.be/abc", "YouTube", "@moi").reason,
    ).toBe("no-handle-in-url");
  });
  it("champ vide ou handle attendu absent → unverifiable (pas match)", () => {
    expect(accountUrlCheck("", "TikTok", "@moi").reason).toBe("empty");
    expect(
      accountUrlCheck("https://www.tiktok.com/@x/video/1", "TikTok", null).reason,
    ).toBe("no-expected");
  });
});
