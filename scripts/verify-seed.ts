import { createE2eClient } from "../e2e/helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

const envFlag = process.argv.find((a) => a === "--env" || a.startsWith("--env="));
const envValue = envFlag === "--env"
  ? process.argv[process.argv.indexOf("--env") + 1]
  : envFlag?.split("=")[1];
const envFile = envValue === "prod" ? ".env.prod.local" : ".env.local";

config({ path: envFile });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

async function main() {
  const client = createE2eClient(url!);
  const all = await client.query(api.hooks.listHooks, {});

  const mecaniques = [
    "Erreur",
    "Volume",
    "Comparaison",
    "Contradiction",
    "Universalité",
    "Question",
  ] as const;
  const niveaux = ["Broad-A", "Broad-B", "Niché"] as const;
  const langues = ["FR", "EN"] as const;

  const matrix: Record<string, number> = {};
  for (const h of all) {
    matrix[`${h.mecanique}|${h.niveau}|${h.langue}`] =
      (matrix[`${h.mecanique}|${h.niveau}|${h.langue}`] ?? 0) + 1;
  }

  console.log(`\n✅ Convex has ${all.length} hooks\n`);
  console.log("Breakdown from DB (Mécanique × Niveau × Langue):\n");

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
  console.log(
    "TOTAL".padEnd(15) +
      " ".repeat(colWidth * niveaux.length * langues.length) +
      String(grand).padStart(8),
  );
  console.log();
}

main().catch((err) => {
  console.error("❌ Verify failed:", err.message);
  process.exit(1);
});
