import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { readFileSync } from "fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

async function main() {
  const client = new ConvexHttpClient(url!);
  const hooks = JSON.parse(readFileSync("./scripts/hooks-seed.json", "utf-8"));

  console.log(`Seeding ${hooks.length} hooks → ${url}`);
  const result = await client.mutation(api.hooks.seedHooks, { hooks });
  console.log(`✅ Inserted ${result.inserted} hooks`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
