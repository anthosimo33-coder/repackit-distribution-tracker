import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

/**
 * Bio à mettre (par compte) — preuves SERVEUR : transitions d'état garanties
 * côté serveur (pose/modif → to_apply, confirme → applied, re-modif → to_apply),
 * suivi admin de l'application, et isolation (le créateur ne confirme que SES
 * comptes ; pas de fuite ; setAccountBio réservé à l'admin).
 */
test.describe("Bio à mettre — serveur", () => {
  test("pose → to_apply ; confirme → applied ; re-modif → to_apply", async () => {
    const ts = Date.now();
    const admin = createE2eClient(convexUrl);
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Bio A ${ts}`,
      email: `e2e-bio-a-${ts}@repackit.test`,
      password: "creator-bio-a-12345",
    });

    const compteId = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2ebio${ts}`,
    });

    // Au départ : aucune bio définie.
    const before = (
      await A.client.query(api.comptes.listMyComptes, {
        projectId: A.projectId,
      })
    ).find((c) => c._id === compteId);
    expect(before?.bioToApply).toBeUndefined();
    expect(before?.bioStatus).toBeUndefined();

    // 1) L'admin pose une bio → "to_apply" + bioUpdatedAt, pas de bioAppliedAt.
    await admin.mutation(api.comptes.setAccountBio, {
      id: compteId,
      bio: "Lien en bio 👉 repack.it/v1",
    });
    const posed = (
      await A.client.query(api.comptes.listMyComptes, {
        projectId: A.projectId,
      })
    ).find((c) => c._id === compteId);
    expect(posed?.bioToApply).toBe("Lien en bio 👉 repack.it/v1");
    expect(posed?.bioStatus).toBe("to_apply");
    expect(typeof posed?.bioUpdatedAt).toBe("number");
    expect(posed?.bioAppliedAt).toBeUndefined();

    // L'admin voit l'état "en attente" (via listComptes).
    const adminView1 = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === compteId,
    );
    expect(adminView1?.bioStatus).toBe("to_apply");

    // 2) Le créateur confirme → "applied" + bioAppliedAt.
    await A.client.mutation(api.comptes.confirmAccountBioApplied, {
      projectId: A.projectId,
      id: compteId,
    });
    const applied = (
      await A.client.query(api.comptes.listMyComptes, {
        projectId: A.projectId,
      })
    ).find((c) => c._id === compteId);
    expect(applied?.bioStatus).toBe("applied");
    expect(typeof applied?.bioAppliedAt).toBe("number");

    // L'admin voit "appliquée" + la date.
    const adminView2 = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === compteId,
    );
    expect(adminView2?.bioStatus).toBe("applied");
    expect(typeof adminView2?.bioAppliedAt).toBe("number");

    // 3) L'admin re-modifie → repasse "to_apply" + purge bioAppliedAt.
    await admin.mutation(api.comptes.setAccountBio, {
      id: compteId,
      bio: "Nouvelle bio v2 ✨",
    });
    const remod = (
      await A.client.query(api.comptes.listMyComptes, {
        projectId: A.projectId,
      })
    ).find((c) => c._id === compteId);
    expect(remod?.bioToApply).toBe("Nouvelle bio v2 ✨");
    expect(remod?.bioStatus).toBe("to_apply");
    expect(remod?.bioAppliedAt).toBeUndefined();
  });

  test("re-sauver le même texte est un no-op (n'écrase pas l'état applied)", async () => {
    const ts = Date.now();
    const admin = createE2eClient(convexUrl);
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Bio noop ${ts}`,
      email: `e2e-bio-noop-${ts}@repackit.test`,
      password: "creator-bio-noop-12345",
    });
    const compteId = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2ebionoop${ts}`,
    });

    await admin.mutation(api.comptes.setAccountBio, {
      id: compteId,
      bio: "Bio stable",
    });
    await A.client.mutation(api.comptes.confirmAccountBioApplied, {
      projectId: A.projectId,
      id: compteId,
    });
    // Re-sauver EXACTEMENT le même texte → reste "applied".
    await admin.mutation(api.comptes.setAccountBio, {
      id: compteId,
      bio: "Bio stable",
    });
    const after = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === compteId,
    );
    expect(after?.bioStatus).toBe("applied");
  });

  test("isolation : B ne voit pas la bio de A et ne peut pas la confirmer", async () => {
    const ts = Date.now();
    const admin = createE2eClient(convexUrl);
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Bio iso A ${ts}`,
      email: `e2e-bio-isoa-${ts}@repackit.test`,
      password: "creator-bio-isoa-12345",
    });
    const B = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Bio iso B ${ts}`,
      email: `e2e-bio-isob-${ts}@repackit.test`,
      password: "creator-bio-isob-12345",
    });
    const aCompte = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2ebioiso${ts}`,
    });
    await admin.mutation(api.comptes.setAccountBio, {
      id: aCompte,
      bio: "Bio privée de A",
    });

    // B ne voit pas le compte de A (donc pas sa bio).
    const bMine = await B.client.query(api.comptes.listMyComptes, {
      projectId: B.projectId,
    });
    expect(bMine.some((c) => c._id === aCompte)).toBe(false);

    // B ne peut pas confirmer la bio du compte de A.
    await expect(
      B.client.mutation(api.comptes.confirmAccountBioApplied, {
        projectId: B.projectId,
        id: aCompte,
      }),
    ).rejects.toThrow(/introuvable/i);

    // Un créateur n'est PAS admin : il ne peut pas définir de bio.
    await expect(
      A.client.mutation(api.comptes.setAccountBio, {
        projectId: A.projectId,
        id: aCompte,
        bio: "tentative",
      }),
    ).rejects.toThrow(/administrateur|réservé|refusé/i);
  });
});
