import { describe, it, expect } from "vitest";
import { DELAI_ENTRE_MESSAGES_MS, messageVersHtml, prochainMessagePossible, verifierMessage } from "../convex/messageEquipe";

/**
 * Le message du coach part par email à une créatrice. Son texte vient d'un
 * modèle : rien ne doit passer en HTML, les paragraphes doivent rester des
 * paragraphes, et une créatrice n'est pas écrite plus d'une fois tous les 3 jours.
 */
describe("message de l'équipe", () => {
  it("échappe tout HTML, garde paragraphes et retours à la ligne", () => {
    const html = messageVersHtml(
      "Salut Kelly,\n\nTa vidéo du 03/10 a fait 12 400 vues <b>en 7 jours</b> — ton meilleur score.\nBravo !\n\n\nÀ jeudi 🙂",
    );
    expect(html).toBe(
      '<p style="margin:0 0 12px">Salut Kelly,</p>' +
        '<p style="margin:0 0 12px">Ta vidéo du 03/10 a fait 12 400 vues &lt;b&gt;en 7 jours&lt;/b&gt; — ton meilleur score.<br>Bravo !</p>' +
        '<p style="margin:0 0 12px">À jeudi 🙂</p>',
    );
    expect(messageVersHtml('<script>alert("x")</script> un message assez long pour passer.')).not.toContain("<script>");
  });

  it("borne l'objet et le message", () => {
    expect(verifierMessage("Ta semaine", "Salut Léa, ta vidéo de mardi a fait 8 300 vues à J+7, ton record.")).toBeNull();
    expect(verifierMessage("", "Salut Léa, ta vidéo de mardi a fait 8 300 vues à J+7, ton record.")).toContain("objet");
    expect(verifierMessage("Ta semaine", "Bravo !")).toContain("quelques phrases");
    expect(verifierMessage("Ta semaine", "x".repeat(2501))).toContain("2500 caractères");
  });

  it("une créatrice n'est pas réécrite avant 3 jours", () => {
    const t0 = Date.UTC(2026, 9, 1, 8);
    expect(prochainMessagePossible(null, t0)).toBeNull();
    expect(prochainMessagePossible(t0, t0 + DELAI_ENTRE_MESSAGES_MS - 1)).toBe(t0 + DELAI_ENTRE_MESSAGES_MS);
    expect(prochainMessagePossible(t0, t0 + DELAI_ENTRE_MESSAGES_MS)).toBeNull();
  });
});
