import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const SOURCE = "/Users/simonet/Desktop/RepackIt distribution/RepackIt_Framework_Carrousel.md";
const OUT = resolve(process.cwd(), "scripts/hooks-seed.json");

type Mecanique =
  | "Erreur"
  | "Volume"
  | "Comparaison"
  | "Contradiction"
  | "Universalité"
  | "Question";
type Niveau = "Broad-A" | "Broad-B" | "Niché";
type Langue = "FR" | "EN";

interface Hook {
  text: string;
  mecanique: Mecanique;
  niveau: Niveau;
  langue: Langue;
}

const MECANIQUE_MAP: Record<string, Mecanique> = {
  "Erreur": "Erreur",
  "Volume / Autorité empruntée": "Volume",
  "Comparaison choquante": "Comparaison",
  "Contradiction culturelle": "Contradiction",
  "Universalité cachée": "Universalité",
  "Question fermée provocante": "Question",
};

function detectNiveau(title: string): Niveau | null {
  if (title.includes("Broad-A")) return "Broad-A";
  if (title.includes("Broad-B")) return "Broad-B";
  if (title.includes("Niché")) return "Niché";
  return null;
}

function detectLangue(title: string): Langue | null {
  if (title.includes("(FR)")) return "FR";
  if (title.includes("(EN)")) return "EN";
  return null;
}

const raw = readFileSync(SOURCE, "utf-8");
const lines = raw.split("\n");

const hooks: Hook[] = [];
let mecanique: Mecanique | null = null;
let niveau: Niveau | null = null;
let langue: Langue | null = null;

const SECTION_RE = /^###\s+11\.\d+\s+Mécanique\s+"([^"]+)"/;
const SUBSECTION_RE = /^####\s+(.+)$/;
const HOOK_RE = /^-\s+(.+)$/;
const ANY_HEADER_RE = /^#{1,6}\s+/;

for (const line of lines) {
  // Reset on any new top-level/major header. Keeps us from bleeding mecanique
  // into 11.7 ("Hooks ...") or section 12+.
  const sectionMatch = line.match(SECTION_RE);
  if (sectionMatch) {
    const title = sectionMatch[1];
    mecanique = MECANIQUE_MAP[title] ?? null;
    niveau = null;
    langue = null;
    continue;
  }

  // Any other ### or ## header — drop the mecanique so we don't capture stray hooks.
  if (/^##+\s+/.test(line) && !line.startsWith("####")) {
    mecanique = null;
    niveau = null;
    langue = null;
    continue;
  }

  const subMatch = line.match(SUBSECTION_RE);
  if (subMatch) {
    const title = subMatch[1];
    niveau = detectNiveau(title);
    langue = detectLangue(title);
    continue;
  }

  const hookMatch = line.match(HOOK_RE);
  if (hookMatch && mecanique && niveau && langue) {
    const text = hookMatch[1].trim();
    if (text.length > 0) {
      hooks.push({ text, mecanique, niveau, langue });
    }
  }
}

writeFileSync(OUT, JSON.stringify(hooks, null, 2), "utf-8");

// Build matrix: mecanique -> niveau -> langue -> count
const mecaniques: Mecanique[] = [
  "Erreur",
  "Volume",
  "Comparaison",
  "Contradiction",
  "Universalité",
  "Question",
];
const niveaux: Niveau[] = ["Broad-A", "Broad-B", "Niché"];
const langues: Langue[] = ["FR", "EN"];

const matrix: Record<string, number> = {};
for (const h of hooks) {
  const key = `${h.mecanique}|${h.niveau}|${h.langue}`;
  matrix[key] = (matrix[key] ?? 0) + 1;
}

console.log(`\n✅ Parsed ${hooks.length} hooks`);
console.log(`   → written to ${OUT}\n`);
console.log("Breakdown matrix (Mécanique × Niveau × Langue):\n");

const colWidth = 11;
const header =
  "Mécanique".padEnd(15) +
  niveaux
    .flatMap((n) => langues.map((l) => `${n} ${l}`.padStart(colWidth)))
    .join("") +
  "  total".padStart(8);
console.log(header);
console.log("-".repeat(header.length));

let grand = 0;
for (const m of mecaniques) {
  let row = m.padEnd(15);
  let rowTotal = 0;
  for (const n of niveaux) {
    for (const l of langues) {
      const c = matrix[`${m}|${n}|${l}`] ?? 0;
      row += String(c).padStart(colWidth);
      rowTotal += c;
    }
  }
  row += String(rowTotal).padStart(8);
  grand += rowTotal;
  console.log(row);
}
console.log("-".repeat(header.length));
console.log("TOTAL".padEnd(15) + " ".repeat(colWidth * niveaux.length * langues.length) + String(grand).padStart(8));
console.log();
