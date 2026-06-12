import { createE2eClient } from "../e2e/helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const client = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

async function main() {
  const all = await client.query(api.hooks.listHooks, {});
  console.log(`Test 1 (no filters):                            ${all.length}  (expected: 490)`);

  const mrbeast = await client.query(api.hooks.listHooks, {
    search: "MrBeast",
  });
  console.log(`Test 2 (search "MrBeast"):                      ${mrbeast.length}  (UI showed 13)`);

  const t3 = await client.query(api.hooks.listHooks, {
    mecanique: "Erreur",
    niveau: "Broad-A",
    langue: "FR",
  });
  console.log(`Test 3 (Erreur + Broad-A + FR):                 ${t3.length}  (expected: 20)`);

  const fr = await client.query(api.hooks.listHooks, {
    langue: "FR",
  });
  console.log(`Default UI state (Langue=FR only):              ${fr.length}  (UI showed 283)`);
}

main().catch(console.error);
