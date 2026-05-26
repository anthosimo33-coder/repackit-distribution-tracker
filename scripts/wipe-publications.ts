import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

async function main() {
  const all = await client.query(api.publications.listPublications, {});
  console.log(`Wiping ${all.length} publications...`);
  for (const p of all) {
    await client.mutation(api.publications.deletePublication, { id: p._id });
    console.log(`  deleted ${p.carouselId} ${p.plateforme}`);
  }
  console.log(`Done. ${all.length} deleted.`);
}

main().catch(console.error);
