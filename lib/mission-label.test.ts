import { describe, expect, it } from "vitest";

/**
 * NOM DE CAMPAGNE exposé au portail — règle de repli.
 *
 * `missionLabelFor` (convex/assignments.ts) est le SEUL point où le nom d'une
 * campagne atteint l'espace créatrice et l'espace clippeur. Il lisait `name`,
 * le nom INTERNE de production : « Format Warmup LAB » s'affichait tel quel sur
 * le dashboard d'une créatrice, révélant la taxonomie de pilotage.
 *
 * La fonction serveur fait des lectures de base ; ce qui est décidable — quel
 * nom l'emporte — est isolé ici et testé, plutôt que d'exister seulement dans
 * une expression au milieu d'une query.
 */
export function portalCampaignLabel(
  campaign: { name?: string; displayName?: string } | null | undefined,
): string {
  // `|| ` et non `?? ` : un displayName vidé retombe sur le nom interne.
  return campaign?.displayName?.trim() || campaign?.name || "Vidéo à tourner";
}

describe("nom de campagne côté portail", () => {
  it("affiche le displayName quand il est défini", () => {
    expect(
      portalCampaignLabel({ name: "Format Warmup LAB", displayName: "Vidéo lifestyle" }),
    ).toBe("Vidéo lifestyle");
  });

  it("retombe sur le nom interne quand displayName est absent", () => {
    // Comportement ACTUEL préservé : 0 migration, les campagnes sans nom
    // d'affichage continuent d'afficher ce qu'elles affichaient.
    expect(portalCampaignLabel({ name: "Format 3 - POV Demo" })).toBe(
      "Format 3 - POV Demo",
    );
  });

  it("un displayName VIDÉ retombe sur le nom interne, pas sur du vide", () => {
    // Piège de `?? ` : il ne rattrape pas la chaîne vide. Une campagne dont le
    // nom d'affichage a été effacé afficherait une étiquette vide à la créatrice.
    expect(portalCampaignLabel({ name: "Format X", displayName: "" })).toBe("Format X");
    expect(portalCampaignLabel({ name: "Format X", displayName: "   " })).toBe("Format X");
  });

  it("campagne disparue → libellé de repli, jamais vide", () => {
    expect(portalCampaignLabel(null)).toBe("Vidéo à tourner");
    expect(portalCampaignLabel(undefined)).toBe("Vidéo à tourner");
  });
});
