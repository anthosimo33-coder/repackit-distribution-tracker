import { test, expect } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * Régression — ajout de mots-clés de warmup côté admin (updateWarmupProtocol).
 *
 * Bug prod : ajouter un mot-clé déjà présent sur UN AUTRE compte du projet
 * levait une ConvexError d'« unicité inter-comptes » (perçue « Server Error »),
 * ce qui bloquait l'admin assignant les mêmes niches aux comptes d'un créateur.
 * La règle d'unicité inter-comptes a été RETIRÉE : un même mot-clé peut être
 * partagé entre comptes. Le trim + dédup INTRA-compte reste, lui, en place.
 */
test.describe("Warmup — mots-clés", () => {
  test("admin peut réutiliser un mot-clé sur plusieurs comptes ; dédup intra-compte conservée", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const A = await createCreatorSession(url, {
      name: `[E2E_TEST] WarmupKw ${ts}`,
      email: `e2e-creator-kw-${ts}@repackit.test`,
      password: "creator-kw-12345",
    });
    const projectId = A.projectId;

    // Le créateur déclare deux comptes (TikTok + Instagram), comme en multi-plateforme.
    const ttId = await A.client.mutation(api.comptes.declareCompte, {
      projectId,
      plateforme: "TikTok",
      handle: `@e2ekw_tt${ts}`,
    });
    const igId = await A.client.mutation(api.comptes.declareCompte, {
      projectId,
      plateforme: "Instagram",
      handle: `@e2ekw_ig${ts}`,
    });

    const shared = `e2ekw shared ${ts}`;

    // 1. Mot-clé posé sur le compte TikTok.
    await admin.mutation(api.comptes.updateWarmupProtocol, {
      id: ttId,
      keywords: [shared],
    });

    // 2. AVANT : ce 2e appel levait « Mot-clé déjà utilisé par @… ». MAINTENANT : OK.
    await admin.mutation(api.comptes.updateWarmupProtocol, {
      id: igId,
      keywords: [shared, `e2ekw autre ${ts}`],
    });

    const comptes = await admin.query(api.comptes.listComptes, {});
    const ig = comptes.find((c) => c._id === igId)!;
    const tt = comptes.find((c) => c._id === ttId)!;
    // Le mot-clé partagé vit sur les DEUX comptes.
    expect(tt.warmupProtocol?.keywords).toContain(shared);
    expect(ig.warmupProtocol?.keywords).toContain(shared);

    // 3. Dédup INTRA-compte (insensible à la casse) toujours appliquée.
    await admin.mutation(api.comptes.updateWarmupProtocol, {
      id: igId,
      keywords: [shared, shared.toUpperCase(), `e2ekw autre ${ts}`],
    });
    const igAfter = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === igId,
    )!;
    const occurrences = (igAfter.warmupProtocol?.keywords ?? []).filter(
      (k) => k.toLowerCase() === shared.toLowerCase(),
    ).length;
    expect(occurrences).toBe(1);

    // Nettoyage : comptes vierges supprimables.
    await admin.mutation(api.comptes.deleteCompte, { id: ttId });
    await admin.mutation(api.comptes.deleteCompte, { id: igId });
  });
});
