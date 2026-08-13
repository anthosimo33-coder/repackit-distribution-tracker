import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * DÉCLARATION D'UN COMPTE — les trois points d'entrée partagent un cœur.
 *
 * `declareCompte` (créatrice partenaire) et `declareManagedCompte` (admin)
 * étaient déjà des quasi-copies ; l'espace clippeur en aurait fait une
 * troisième, et trois copies d'une écriture de document est une garantie de
 * divergence — celle qu'on vient de payer avec `digest_warmup_late`.
 *
 * Le document produit est verrouillé côté e2e (creator-accounts-server.spec.ts,
 * champ par champ, sur la vraie base). Ce qu'on verrouille ICI, c'est que le
 * partage reste en place : rien n'empêche un futur passage de ré-inliner un
 * `insert("comptes")` dans un wrapper « juste pour ce cas-là », et la copie
 * repartirait pour un tour sans que rien ne rougisse.
 */
const SRC = readFileSync(join(process.cwd(), "convex", "comptes.ts"), "utf8");

/** Corps d'une des trois mutations de déclaration, de sa signature à son `});`. */
function corpsDe(nom: string): string {
  const debut = SRC.indexOf(`export const ${nom} = `);
  expect(debut).toBeGreaterThan(-1);
  const fin = SRC.indexOf("\n});", debut);
  expect(fin).toBeGreaterThan(debut);
  return SRC.slice(debut, fin);
}

const ENTREES = [
  "declareCompte",
  "declareManagedCompte",
  "declareClipperCompte",
] as const;

describe("les trois déclarations passent par declareCompteCore", () => {
  it.each(ENTREES)("%s appelle le cœur", (nom) => {
    expect(corpsDe(nom)).toContain("declareCompteCore(");
  });

  it.each(ENTREES)("%s n'insère pas de compte elle-même", (nom) => {
    expect(corpsDe(nom)).not.toContain('insert("comptes"');
  });

  it("le cœur est le SEUL endroit du fichier qui crée un compte de portail", () => {
    // `createCompte` (admin, saisie manuelle d'un compte de l'équipe) est un
    // autre objet : pas de propriétaire créateur, statut choisi par l'admin. Les
    // déclarations de PORTAIL, elles, n'ont qu'un point d'écriture.
    const coeur = SRC.indexOf("async function declareCompteCore(");
    expect(coeur).toBeGreaterThan(-1);
    expect(SRC.slice(coeur, SRC.indexOf("\n}", coeur))).toContain(
      'insert("comptes"',
    );
  });
});

describe("le clippeur a son propre wrapper, pas un creatorMutation élargi", () => {
  it("declareClipperCompte est une clipperMutation", () => {
    // `requireCreator` repousse les nouveaux rôles PAR CONCEPTION (PR 1).
    // L'élargir toucherait le chemin partenaire pour un besoin clippeur.
    expect(SRC).toContain("export const declareClipperCompte = clipperMutation(");
  });

  it("declareCompte reste une creatorMutation", () => {
    expect(SRC).toContain("export const declareCompte = creatorMutation(");
  });
});
