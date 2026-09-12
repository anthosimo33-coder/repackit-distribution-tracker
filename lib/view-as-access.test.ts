import { describe, it, expect } from "vitest";
import {
  canObserveCreatorSpace,
  canObserveMoney,
  isMoneySub,
} from "./view-as-access";

/**
 * Qui observe l'espace d'une créatrice, et qui y voit l'argent.
 *
 * Le cas réel derrière ces règles : une manageuse cliquait « Voir son espace »
 * et tombait sur un refus, parce que la garde lisait le RÔLE quand tout le reste
 * de son travail passe par des BLOCS. L'observation s'ouvre donc à
 * `creators.read` — mais pas ses écrans de gains, qui exigent `payments.manage`.
 */

/** Les droits d'une personne, à la forme du hook (`has` vrai par défaut). */
function droits(blocs: string[], chargement = false) {
  return {
    has: (b: "creators.read" | "payments.manage") =>
      chargement ? true : blocs.includes(b),
    chargement,
  };
}

describe("canObserveCreatorSpace", () => {
  it("une manageuse qui gère les créatrices observe leur espace", () => {
    expect(canObserveCreatorSpace(droits(["creators.read"]))).toBe(true);
  });

  it("un admin observe — il porte tout le catalogue", () => {
    // `getMyPermissions` rend le catalogue COMPLET à un admin : la règle n'a pas
    // à connaître son rôle, elle lit le même bloc que la garde serveur.
    expect(
      canObserveCreatorSpace(droits(["creators.read", "payments.manage"])),
    ).toBe(true);
  });

  it("sans creators.read, pas d'observation", () => {
    expect(canObserveCreatorSpace(droits(["payments.manage"]))).toBe(false);
    expect(canObserveCreatorSpace(droits([]))).toBe(false);
  });

  it("tant que les droits chargent, on montre", () => {
    // Doctrine du dépôt : cacher à tort casse un rôle en silence, et un admin ne
    // doit pas voir son bouton apparaître en retard.
    expect(canObserveCreatorSpace(droits([], true))).toBe(true);
  });
});

describe("canObserveMoney — la frontière argent tient dans l'observation", () => {
  it("une manageuse SANS payments.manage ne voit pas les gains", () => {
    // C'est tout l'arbitrage : elle observe la créatrice, pas ses paiements.
    expect(canObserveMoney(droits(["creators.read"]))).toBe(false);
  });

  it("avec payments.manage, les écrans de gains s'ouvrent", () => {
    expect(canObserveMoney(droits(["creators.read", "payments.manage"]))).toBe(
      true,
    );
  });

  it("tant que les droits chargent, la réponse est NON", () => {
    // Le doute joue ici dans l'AUTRE sens que pour le bouton, et c'est délibéré :
    // cette réponse décide si des QUERIES partent. Une query refusée LÈVE, et une
    // exception dans le portail démonte l'écran (défaut du 08/09/2026). Le
    // provider attend donc les droits avant de rendre l'espace observé.
    expect(canObserveMoney(droits([], true))).toBe(false);
    expect(canObserveMoney(droits(["payments.manage"], true))).toBe(false);
  });
});

describe("isMoneySub — les écrans de gains de l'espace observé", () => {
  it("les trois écrans faits de gains en sont", () => {
    // Paiements = les cycles ; vidéos = le gain par vidéo ; progression = le
    // montant des paliers. Retirer l'un d'eux ouvrirait un chemin vers l'argent.
    expect(isMoneySub("/paiements")).toBe(true);
    expect(isMoneySub("/videos")).toBe(true);
    expect(isMoneySub("/progression")).toBe(true);
  });

  it("le reste de son espace ne l'est pas", () => {
    // Assertion de PRÉSENCE en regard de l'absence ci-dessus : la règle doit
    // laisser passer l'espace observable, sinon elle fermerait tout et le test
    // au-dessus resterait vert.
    expect(isMoneySub("")).toBe(false);
    expect(isMoneySub("/missions")).toBe(false);
    expect(isMoneySub("/comptes")).toBe(false);
    expect(isMoneySub("/profil")).toBe(false);
    expect(isMoneySub("/guide")).toBe(false);
  });

  it("une sous-page d'un écran de gains en est aussi", () => {
    // La fiche d'une vidéo porte son gain : fermer /videos sans fermer ce qui est
    // dessous laisserait l'URL profonde ouverte.
    expect(isMoneySub("/videos/j57abc")).toBe(true);
  });

  it("un chemin qui COMMENCE par le même texte n'en est pas", () => {
    // `startsWith` nu matcherait « /videosperso » : le préfixe doit être suivi
    // d'une barre, sinon la règle fermerait un écran qui n'existe pas et, le jour
    // où il existerait, sans qu'on l'ait décidé.
    expect(isMoneySub("/videosperso")).toBe(false);
    expect(isMoneySub("/paiements-info")).toBe(false);
  });
});
