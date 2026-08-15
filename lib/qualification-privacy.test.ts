import { describe, expect, it } from "vitest";
import {
  CREATOR_ASSIGNMENT_FIELDS,
  NON_CREATOR_ASSIGNMENT_FIELDS,
  pickCreatorAssignment,
} from "../convex/creatorAssignmentFields";
import {
  CLIPPER_ASSIGNMENT_FIELDS,
  NON_CLIPPER_ASSIGNMENT_FIELDS,
  pickClipperAssignment,
} from "../convex/clipperAssignmentFields";

/**
 * CONFIDENTIALITÉ de la qualification stratégique.
 *
 * `contentType` (warmup/promo) et `remunerated` sont des décisions de PILOTAGE.
 * Les exposer dirait à une créatrice quelles vidéos comptent moins pour nous.
 *
 * Les tests d'exhaustivité voisins vérifient que tout champ du schéma est
 * CLASSÉ ; ceux-ci vérifient le sens de la classification — qu'ils sont classés
 * du bon côté, ET qu'ils ne ressortent pas des fonctions de projection. Un champ
 * peut être listé « exclu » et fuir quand même si la projection change de forme
 * (le piège `...safe` déjà rencontré) : on teste donc la SORTIE, pas la liste.
 */
const SECRETS = ["contentType", "remunerated"] as const;

/** Assignment de la forme de la prod, qualification posée. */
const assignment = {
  _id: "a1",
  _creationTime: 1,
  status: "todo",
  dueDate: 1_787_000_000_000,
  postDate: 1_786_900_000_000,
  postWindow: { startMin: 1260, endMin: 1380 },
  createdAt: 1_786_800_000_000,
  projectId: "p1",
  creatorId: "c1",
  overlayText: "Texte à incruster",
  instructions: "Tourne en extérieur",
  // Les deux secrets, posés comme ils le seraient en base.
  contentType: "warmup",
  remunerated: false,
  // Voisins sensibles déjà couverts ailleurs, présents pour réalisme.
  comboKey: "hook1:flux1:cta1",
  creatorNameSnapshot: "Orlane",
};

describe("qualification stratégique — jamais côté créatrice ni clippeur", () => {
  it("les deux champs sont classés EXCLUS des deux côtés", () => {
    for (const champ of SECRETS) {
      expect(NON_CREATOR_ASSIGNMENT_FIELDS).toContain(champ);
      expect(NON_CLIPPER_ASSIGNMENT_FIELDS).toContain(champ);
      expect(CREATOR_ASSIGNMENT_FIELDS).not.toContain(champ);
      expect(CLIPPER_ASSIGNMENT_FIELDS).not.toContain(champ);
    }
  });

  it("ils sont ABSENTS du payload créatrice", () => {
    const sortie = pickCreatorAssignment(assignment);
    for (const champ of SECRETS) {
      expect(sortie).not.toHaveProperty(champ);
    }
    // Contrôle de PRÉSENCE apparié : la projection rend bien le reste, sinon un
    // objet vide ferait passer le test d'absence sans rien prouver.
    expect(sortie).toHaveProperty("postDate");
    expect(sortie).toHaveProperty("instructions");
  });

  it("ils sont ABSENTS du payload clippeur", () => {
    const sortie = pickClipperAssignment(assignment);
    for (const champ of SECRETS) {
      expect(sortie).not.toHaveProperty(champ);
    }
    expect(sortie).toHaveProperty("postDate");
    expect(sortie).toHaveProperty("overlayText");
  });

  it("une valeur FALSY ne doit pas non plus filtrer", () => {
    // `remunerated: false` et un contentType vide sont les cas où une projection
    // naïve (`if (v)`) laisserait croire à une absence alors que la clé sort.
    const sortie = pickCreatorAssignment({ ...assignment, remunerated: false });
    expect(Object.keys(sortie)).not.toContain("remunerated");
  });
});
