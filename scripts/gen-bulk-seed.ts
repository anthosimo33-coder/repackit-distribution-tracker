/**
 * Génère convex/scriptSeedData.ts depuis scripts/systeme-scripts-bulk-testing.md.
 * Garantit le VERBATIM (apostrophes, [X], emojis, ponctuation) : aucune saisie
 * manuelle des hooks/corps/flux. Re-lançable :
 *   npx tsx scripts/gen-bulk-seed.ts
 * Les labels/contenus des CTA viennent du cahier des charges (normalisés) et
 * sont les seuls textes définis ici plutôt qu'extraits du doc.
 *
 * Refonte 3 briques : les CORPS du doc sont seedés comme HOOKS (tier A) — l'audit
 * a confirmé que ce sont des accroches+promesses — et le socle DÉMO n'est plus
 * monté (DEMO_BLOCK = ""). Le seed sert aux NOUVEAUX environnements/démo ; la
 * prod existante est migrée par scripts:migrateCorpsToHooks (idempotent).
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

// ── Corps (→ hooks tier A) / Flux (verbatim depuis le doc) ───────────────────
const corpsA = firstQuoteUnder("### CORPS A");
const corpsB = firstQuoteUnder("### CORPS B");
const flux1 = firstQuoteUnder("### FLUX 1");
const flux2 = firstQuoteUnder("### FLUX 2");

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
  // Flux (verbatim du doc).
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
  // Refonte 3 briques — les anciens CORPS sont des hooks tier A (contenu verbatim
  // du doc). Labels conservés pour parité avec scripts:migrateCorpsToHooks.
  { kind: "hook", label: "Corps A — Aspirationnel", content: corpsA, tier: "A", active: true },
  { kind: "hook", label: "Corps B — Mécanique", content: corpsB, tier: "A", active: true },
  // Hooks inactifs (présents mais hors combos).
  ...retravailler.map((c) => hookBrick(c, "B", false)),
  ...special.map((c) => hookBrick(c, null, false)),
];

const activeHooks = SEED_BRICKS.filter(
  (b) => b.kind === "hook" && b.active,
).length;
// 24 hooks actifs d'origine + 2 ex-corps reclassés tier A = 26.
assertCount("hooks actifs", activeHooks, 26);

const header = `/* AUTO-GÉNÉRÉ par scripts/gen-bulk-seed.ts depuis
   scripts/systeme-scripts-bulk-testing.md — NE PAS ÉDITER À LA MAIN.
   Refonte 3 briques : les CORPS du doc sont seedés comme hooks (tier A) et le
   socle démo n'est plus monté (DEMO_BLOCK = ""). Contenu VERBATIM du doc.
   Régénérer : npx tsx scripts/gen-bulk-seed.ts */

export const CAMPAIGN_NAME = "RepackIt — Bulk Testing";

export type SeedBrick = {
  kind: "hook" | "flux" | "cta";
  label: string;
  content: string;
  tier: "S" | "A" | "B" | null;
  active: boolean;
};

// LEGACY (refonte 3 briques) — socle démo retiré du montage. Vide pour les
// nouveaux seeds ; le champ scriptCampaigns.demoBlock reste (required, défaut "").
export const DEMO_BLOCK = "";

export const SEED_BRICKS: SeedBrick[] = ${JSON.stringify(SEED_BRICKS, null, 2)};
`;

writeFileSync(OUT, header, "utf-8");
console.log(
  `✔ ${OUT} généré : ${SEED_BRICKS.length} bricks (${activeHooks} hooks actifs, ` +
    `${SEED_BRICKS.filter((b) => b.kind === "hook" && !b.active).length} hooks inactifs).`,
);
