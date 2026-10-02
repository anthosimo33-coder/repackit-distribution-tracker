import { describe, it, expect } from "vitest";
import { bornesDuMois, decaler, lundiDe, moisPrecedent, promptsJarvia } from "../convex/mcpPrompts";

const texte = (r: ReturnType<ReturnType<typeof promptsJarvia>["obtenir"]>) => r!.messages[0].content.text;

/**
 * Les prompts disent à Claude quels outils appeler et où s'arrêter. Deux choses
 * comptent : les DATES par défaut (jours de Paris, bords de mois et d'année), et
 * l'ADAPTATION aux domaines ouverts — jamais un outil d'écriture proposé à une
 * connexion qui ne l'a pas.
 */
describe("dates par défaut", () => {
  it("le lundi d'une semaine, dimanche compris", () => {
    expect(lundiDe("2026-10-07")).toBe("2026-10-05"); // mercredi
    expect(lundiDe("2026-10-05")).toBe("2026-10-05"); // lundi
    expect(lundiDe("2026-10-11")).toBe("2026-10-05"); // dimanche
    expect(lundiDe("2026-01-01")).toBe("2025-12-29"); // à cheval sur l'année
  });

  it("le mois précédent et les bornes d'un mois, février et janvier compris", () => {
    expect(moisPrecedent("2026-01-15")).toBe("2025-12");
    expect(moisPrecedent("2026-10-02")).toBe("2026-09");
    expect(bornesDuMois("2026-02")).toEqual({ du: "2026-02-01", au: "2026-02-28" });
    expect(bornesDuMois("2028-02")).toEqual({ du: "2028-02-01", au: "2028-02-29" });
    expect(decaler("2026-03-29", 1)).toBe("2026-03-30"); // changement d'heure : jours de calendrier
  });

  it("planifier_semaine vise la semaine PROCHAINE par défaut, ou celle du jour donné", () => {
    const p = promptsJarvia([], "2026-10-07");
    expect(texte(p.obtenir("planifier_semaine", {}))).toContain("semaine du 2026-10-12 au 2026-10-18");
    expect(texte(p.obtenir("planifier_semaine", { semaine: "2026-10-22" }))).toContain("semaine du 2026-10-19 au 2026-10-25");
    expect(() => p.obtenir("planifier_semaine", { semaine: "2026-02-30" })).toThrow("« semaine »");
  });

  it("bilan_du_mois porte sur le mois DERNIER par défaut", () => {
    expect(texte(promptsJarvia([], "2026-01-03").obtenir("bilan_du_mois", {}))).toContain("Fais le bilan de 2025-12 (du 2025-12-01 au 2025-12-31)");
  });
});

describe("adaptation aux domaines que la connexion peut modifier", () => {
  it("avec Missions : simuler, attendre l'accord, prévenir de l'email, puis assigner", () => {
    const t = texte(promptsJarvia(["missions"], "2026-10-07").obtenir("planifier_semaine", {}));
    expect(t).toContain("`assigner_scripts` avec `simuler: true`");
    expect(t).toContain("reçoit un email");
    expect(t).toContain("Attends mon accord");
  });

  it("sans Missions : le plan seulement, et comment ouvrir l'écriture", () => {
    const t = texte(promptsJarvia(["compta", "scripts"], "2026-10-07").obtenir("planifier_semaine", {}));
    expect(t).not.toContain("assigner_scripts");
    expect(t).toContain("ne peut pas assigner");
    expect(t).toContain("allume « Missions »");
  });

  it("labo_hooks : ajouter_hooks seulement avec Scripts, toujours désactivés", () => {
    const avec = texte(promptsJarvia(["scripts"], "2026-10-07").obtenir("labo_hooks", { campagne: "Snytch FR", pays: "us", nombre: "6" }));
    expect(avec).toContain("`ajouter_hooks` (ils sont créés DÉSACTIVÉS");
    expect(avec).toContain("pays: US");
    expect(avec).toContain("Écris 6 nouveaux hooks");
    const sans = texte(promptsJarvia(["missions"], "2026-10-07").obtenir("labo_hooks", { campagne: "Snytch FR" }));
    expect(sans).not.toContain("ajouter_hooks");
    expect(sans).toContain("Écris 10 nouveaux hooks");
  });

  it("point_du_jour ne propose que les gestes ouverts", () => {
    const lecture = texte(promptsJarvia([], "2026-10-07").obtenir("point_du_jour", {}));
    expect(lecture).not.toContain("confirmer_publication");
    expect(lecture).not.toContain("replanifier_mission");
    const tout = texte(promptsJarvia(["missions", "publications"], "2026-10-07").obtenir("point_du_jour", {}));
    expect(tout).toContain("confirmer_publication");
    expect(tout).toContain("replanifier_mission");
  });

  it("des bornes sur les nombres, et un prompt inconnu ne rend rien", () => {
    const p = promptsJarvia([], "2026-10-07");
    expect(() => p.obtenir("rejouer_gagnants", { jours: "365" })).toThrow("« jours »");
    expect(texte(p.obtenir("rejouer_gagnants", { jours: "14", nombre: "3" }))).toContain("du: 2026-09-23, limite: 3");
    expect(p.obtenir("inconnu", {})).toBeNull();
  });
});
