import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { readFileSync } from "fs";
import { config } from "dotenv";

const envFlag = process.argv.find((a) => a === "--env" || a.startsWith("--env="));
const envValue = envFlag === "--env"
  ? process.argv[process.argv.indexOf("--env") + 1]
  : envFlag?.split("=")[1];

const envFile = envValue === "prod" ? ".env.prod.local" : ".env.local";

config({ path: envFile });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  throw new Error(`NEXT_PUBLIC_CONVEX_URL not set in ${envFile}`);
}

async function main() {
  // Remédiation sécurité — seedHooks est une e2eMutation : exige E2E_SECRET,
  // défini ici (env file) ET sur le deployment Convex cible. La prod n'a
  // jamais E2E_SECRET par design → pour un re-seed prod exceptionnel, le
  // définir temporairement via `convex env set` puis le retirer (cf README).
  const secret = process.env.E2E_SECRET;
  if (!secret) {
    throw new Error(
      `E2E_SECRET non défini dans ${envFile} — requis pour seedHooks (et doit aussi être défini sur le deployment cible).`,
    );
  }
  const client = new ConvexHttpClient(url!);
  const hooks = JSON.parse(readFileSync("./scripts/hooks-seed.json", "utf-8"));

  // P2 — la biblio hooks est scopée projet. On résout le projet "repackit"
  // par slug (e2e-gated, pas d'auth requise) puis on seed dedans.
  const { projectId } = await client.mutation(
    api.projects.e2eGetProjectIdBySlug,
    { secret, slug: "repackit" },
  );
  if (!projectId) {
    throw new Error(
      "Projet 'repackit' introuvable sur ce deployment — lance d'abord migrations:setupRepackitProject.",
    );
  }

  console.log(`Seeding ${hooks.length} hooks → ${url}  (from ${envFile})`);
  const result = await client.mutation(api.hooks.seedHooks, {
    hooks,
    secret,
    projectId,
  });
  console.log(`✅ Inserted ${result.inserted} hooks`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
