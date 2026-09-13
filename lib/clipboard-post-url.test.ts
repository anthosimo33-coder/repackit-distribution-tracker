import { describe, expect, it } from "vitest";
import { suggestedPostUrl } from "./clipboard-post-url";

describe("suggestedPostUrl", () => {
  it("extrait le lien d'un texte de partage TikTok, sans la ponctuation collée", () => {
    const partage =
      "Regarde ma dernière vidéo 👀 https://www.tiktok.com/@kelly.moreau_fr/video/7412345678901234567?is_from_webapp=1&sender_device=pc. #appart #snytch";
    expect(suggestedPostUrl(partage, "TikTok")).toBe(
      "https://www.tiktok.com/@kelly.moreau_fr/video/7412345678901234567?is_from_webapp=1&sender_device=pc",
    );
  });

  it("accepte le lien court de l'app iOS (format non reconnu mais bon hôte)", () => {
    expect(suggestedPostUrl("https://www.tiktok.com/t/ZP8cDXdtT/", "TikTok")).toBe(
      "https://www.tiktok.com/t/ZP8cDXdtT/",
    );
  });

  it("ne propose jamais un lien d'une autre plateforme", () => {
    const insta = "https://www.instagram.com/reel/C9xYz12AbCd/?igsh=MWx0c2l";
    expect(suggestedPostUrl(insta, "TikTok")).toBeNull();
    // Présence appariée : le même lien est proposé pour Instagram.
    expect(suggestedPostUrl(insta, "Instagram")).toBe(insta);
  });

  it("ne propose jamais un lien de profil", () => {
    expect(suggestedPostUrl("https://www.tiktok.com/@kelly.moreau_fr", "TikTok")).toBeNull();
  });

  it("rien d'exploitable : null", () => {
    expect(suggestedPostUrl("", "TikTok")).toBeNull();
    expect(suggestedPostUrl(null, "TikTok")).toBeNull();
    expect(suggestedPostUrl("ma vidéo est en ligne !", "TikTok")).toBeNull();
  });
});
