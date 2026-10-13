import { describe, it, expect } from "vitest";
import { empreinteBible, lienScenario } from "../convex/mcpScenarios";

/**
 * Outils MCP des scénarios — l'empreinte que le journal garde à la place d'une
 * bible entière, et les liens de `tester_scenario` que l'écran relit.
 */
describe("empreinteBible", () => {
  const bible = '{\n  "id": "C2",\n  "titre": "Le like de l\'ex",\n  "lui": "Yanis"\n}';

  it("est stable pour un même texte", () => {
    expect(empreinteBible(bible)).toBe(empreinteBible(`${bible}`));
  });

  it("change dès un caractère, même à longueur égale", () => {
    expect(empreinteBible(bible.replace("Yanis", "Yanns"))).not.toBe(empreinteBible(bible));
    expect(empreinteBible(bible.replace("Yanis", "Yanns")).split(":")[0]).toBe(String(bible.length));
  });
});

describe("lienScenario", () => {
  it("l'écran seul, sans test", () => {
    expect(lienScenario("blush", "kx7scen0000000000000000000000c2")).toBe("/admin/blush/scenarios/kx7scen0000000000000000000000c2");
  });

  it("le test et le fichier à télécharger, prénom encodé", () => {
    const lien = lienScenario("blush", "kx7scen0000000000000000000000c2", {
      prenom: "Inès Garnier",
      graine: 7,
      datesBible: true,
      telecharger: "zip",
    });
    const q = new URL(lien, "https://jarvia.test").searchParams;
    expect(q.get("tester")).toBe("Inès Garnier");
    expect(q.get("graine")).toBe("7");
    expect(q.get("dates")).toBe("bible");
    expect(q.get("telecharger")).toBe("zip");
  });
});
