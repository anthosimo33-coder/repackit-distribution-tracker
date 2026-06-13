/**
 * Génère convex/scriptSeedData.ts depuis scripts/systeme-scripts-bulk-testing.md.
 * Garantit le VERBATIM (apostrophes, [X], emojis, ponctuation) : aucune saisie
 * manuelle des hooks/corps/flux/démo. Re-lançable :
 *   npx tsx scripts/gen-bulk-seed.ts
 * Les labels/contenus des CTA viennent du cahier des charges (normalisés) et
 * sont les seuls textes définis ici plutôt qu'extraits du doc.
 */
import { readFileSync, writeFileSync } from "fs";

const SRC = "scripts/systeme-scripts-bulk-testing.md";
const OUT = "convex/scriptSeedData.ts";

const md = readFileSync(SRC, "utf-8");
const lines = md.split("\n");

function isHeadingOrRule(l: string): boolean {
  return l.startsWith("## ") || l.startsWith("### ") || l.trim() === "---";
}

/** Puces `- ` sous un heading, jusqu'au prochain heading/règle. */
function bulletsUnder(headingPrefix: string): string[] {
  let i = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (i < 0) throw new Error(`Heading introuvable: ${headingPrefix}`);
  const out: string[] = [];
  for (i++; i < lines.length; i++) {
    if (isHeadingOrRule(lines[i])) break;
    if (lines[i].startsWith("- ")) out.push(lines[i].slice(2).trim());
  }
  return out;
}

/** Première ligne de blockquote `> ` non vide sous un heading. */
function firstQuoteUnder(headingPrefix: string): string {
  let i = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (i < 0) throw new Error(`Heading introuvable: ${headingPrefix}`);
  for (i++; i < lines.length; i++) {
    if (isHeadingOrRule(lines[i])) break;
    if (lines[i].startsWith("> ") && lines[i].slice(2).trim().length > 0) {
      return lines[i].slice(2).trim();
    }
  }
  throw new Error(`Pas de blockquote sous: ${headingPrefix}`);
}

/** Liste numérotée `N. ` sous un heading, jointe par \n. */
function numberedUnder(headingPrefix: string): string {
  let i = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (i < 0) throw new Error(`Heading introuvable: ${headingPrefix}`);
  const out: string[] = [];
  for (i++; i < lines.length; i++) {
    if (isHeadingOrRule(lines[i])) break;
    if (/^\d+\.\s/.test(lines[i])) out.push(lines[i].trim());
  }
  return out.join("\n");
}

// ── Hooks par section ────────────────────────────────────────────────────────
const tierS = bulletsUnder("### TIER S");
const tierA = bulletsUnder("### TIER A");
const tierB = bulletsUnder("### TIER B");
const retravailler = bulletsUnder("### À RETRAVAILLER");
// Exclut la puce-note "→ traduit en Tier A ci-dessus" (pas un hook à seeder).
const special = bulletsUnder("## HOOKS À FORMAT PARTICULIER").filter(
  (b) => !b.includes("traduit en Tier A"),
);

// ── Asserts de comptage (vérification intégrée) ──────────────────────────────
const assertCount = (name: string, got: number, want: number) => {
  if (got !== want) throw new Error(`${name}: ${got} ≠ ${want} attendu`);
};
assertCount("TIER S", tierS.length, 6);
assertCount("TIER A", tierA.length, 8);
assertCount("TIER B", tierB.length, 10);
assertCount("À RETRAVAILLER", retravailler.length, 2);
assertCount("FORMAT PARTICULIER", special.length, 3);

// ── Corps / Flux (verbatim depuis le doc) ────────────────────────────────────
const corpsA = firstQuoteUnder("### CORPS A");
const corpsB = firstQuoteUnder("### CORPS B");
const flux1 = firstQuoteUnder("### FLUX 1");
const flux2 = firstQuoteUnder("### FLUX 2");
const demoBlock = numberedUnder("## STRUCTURE DÉMO COMMUNE");
if (!demoBlock.startsWith("1. Aller sur RepackIt.io")) {
  throw new Error("demoBlock inattendu: " + demoBlock.slice(0, 40));
}

type Tier = "S" | "A" | "B" | null;
const trunc60 = (s: string) => (s.length > 60 ? s.slice(0, 60) : s);
const hookBrick = (content: string, tier: Tier, active: boolean) => ({
  kind: "hook" as const,
  label: trunc60(content),
  content,
  tier,
  active,
});

const SEED_BRICKS = [
  // Corps (labels du cahier des charges, contenu verbatim du doc).
  { kind: "corps", label: "Corps A — Aspirationnel", content: corpsA, tier: null, active: true },
  { kind: "corps", label: "Corps B — Mécanique", content: corpsB, tier: null, active: true },
  // Flux.
  { kind: "flux", label: "Flux 1 — Upload", content: flux1, tier: null, active: true },
  { kind: "flux", label: "Flux 2 — Scan & clone", content: flux2, tier: null, active: true },
  // CTA (cahier des charges).
  { kind: "cta", label: "CTA direct", content: "Va sur RepackIt.io.", tier: null, active: true },
  {
    kind: "cta",
    label: "CTA capture de lead",
    content:
      "Si tu veux la marche à suivre complète, commente Go. / Commente App si tu la veux.",
    tier: null,
    active: true,
  },
  // Hooks actifs.
  ...tierS.map((c) => hookBrick(c, "S", true)),
  ...tierA.map((c) => hookBrick(c, "A", true)),
  ...tierB.map((c) => hookBrick(c, "B", true)),
  // Hooks inactifs (présents mais hors combos).
  ...retravailler.map((c) => hookBrick(c, "B", false)),
  ...special.map((c) => hookBrick(c, null, false)),
];

const activeHooks = SEED_BRICKS.filter(
  (b) => b.kind === "hook" && b.active,
).length;
assertCount("hooks actifs", activeHooks, 24);

const header = `/* AUTO-GÉNÉRÉ par scripts/gen-bulk-seed.ts depuis
   scripts/systeme-scripts-bulk-testing.md — NE PAS ÉDITER À LA MAIN.
   Contenu (hooks/corps/flux/démo) VERBATIM du doc. Régénérer :
   npx tsx scripts/gen-bulk-seed.ts */

export const CAMPAIGN_NAME = "RepackIt — Bulk Testing";

export type SeedBrick = {
  kind: "hook" | "corps" | "flux" | "cta";
  label: string;
  content: string;
  tier: "S" | "A" | "B" | null;
  active: boolean;
};

export const DEMO_BLOCK = ${JSON.stringify(demoBlock)};

export const SEED_BRICKS: SeedBrick[] = ${JSON.stringify(SEED_BRICKS, null, 2)};
`;

writeFileSync(OUT, header, "utf-8");
console.log(
  `✔ ${OUT} généré : ${SEED_BRICKS.length} bricks (${activeHooks} hooks actifs, ` +
    `${SEED_BRICKS.filter((b) => b.kind === "hook" && !b.active).length} hooks inactifs).`,
);
