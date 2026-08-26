import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import fr from "../messages/fr.json";
import en from "../messages/en.json";
import {
  RUSH_STATUSES,
  RUSH_EXPIRY_MS,
  TALENT_STATUS_LABELS,
  canTransition,
  isRushExpired,
  isTerminal,
  purgesBinary,
  type RushStatus,
} from "../convex/rushStatus";

/**
 * Machine à états d'un rush. Trois familles de tests, chacune pour une raison
 * distincte :
 *   - les TRANSITIONS, parce qu'un rush refusé ou expiré a vu son binaire purgé :
 *     le ressusciter donnerait une ligne qui pointe un fichier disparu ;
 *   - les LIBELLÉS, parce qu'ils franchissent une frontière de rôle — le talent ne
 *     doit pas apprendre l'existence des scripts en lisant un badge ;
 *   - l'EXPIRATION, dont la borne exacte est le genre de détail qui se découvre en
 *     production, deux mois trop tard.
 */

/** Littéraux d'un champ union DEPUIS LE SCHÉMA (source de vérité). */
function schemaLiterals(table: string, field: string): string[] {
  const src = readFileSync(
    new URL("../convex/schema.ts", import.meta.url),
    "utf8",
  );
  const tableStart = src.indexOf(`  ${table}: defineTable(`);
  expect(tableStart).toBeGreaterThan(-1);
  const fieldStart = src.indexOf(`    ${field}: v.`, tableStart);
  expect(fieldStart).toBeGreaterThan(-1);
  const block = src.slice(fieldStart).split("\n").slice(0, 40).join("\n");
  const end = block.indexOf("\n    ),");
  const scoped = end === -1 ? block.split("\n")[0] : block.slice(0, end);
  return [...scoped.matchAll(/v\.literal\("([^"]+)"\)/g)].map((m) => m[1]);
}

describe("accord code ↔ schéma", () => {
  it("rushes.status déclare exactement les 5 états du module", () => {
    expect(new Set(schemaLiterals("rushes", "status"))).toEqual(
      new Set(RUSH_STATUSES),
    );
  });
});

describe("canTransition — le chemin nominal et rien d'autre", () => {
  it("deposited → assigned → published", () => {
    expect(canTransition("deposited", "assigned")).toBe(true);
    expect(canTransition("assigned", "published")).toBe(true);
  });

  it("un rush libre peut être écarté ou périmer", () => {
    expect(canTransition("deposited", "rejected")).toBe(true);
    expect(canTransition("deposited", "expired")).toBe(true);
  });

  it("un rush RETENU ne périme plus (l'expiration ne vise que le stock)", () => {
    expect(canTransition("assigned", "expired")).toBe(false);
    // L'admin peut en revanche se raviser après coup.
    expect(canTransition("assigned", "rejected")).toBe(true);
  });

  it("aucun retour en arrière — le binaire d'un état terminal est purgé", () => {
    for (const terminal of ["rejected", "expired"] as const) {
      for (const to of RUSH_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("published est terminal (rien ne repart d'un clip sorti)", () => {
    for (const to of RUSH_STATUSES) {
      expect(canTransition("published", to)).toBe(false);
    }
  });

  it("une transition vers SOI-MÊME est refusée (no-op, pas une transition)", () => {
    for (const s of RUSH_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it("on ne saute pas l'assignation pour publier", () => {
    expect(canTransition("deposited", "published")).toBe(false);
  });
});

describe("isTerminal / purgesBinary", () => {
  it("trois états terminaux, deux seulement purgent le binaire", () => {
    const terminal = RUSH_STATUSES.filter(isTerminal);
    expect(new Set(terminal)).toEqual(
      new Set(["published", "rejected", "expired"]),
    );
    // Un rush PUBLIÉ garde son binaire : c'est la source du clip sorti.
    const purged = RUSH_STATUSES.filter(purgesBinary);
    expect(new Set(purged)).toEqual(new Set(["rejected", "expired"]));
  });
});

/** Résout une clé pointée dans un catalogue de messages. */
function resolve(key: string, catalog: unknown): string {
  return key
    .split(".")
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], catalog) as string;
}

describe("TALENT_STATUS_LABELS — le vocabulaire système ne remonte pas", () => {
  it("chaque état a un libellé", () => {
    for (const s of RUSH_STATUSES) {
      expect(TALENT_STATUS_LABELS[s as RushStatus]).toBeTruthy();
    }
  });

  it("« assigned » se dit VALIDÉ / Approved, jamais « retenu » ni « assigné »", () => {
    // « Validé » décrit ce que la personne vit ; « Retenu »/« Assigné » décrit ce
    // que fait le système — et laisse deviner qu'il y a quelque chose à assigner.
    // La table ne porte plus que des CLÉS : c'est la valeur RENDUE qu'on vérifie,
    // et dans les DEUX langues — la règle vaut aussi pour un talent anglophone.
    expect(resolve(TALENT_STATUS_LABELS.assigned, fr)).toBe("Validé");
    expect(resolve(TALENT_STATUS_LABELS.assigned, en)).toBe("Approved");
  });

  it("aucun libellé n'évoque script, compte, clippeur ou assignation", () => {
    const interdits = /script|compte|clipp|assign|rush|talent/i;
    for (const key of Object.values(TALENT_STATUS_LABELS)) {
      // On teste le TEXTE affiché, pas la clé : « status.rush.assigned »
      // contient « assign » et passerait à côté du défaut qu'on garde ici.
      for (const cat of [fr, en]) {
        expect(resolve(key, cat)).not.toMatch(interdits);
      }
    }
  });
});

describe("isRushExpired — la borne des 60 jours", () => {
  const JOUR = 24 * 60 * 60 * 1000;
  const depot = 1_760_000_000_000;

  it("60 jours exactement : PAS encore périmé (durée écoulée, pas compte à rebours)", () => {
    expect(RUSH_EXPIRY_MS).toBe(60 * JOUR);
    expect(isRushExpired(depot, depot + 60 * JOUR)).toBe(false);
  });

  it("59 jours : non ; 61 jours : oui", () => {
    expect(isRushExpired(depot, depot + 59 * JOUR)).toBe(false);
    expect(isRushExpired(depot, depot + 61 * JOUR)).toBe(true);
  });

  it("une milliseconde après le seuil suffit", () => {
    expect(isRushExpired(depot, depot + 60 * JOUR + 1)).toBe(true);
  });

  it("une horloge qui recule ne périme rien", () => {
    expect(isRushExpired(depot, depot - JOUR)).toBe(false);
  });
});
