import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const PROD_URL = "https://fiery-wolf-460.convex.cloud";
const client = new ConvexHttpClient(PROD_URL);

const SMOKE_PREFIX = "[SMOKE_TEST]";

async function main() {
  console.log("─── Smoke prod : filterPresets + listHooksWithUsage(hideDraft) ───\n");

  // 0. Cleanup pré-existant éventuel (orphans).
  const initialPresets = await client.query(api.filterPresets.listPresets, {});
  const orphans = initialPresets.filter((p) =>
    p.name.startsWith(SMOKE_PREFIX),
  );
  if (orphans.length > 0) {
    console.log(`  Nettoyage ${orphans.length} orphan(s) [SMOKE_TEST]…`);
    for (const o of orphans) {
      await client.mutation(api.filterPresets.deletePreset, { id: o._id });
    }
  }
  console.log(
    `✓ État initial : ${initialPresets.length - orphans.length} preset(s) non-smoke en DB`,
  );

  // VÉRIF 2 — créer un preset → apparaît (shape v3 : ajout mediaType
  // en plus des champs v2 array compte/mecanique/format/verdict)
  const presetName = `${SMOKE_PREFIX} smoke-${Date.now()}`;
  const newId = await client.mutation(api.filterPresets.createPreset, {
    name: presetName,
    filters: {
      search: "",
      plateforme: "TikTok",
      statut: "all",
      compte: [],
      mecanique: ["Erreur"],
      format: [],
      verdict: [],
      mediaType: "all",
    },
    sort: { key: "saveRate", dir: "desc" },
  });
  console.log(`✓ V3 : createPreset OK · "${presetName}"`);

  const afterCreate = await client.query(api.filterPresets.listPresets, {});
  const found = afterCreate.find((p) => p._id === newId);
  if (!found) {
    throw new Error("Preset créé absent du listPresets");
  }
  console.log(
    `✓ V2 bis : listPresets retourne le preset (${afterCreate.length} total, schemaVersion=${found.schemaVersion})`,
  );

  // VÉRIF 4 — recharger : la struct contient bien filters + sort tels que sauvés
  const isFiltersOK =
    found.filters.plateforme === "TikTok" &&
    found.filters.mecanique.length === 1 &&
    found.filters.mecanique[0] === "Erreur" &&
    found.filters.compte.length === 0 &&
    found.sort.key === "saveRate" &&
    found.sort.dir === "desc";
  if (!isFiltersOK) {
    throw new Error("Filtres/sort divergent de ce qui a été sauvé");
  }
  console.log(`✓ V4 : preset.filters + sort fidèles à l'input (round-trip OK)`);

  // VÉRIF 6 — supprimer
  await client.mutation(api.filterPresets.deletePreset, { id: newId });
  const afterDelete = await client.query(api.filterPresets.listPresets, {});
  if (afterDelete.find((p) => p._id === newId)) {
    throw new Error("Preset toujours présent après deletePreset");
  }
  console.log(`✓ V6 : deletePreset OK · row absente`);

  // V3+V5 ne sont pas testables via Convex client direct (UI state machine
  // côté React seulement). Couverts par e2e/preset-tracker.spec.ts qui
  // exerce reset → label "Charger un preset" → reload → label preset →
  // modif filtre → label "(custom)".

  // BONUS — vérif que listHooksWithUsage accepte l'arg hideDraft (Modif 4).
  const hooksDefault = await client.query(api.hooks.listHooksWithUsage, {
    langue: "FR",
  });
  const hooksHideDraft = await client.query(api.hooks.listHooksWithUsage, {
    langue: "FR",
    hideDraft: true,
  });
  if (
    !Array.isArray(hooksDefault) ||
    !Array.isArray(hooksHideDraft)
  ) {
    throw new Error("listHooksWithUsage retourne un type inattendu");
  }
  console.log(
    `✓ Modif 4 prod : listHooksWithUsage accepte hideDraft (${hooksDefault.length} sans / ${hooksHideDraft.length} avec)`,
  );

  // Cleanup final — pas de orphan smoke en sortie
  const finalPresets = await client.query(api.filterPresets.listPresets, {});
  const remaining = finalPresets.filter((p) =>
    p.name.startsWith(SMOKE_PREFIX),
  );
  if (remaining.length > 0) {
    console.log(`  Cleanup final : ${remaining.length} orphan(s) restant(s)…`);
    for (const o of remaining) {
      await client.mutation(api.filterPresets.deletePreset, { id: o._id });
    }
  }
  console.log(`✓ Cleanup : 0 preset [SMOKE_TEST] en DB`);

  console.log("\n─── Smoke OK ───");
}

main().catch((err) => {
  console.error("\n❌ ÉCHEC :", err.message);
  process.exit(1);
});
