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
  const client = new ConvexHttpClient(url!);
  const hooks = JSON.parse(readFileSync("./scripts/hooks-seed.json", "utf-8"));

  console.log(`Seeding ${hooks.length} hooks → ${url}  (from ${envFile})`);
  const result = await client.mutation(api.hooks.seedHooks, { hooks });
  console.log(`✅ Inserted ${result.inserted} hooks`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
