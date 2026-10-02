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

  it("revue_validation : regarder chaque vidéo, puis valider/refuser seulement avec Publications", () => {
    const avec = texte(promptsJarvia(["publications"], "2026-10-07").obtenir("revue_validation", { createatrice: "Kelly Martin", nombre: "3" }));
    expect(avec).toContain("3 vidéo(s) au plus");
    expect(avec).toContain("`validation` (createatrice: « Kelly Martin »)");
    expect(avec).toContain("`regarder_video`");
    expect(avec).toContain("`ditAuDebut` contre `hookAttendu`");
    expect(avec).toContain("`valider_video` / `refuser_video`");
    const sans = texte(promptsJarvia(["missions"], "2026-10-07").obtenir("revue_validation", {}));
    expect(sans).toContain("`regarder_video`");
    expect(sans).not.toContain("valider_video");
    expect(sans).toContain("allume « Publications »");
  });

  it("nouvelle_campagne : creer_campagne avec Scripts, inspirations avec Veille", () => {
    const tout = texte(promptsJarvia(["scripts", "veille"], "2026-10-07").obtenir("nouvelle_campagne", { sujet: "cartes rares", hooks: "5" }));
    expect(tout).toContain("sur « cartes rares »");
    expect(tout).toContain("Écris 5 hooks, 3 flux et 3 cta");
    expect(tout).toContain("`creer_campagne`");
    expect(tout).toContain("`ajouter_inspiration`");
    const lecture = texte(promptsJarvia([], "2026-10-07").obtenir("nouvelle_campagne", {}));
    expect(lecture).not.toContain("creer_campagne");
    expect(lecture).not.toContain("ajouter_inspiration");
    expect(lecture).toContain("allume « Scripts »");
  });

  it("preparer_propositions : jamais d'écriture directe, toujours proposer, avec le lot du jour", () => {
    const t = texte(promptsJarvia(["missions", "scripts", "publications"], "2026-10-07").obtenir("preparer_propositions", { nombre: "5" }));
    expect(t).toContain("tu ne modifies RIEN toi-même");
    expect(t).toContain("`proposer`");
    expect(t).toContain("Au plus 5");
    expect(t).toContain("lot: « Routine du 07/10/2026 »");
    expect(t).toContain("`propositions`");
  });

  it("tester_hooks : simuler puis lancer avec Missions, proposer sinon ; lire un verdict", () => {
    const avec = texte(promptsJarvia(["missions"], "2026-10-07").obtenir("tester_hooks", { campagne: "Snytch FR" }));
    expect(avec).toContain("`lancer_experience` avec `simuler: true`");
    expect(avec).toContain("moins de 6 créatrices");
    const sans = texte(promptsJarvia([], "2026-10-07").obtenir("tester_hooks", { campagne: "Snytch FR" }));
    expect(sans).not.toContain("`lancer_experience` avec");
    expect(sans).toContain("`proposer` (outil lancer_experience)");
    const verdict = texte(promptsJarvia(["scripts"], "2026-10-07").obtenir("tester_hooks", { campagne: "Snytch FR", experience: "Hooks prix" }));
    expect(verdict).toContain("`experiences` (experience: « Hooks prix »)");
    expect(verdict).toContain("`graduer_hook`");
  });

  it("coach_semaine : bilan par créatrice, envoi avec Messages, proposer sinon", () => {
    const avec = texte(promptsJarvia(["messages"], "2026-10-07").obtenir("coach_semaine", { createatrices: "Kelly Martin, Inès", jours: "14" }));
    expect(avec).toContain("à ces créatrices : Kelly Martin, Inès — les 14 derniers jours (du 2026-09-24 au 2026-10-07)");
    expect(avec).toContain("`bilan_createatrice` (du: 2026-09-24, au: 2026-10-07)");
    expect(avec).toContain("« Salut <prénom>, »");
    expect(avec).toContain("parler d'une autre créatrice");
    expect(avec).toContain("`envoyer_message_createatrice` — rappelle d'abord que chacun part par EMAIL");
    const sans = texte(promptsJarvia(["missions"], "2026-10-07").obtenir("coach_semaine", {}));
    expect(sans).toContain("chaque créatrice active — les 7 derniers jours (du 2026-10-01 au 2026-10-07)");
    expect(sans).not.toContain("`envoyer_message_createatrice` —");
    expect(sans).toContain("`proposer` (outil envoyer_message_createatrice");
    expect(sans).toContain("allume « Messages »");
    expect(() => promptsJarvia([], "2026-10-07").obtenir("coach_semaine", { jours: "2" })).toThrow("« jours »");
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
