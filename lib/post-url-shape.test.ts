import { describe, it, expect } from "vitest";
import {
  detectPostUrlPlatform,
  isAccountOnlyUrl,
  publishUrlIssue,
  unmatchableUrlReason,
} from "../convex/postUrlShape";

describe("detectPostUrlPlatform — formes réelles copiées des apps", () => {
  const cases: Array<[string, ReturnType<typeof detectPostUrlPlatform>]> = [
    // Le cas signalé : « Copier le lien » de l'app TikTok iOS.
    ["https://www.tiktok.com/t/ZP8cDXdtT/", "TikTok"],
    ["https://vm.tiktok.com/ZMabc123/", "TikTok"],
    ["https://vt.tiktok.com/ZSabc123/", "TikTok"],
    ["https://www.tiktok.com/@detectivekezz/video/7123456789012345678", "TikTok"],
    ["https://m.tiktok.com/v/7123456789012345678.html", "TikTok"],
    ["https://www.instagram.com/reel/DczkWNIt-s5/?igsh=MXYz", "Instagram"],
    ["https://www.instagram.com/share/reel/_pBcDeF12/", "Instagram"],
    ["https://www.youtube.com/watch?app=desktop&v=abc_123", "YouTube"],
    ["https://www.youtube.com/live/abc_123", "YouTube"],
    ["https://youtu.be/abc_123?si=xyz", "YouTube"],
    // Hôte qui CONTIENT le domaine sans en être : l'ancienne détection par
    // sous-chaîne l'acceptait, les vues étaient alors introuvables à jamais.
    ["https://tiktok.com.evil.example/@u/video/7123456789012345678", undefined],
    ["https://not-instagram.com/reel/abc/", undefined],
    ["https://vimeo.com/123456", undefined],
    ["pas une url", undefined],
    ["", undefined],
  ];
  it.each(cases)("%s → %s", (url, expected) => {
    expect(detectPostUrlPlatform(url)).toBe(expected);
  });
});

describe("isAccountOnlyUrl — un lien de PROFIL n'est pas un lien de post", () => {
  const accounts: Array<[string, "TikTok" | "Instagram" | "YouTube"]> = [
    ["https://www.tiktok.com/@detectivekezz", "TikTok"],
    ["https://www.tiktok.com/@detectivekezz/", "TikTok"],
    ["https://www.tiktok.com/@detectivekezz?lang=fr", "TikTok"],
    ["https://www.instagram.com/detectivekezz/", "Instagram"],
    ["https://www.instagram.com/detectivekezz", "Instagram"],
    ["https://www.youtube.com/@detectivekezz", "YouTube"],
    ["https://www.youtube.com/@detectivekezz/shorts", "YouTube"],
    ["https://www.youtube.com/channel/UCabcdef123", "YouTube"],
    ["https://www.youtube.com/c/legacyname", "YouTube"],
    ["https://www.youtube.com/user/legacyname", "YouTube"],
  ];
  it.each(accounts)("%s (%s) → profil", (url, platform) => {
    expect(isAccountOnlyUrl(url, platform)).toBe(true);
  });

  const posts: Array<[string, "TikTok" | "Instagram" | "YouTube"]> = [
    ["https://www.tiktok.com/@detectivekezz/video/7123456789012345678", "TikTok"],
    ["https://www.tiktok.com/@detectivekezz/photo/7123456789012345678", "TikTok"],
    ["https://www.tiktok.com/t/ZP8cDXdtT/", "TikTok"],
    ["https://vm.tiktok.com/ZMabc123/", "TikTok"],
    ["https://www.instagram.com/reel/DczkWNIt-s5/", "Instagram"],
    ["https://www.instagram.com/p/DczkWNIt-s5/", "Instagram"],
    ["https://www.instagram.com/share/reel/_pBcDeF12/", "Instagram"],
    ["https://www.youtube.com/shorts/abc_123", "YouTube"],
    ["https://www.youtube.com/watch?v=abc_123", "YouTube"],
    ["https://youtu.be/abc_123", "YouTube"],
    // Non reconnu ⇒ PAS « prouvé profil » : on ne bloque que ce qu'on prouve.
    ["https://www.tiktok.com/inconnu/format/futur", "TikTok"],
    ["", "TikTok"],
  ];
  it.each(posts)("%s (%s) → pas un profil", (url, platform) => {
    expect(isAccountOnlyUrl(url, platform)).toBe(false);
  });
});

describe("publishUrlIssue — ne bloque QUE ce qui est prouvé faux", () => {
  it("laisse passer le lien court TikTok de l'app iOS (le cas signalé)", () => {
    expect(publishUrlIssue("https://www.tiktok.com/t/ZP8cDXdtT/", "TikTok")).toBeNull();
  });
  it("laisse passer un format inconnu de demain plutôt que de bloquer", () => {
    expect(
      publishUrlIssue("https://www.tiktok.com/format/inedit/2027", "TikTok"),
    ).toBeNull();
  });
  it("laisse passer un lien vide (le champ requis s'en charge)", () => {
    expect(publishUrlIssue("", "TikTok")).toBeNull();
  });
  it("laisse le serveur nommer une saisie qui n'est pas une URL", () => {
    expect(publishUrlIssue("pas une url", "TikTok")).toBeNull();
    expect(publishUrlIssue("   ", "TikTok")).toBeNull();
  });
  it("accepte un lien collé sans schéma (le serveur exige http(s))", () => {
    expect(
      publishUrlIssue("tiktok.com/@kezz/video/7123456789012345678", "TikTok"),
    ).toBeNull();
  });
  it("refuse un lien Instagram sur la cible TikTok", () => {
    expect(
      publishUrlIssue("https://www.instagram.com/reel/DczkWNIt-s5/", "TikTok"),
    ).toBe("wrong-platform");
  });
  it("refuse un hôte qui imite le domaine", () => {
    expect(
      publishUrlIssue("https://tiktok.com.evil.example/@u/video/71234", "TikTok"),
    ).toBe("wrong-platform");
  });
  it("refuse un lien de PROFIL sur la bonne plateforme", () => {
    expect(publishUrlIssue("https://www.tiktok.com/@detectivekezz", "TikTok")).toBe(
      "account-url",
    );
    expect(publishUrlIssue("https://www.instagram.com/detectivekezz/", "Instagram")).toBe(
      "account-url",
    );
  });
  it("nomme la mauvaise plateforme AVANT le profil quand les deux sont vrais", () => {
    expect(publishUrlIssue("https://www.instagram.com/detectivekezz/", "TikTok")).toBe(
      "wrong-platform",
    );
  });
});

describe("unmatchableUrlReason — plus jamais un `continue` muet", () => {
  it("distingue le lien court non résolu", () => {
    expect(unmatchableUrlReason("https://www.tiktok.com/t/ZP8cDXdtT/", "TikTok")).toMatch(
      /raccourci/i,
    );
    expect(unmatchableUrlReason("https://vm.tiktok.com/ZMabc123/", "TikTok")).toMatch(
      /raccourci/i,
    );
  });
  it("dit autre chose d'une URL sans identifiant de post", () => {
    const r = unmatchableUrlReason("https://www.tiktok.com/@kezz", "TikTok");
    expect(r).not.toMatch(/raccourci/i);
    expect(r.length).toBeGreaterThan(0);
  });
  it("ne dépasse jamais la taille stockée par recordCollectFailure", () => {
    expect(
      unmatchableUrlReason(`https://www.instagram.com/${"x".repeat(400)}/`, "Instagram")
        .length,
    ).toBeLessThanOrEqual(200);
  });
});
