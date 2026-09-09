import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * CLIQUET DES ÉCRITURES DE RÔLE — qui a le droit de poser un rôle, et où.
 *
 * ── POURQUOI CE CONTRÔLE EXISTE ──────────────────────────────────────────────
 * Le cliquet des permissions (`scripts/check-permission-coverage.mjs`) compte les
 * fonctions gardées par un BLOC. Il ne voit pas une porte d'un autre genre : une
 * mutation PUBLIQUE, neuve, qui écrirait un rôle sans passer par l'écran de
 * gestion. Or `memberships.roles` décide de tout le reste — les blocs ne limitent
 * qu'un manager, et c'est le rôle qui dit qui est manager.
 *
 * La règle : toute écriture de rôle vit dans un fichier de cette liste, et chacun
 * y est pour une raison écrite. Un fichier de plus fait ÉCHOUER ce test — ce qui
 * force à dire pourquoi, plutôt qu'à le découvrir six mois après.
 *
 * ⚠️ CE N'EST PAS UNE BARRIÈRE, c'est un cliquet. Il ne protège rien au runtime :
 * il empêche qu'une porte s'ajoute sans qu'on la voie. La barrière, ce sont les
 * wrappers (`superadminMutation`, `internalMutation`, `e2eMutation`).
 */

/** Qui écrit un rôle aujourd'hui, et à quel titre. */
const ECRITURES_AUTORISEES: Record<string, string> = {
  // L'ÉCRAN de gestion — superadminMutation, le seul chemin ouvert à un humain
  // connecté. Volontairement pas un bloc de permission : un bloc « gérer les
  // rôles » serait un bloc qui permet de s'accorder tous les autres.
  "team.ts": "superadminMutation — l'écran Rôles et droits",
  // Le SIGNUP : pose le rôle de portail dérivé de la fiche, dans la transaction
  // atomique de création de compte.
  "auth.ts": "createOrUpdateUser — signup par invitation",
  // Le changement de POPULATION et la suppression d'une fiche : ils remplacent
  // ou retirent le rôle de PORTAIL, sans toucher aux autres (withPortalRole).
  "creators.ts": "updateCreator (bascule de kind) / deleteCreator / rattachement",
  // Provisionnement en LIGNE DE COMMANDE — internalMutation, hors session.
  "memberPermissions.ts": "internalMutation — provisionnement CLI d'un manager",
  "provisionAdmin.ts": "internalMutation — provisionnement CLI d'un admin",
  "migrations.ts": "internalMutation — migrations one-shot",
  // Seeds et harnais de test — e2eMutation (gate E2E_SECRET, jamais en prod).
  "permissionProbe.ts": "e2eMutation — harnais des tests de rôles",
  "projects.ts": "e2eMutation — seed du projet e2e",
  "demoSeed.ts": "seed de démo",
};

/**
 * Le source SANS ses commentaires. Sans ça, une phrase d'explication qui CITE un
 * `patch({ roles: … })` — il y en a une dans convex/roles.ts, justement pour
 * expliquer ce qu'il ne faut pas écrire — compterait comme une écriture.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

/** Ce fichier écrit-il un rôle sur un membership ? */
function ecritUnRole(source: string): boolean {
  const code = sansCommentaires(source);
  if (/insert\(\s*"memberships"/.test(code)) return true;
  return /patch\([^;]{0,120}?\{[\s\S]{0,40}?roles?:/.test(code);
}

describe("cliquet — qui écrit un rôle", () => {
  const dir = new URL("../convex/", import.meta.url).pathname;
  const fichiers = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.startsWith("_"),
  );

  it("aucun fichier n'écrit un rôle en dehors de la liste connue", () => {
    const inconnus: string[] = [];
    for (const f of fichiers) {
      const src = readFileSync(path.join(dir, f), "utf8");
      if (!ecritUnRole(src)) continue;
      if (!(f in ECRITURES_AUTORISEES)) inconnus.push(f);
    }
    // Le message NOMME le fichier : le jour où ça casse, il ne faut pas avoir à
    // relire le test pour comprendre ce qu'on a ajouté.
    expect(
      inconnus,
      `Ces fichiers écrivent un rôle de membership sans être déclarés : ${inconnus.join(", ")}. ` +
        "Ajoute-les à ECRITURES_AUTORISEES avec la raison, ou fais passer l'écriture par convex/team.ts.",
    ).toEqual([]);
  });

  it("la liste ne contient pas de fichier MORT (elle décrit le présent)", () => {
    // L'autre sens du cliquet. Une entrée qui ne correspond plus à rien laisse
    // croire qu'une porte existe encore — et on cesse de relire une liste fausse.
    const morts = Object.keys(ECRITURES_AUTORISEES).filter((f) => {
      if (!fichiers.includes(f)) return true;
      return !ecritUnRole(readFileSync(path.join(dir, f), "utf8"));
    });
    expect(morts).toEqual([]);
  });

  it("le SEUL chemin ouvert à un humain connecté est superadmin", () => {
    // Les autres écrivains sont `internalMutation` (ligne de commande),
    // `e2eMutation` (gate E2E_SECRET, jamais défini en prod) ou le callback de
    // signup. Aucun n'est atteignable depuis une session, sauf team.ts — et
    // team.ts n'expose que du superadmin.
    const team = readFileSync(path.join(dir, "team.ts"), "utf8");
    for (const m of team.matchAll(/export const (\w+) = (\w+)\(/g)) {
      expect(m[2], `team.${m[1]}`).toMatch(/^superadmin(Query|Mutation)$/);
    }
  });

  it("aucune fonction gardée par un BLOC ne peut accorder un rôle d'ÉQUIPE", () => {
    // LA PROPRIÉTÉ QUI COMPTE, et elle est plus fine que « ne touche pas aux
    // rôles ». Deux fonctions gardées par `creators.manage` écrivent bien un
    // rôle : la bascule de population (`updateCreator`) et le rattachement d'une
    // créatrice à un projet. Les deux sont BORNÉES aux rôles de PORTAIL — un
    // manager peut faire d'une talent une clippeuse, il ne peut pas se faire
    // admin. Interdire toute écriture serait faux ; ce qu'il faut interdire,
    // c'est qu'un bloc mène à « admin » ou « manager ».
    const interdits = /["'](?:admin|manager)["']/;
    for (const f of Object.keys(ECRITURES_AUTORISEES)) {
      if (f === "team.ts") continue; // superadmin, hors du système des blocs
      const src = readFileSync(path.join(dir, f), "utf8");
      const blocs = [
        ...src.matchAll(
          /export const \w+ = permission(?:Query|Mutation)\("[^"]+"\)\(\{[\s\S]*?\n\}\);/g,
        ),
      ];
      for (const b of blocs) {
        const lignesDeRole = b[0]
          .split("\n")
          .filter((l) => /roles?:\s*\[|insert\(\s*"memberships"/.test(l));
        for (const l of lignesDeRole) {
          expect(
            interdits.test(l),
            `${f} — une fonction gardée par un bloc pose un rôle d'équipe : ${l.trim()}`,
          ).toBe(false);
        }
      }
    }
  });
});
