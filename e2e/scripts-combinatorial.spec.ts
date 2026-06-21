import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import {
  assembleScript,
  countCombinations,
} from "../lib/scriptAssembly";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * S1 — système de scripts combinatoire. Prouvé au niveau SERVEUR (CRUD via le
 * client admin) ; countCombinations / assembleScript sont les helpers purs
 * (lib) consommés tels quels par l'UI.
 */
test.describe("S1 — campagnes & bricks combinatoires", () => {
  test("CRUD, countCombinations, aperçu, import biblio intacte, désactivation", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Camp ${ts}`,
    });

    // 2 hooks (tiers S/A) + 2 flux + 2 cta (refonte 3 briques).
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: "H1",
      content: "Hook un",
      tier: "S",
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: "H2",
      content: "Hook deux",
      tier: "A",
    });
    for (const [label, content] of [
      ["F1", "Flux un"],
      ["F2", "Flux deux"],
    ]) {
      await admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind: "flux",
        label,
        content,
      });
    }
    for (const [label, content] of [
      ["A1", "Cta un"],
      ["A2", "Cta deux"],
    ]) {
      await admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind: "cta",
        label,
        content,
      });
    }

    // countCombinations = 2×2×2 = 8 (hook × flux × cta).
    let camp = (await admin.query(api.scripts.getCampaign, { id: campaignId }))!;
    expect(camp).toBeTruthy();
    expect(countCombinations(camp.bricks).total).toBe(8);
    // Tiers présents sur les hooks uniquement.
    const hooks = camp.bricks.filter((b) => b.kind === "hook");
    expect(hooks.map((h) => h.tier).sort()).toEqual(["A", "S"]);
    expect(
      camp.bricks
        .filter((b) => b.kind !== "hook")
        .every((b) => b.tier === undefined),
    ).toBe(true);

    // Aperçu : assemble la 1re brique active de chaque kind, ordre hook→flux→cta.
    const pick = (k: "hook" | "flux" | "cta") =>
      camp.bricks.find((b) => b.kind === k && b.active)!;
    const assembled = assembleScript({
      hook: pick("hook").content,
      flux: pick("flux").content,
      cta: pick("cta").content,
    });
    expect(assembled).not.toContain("## ");
    expect(assembled.indexOf("Hook un")).toBeLessThan(
      assembled.indexOf("Flux un"),
    );
    expect(assembled.indexOf("Flux un")).toBeLessThan(
      assembled.indexOf("Cta un"),
    );

    // Désactiver UN flux → 2×1×2 = 4.
    const aFlux = camp.bricks.find((b) => b.kind === "flux")!;
    await admin.mutation(api.scripts.updateBrick, {
      id: aFlux._id,
      active: false,
    });
    camp = (await admin.query(api.scripts.getCampaign, { id: campaignId }))!;
    expect(countCombinations(camp.bricks).byKind.flux).toBe(1);
    expect(countCombinations(camp.bricks).total).toBe(4);

    // Réactiver → retour à 8.
    await admin.mutation(api.scripts.updateBrick, {
      id: aFlux._id,
      active: true,
    });
    camp = (await admin.query(api.scripts.getCampaign, { id: campaignId }))!;
    expect(countCombinations(camp.bricks).total).toBe(8);

    // Import d'un hook de la BIBLIOTHÈQUE → copie, biblio intacte.
    const libHooks = await admin.query(api.hooks.listHooks, {});
    expect(libHooks.length).toBeGreaterThan(0);
    const hooksCountBefore = await admin.query(api.hooks.countHooks, {});
    const imp = await admin.mutation(api.scripts.importHooks, {
      campaignId,
      hookIds: [libHooks[0]._id],
    });
    expect(imp.imported).toBe(1);
    const hooksCountAfter = await admin.query(api.hooks.countHooks, {});
    expect(hooksCountAfter).toBe(hooksCountBefore); // biblio inchangée

    camp = (await admin.query(api.scripts.getCampaign, { id: campaignId }))!;
    const imported = camp.bricks.find(
      (b) => b.kind === "hook" && b.content === libHooks[0].text,
    );
    expect(imported).toBeTruthy(); // copie indépendante
    expect(imported!.tier ?? null).toBeNull(); // taggable plus tard
    // 3 hooks × 2 flux × 2 cta = 12.
    expect(camp.bricks.filter((b) => b.kind === "hook").length).toBe(3);
    expect(countCombinations(camp.bricks).total).toBe(12);
  });

  test("UI : détail campagne affiche les combos + aperçu monté", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] CampUI ${ts}`,
    });
    for (const kind of ["hook", "flux", "cta"] as const) {
      for (let i = 1; i <= 2; i++) {
        await admin.mutation(api.scripts.createBrick, {
          campaignId,
          kind,
          label: `${kind}-${i}`,
          content: `${kind} contenu ${i}`,
          ...(kind === "hook" ? { tier: i === 1 ? "S" : "A" } : {}),
        });
      }
    }

    await page.goto(adminPath(`/scripts/${campaignId}`));
    // Compteur de combinaisons (2×2×2 = 8).
    await expect(page.getByTestId("combo-count")).toContainText("8", {
      timeout: 15_000,
    });

    // Aperçu d'un script monté → rendu = hook + flux + cta (sans démo).
    await page.getByRole("button", { name: /aperçu d'un script/i }).click();
    const out = page.getByTestId("preview-output");
    await expect(out).toContainText("hook contenu", { timeout: 10_000 });
    await expect(out).toContainText("flux contenu");
  });

  test("garde serveur : un creator n'accède à rien", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ScriptsGuard ${ts}`,
      email: `e2e-creator-scripts-${ts}@repackit.test`,
      password: "scripts-guard-123",
    });
    const projectId = creator.projectId;

    // Toutes les fonctions scripts sont adminQuery/adminMutation → creator rejeté.
    await expect(
      creator.client.query(api.scripts.listCampaigns, { projectId }),
    ).rejects.toThrow();
    await expect(
      creator.client.mutation(api.scripts.createCampaign, {
        projectId,
        name: "intrusion",
      }),
    ).rejects.toThrow();
  });
});
