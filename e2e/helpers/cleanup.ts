import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

const client = new ConvexHttpClient(url);

const E2E_MARKER = "[E2E_TEST]";

export async function cleanupTestData() {
  // Publications first — comptes can be deleted only when no publications reference them.
  try {
    const pubs = await client.query(api.publications.listPublications, {});
    for (const pub of pubs) {
      if (pub.notes.startsWith(E2E_MARKER)) {
        await client.mutation(api.publications.deletePublication, {
          id: pub._id,
        });
      }
    }
  } catch (e) {
    console.warn("Cleanup publications failed:", (e as Error).message);
  }

  try {
    const comptes = await client.query(api.comptes.listComptes, {});
    for (const compte of comptes) {
      if (compte.notes.startsWith(E2E_MARKER)) {
        try {
          await client.mutation(api.comptes.deleteCompte, { id: compte._id });
        } catch {
          // Compte still in use somewhere → fall back to archive.
          await client.mutation(api.comptes.updateCompte, {
            id: compte._id,
            actif: false,
          });
        }
      }
    }
  } catch (e) {
    console.warn("Cleanup comptes failed:", (e as Error).message);
  }

  try {
    const presets = await client.query(api.filterPresets.listPresets, {});
    for (const p of presets) {
      if (p.name.startsWith(E2E_MARKER)) {
        await client.mutation(api.filterPresets.deletePreset, { id: p._id });
      }
    }
  } catch (e) {
    console.warn("Cleanup filterPresets failed:", (e as Error).message);
  }

  // Batch F — pilier VEILLE. cleanupTestInspirations / cleanupTestFolders
  // sont des mutations bulk côté Convex qui filtrent par marker [E2E_TEST]
  // dans notes / description (cf convex/inspirations.ts + convex/folders.ts).
  // deleteInspiration / deleteFolder publics ne shippent qu'en Batch G.
  try {
    await client.mutation(api.inspirations.cleanupTestInspirations, {});
  } catch (e) {
    console.warn("Cleanup inspirations failed:", (e as Error).message);
  }

  try {
    await client.mutation(api.folders.cleanupTestFolders, {});
  } catch (e) {
    console.warn("Cleanup folders failed:", (e as Error).message);
  }
}
