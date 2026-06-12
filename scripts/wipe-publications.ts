import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Remédiation sécurité — le wipe passe par la e2eMutation server-side
 * wipeAllPublications (gated E2E_SECRET) au lieu de la boucle anonyme
 * listPublications + deletePublication. Bonus : supprime aussi les
 * metricSnapshots (l'ancien script les laissait orphelins). Inutilisable en
 * prod par design (E2E_SECRET n'y est jamais défini).
 */
async function main() {
  const secret = process.env.E2E_SECRET;
  if (!secret) {
    throw new Error(
      "E2E_SECRET non défini dans .env.local — requis pour wipeAllPublications.",
    );
  }
  const result = await client.mutation(api.publications.wipeAllPublications, {
    secret,
  });
  console.log(
    `Done. ${result.deletedPublications} publications + ${result.deletedSnapshots} snapshots supprimés.`,
  );
}

main().catch((err) => {
  console.error("❌ Wipe failed:", (err as Error).message);
  process.exit(1);
});
