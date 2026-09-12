import { describe, it, expect } from "vitest";
import { canObserveCreatorSpace } from "./view-as-access";

/**
 * L'affichage du bouton « Voir son espace ». Ce qui se joue : promettre à une
 * manageuse un écran que le serveur lui refusera — constaté en prod le
 * 10/09/2026, elle cliquait et tombait sur « accès refusé ».
 */
describe("canObserveCreatorSpace", () => {
  it("un admin de projet observe", () => {
    expect(canObserveCreatorSpace({ role: "admin", chargement: false })).toBe(true);
  });

  it("un superadmin observe", () => {
    expect(canObserveCreatorSpace({ role: "superadmin", chargement: false })).toBe(
      true,
    );
  });

  it("un manager NE passe pas — le rôle admin ne se coche pas", () => {
    // C'est le cas réel : tous les droits du catalogue cochés ne donnent pas
    // l'observation, parce que sa garde lit le RÔLE, pas les blocs.
    expect(canObserveCreatorSpace({ role: "manager", chargement: false })).toBe(
      false,
    );
  });

  it.each(["creator", "talent", "clipper", null])(
    "un rôle de portail (%s) ne passe pas non plus",
    (role) => {
      expect(canObserveCreatorSpace({ role, chargement: false })).toBe(false);
    },
  );

  it("tant que le rôle est INCONNU, on montre", () => {
    // La doctrine du dépôt : cacher à tort casse un rôle en silence. Un admin
    // ne doit pas voir son bouton apparaître en retard.
    expect(canObserveCreatorSpace({ role: null, chargement: true })).toBe(true);
    expect(canObserveCreatorSpace({ role: "manager", chargement: true })).toBe(
      true,
    );
  });
});
