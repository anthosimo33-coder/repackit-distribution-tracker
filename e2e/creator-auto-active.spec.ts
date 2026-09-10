import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * ACTIVATION AUTOMATIQUE — « un compte validé, et la fiche n'est plus en
 * onboarding ». Le câblage se joue dans `updateCompte`/`unarchiveCompte`
 * (convex/comptes.ts) ; la décision et le patch sont testés en unitaire
 * (lib/creator-activation.test.ts).
 *
 * Le compte passe par `declareManagedCompte`, le chemin ADMIN qui pose
 * `creatorId` : c'est le même document qu'un compte déclaré par la créatrice
 * (warmup, sans ancre), et il ne dépend pas d'une session de portail.
 */

/** Fiche en ONBOARDING — l'état réel d'une créatrice qui a accepté son lien. */
async function ficheEnOnboarding(
  kind: "partner" | "talent",
  label: string,
  ts: number,
  status: "onboarding" | "churned" = "onboarding",
): Promise<Id<"creators">> {
  const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
    // Libellé sans mot commun avec les pseudos des autres specs (audit de pseudo).
    name: `[E2E_TEST] ${label} ${ts}`,
    email: `e2e-${label}-${ts}@repackit.test`,
    kind,
  });
  await admin.mutation(api.creators.updateCreator, { id: creatorId, status });
  return creatorId;
}

const statutDe = async (id: Id<"creators">) =>
  (await admin.query(api.creators.getCreator, { id }))!;

test.describe("Créateur — activation automatique au premier compte validé", () => {
  test("le compte en warmup laisse la fiche en onboarding, sa validation l'active", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creatorId = await ficheEnOnboarding("partner", "autoactive", ts);
    const compteId = await admin.mutation(api.comptes.declareManagedCompte, {
      creatorId,
      plateforme: "TikTok" as const,
      handle: `@e2eautoactive${ts}`,
    });

    // L'ÉTAT OPPOSÉ, sans lequel l'assertion suivante ne prouve rien : un compte
    // déclaré arrive en warmup, et un compte en warmup n'active personne.
    expect((await statutDe(creatorId)).status).toBe("onboarding");

    await admin.mutation(api.comptes.updateCompte, {
      id: compteId,
      status: "actif",
    });
    const apres = await statutDe(creatorId);
    expect(apres.status).toBe("active");
    // Partenaire : PAS d'ancre de paie (elle recalerait ses cycles sur une date
    // antérieure à son premier post).
    expect(apres.payAnchorAt).toBeUndefined();
  });

  test("valider le compte d'un talent pose son ancre de paie", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 1;
    const creatorId = await ficheEnOnboarding("talent", "autotalent", ts);
    const compteId = await admin.mutation(api.comptes.declareManagedCompte, {
      creatorId,
      plateforme: "TikTok" as const,
      handle: `@e2eautotalent${ts}`,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: compteId,
      status: "actif",
    });

    const apres = await statutDe(creatorId);
    expect(apres.status).toBe("active");
    // Sans ancre, un talent activé n'apparaît dans AUCUN cycle de paie et
    // `markCyclePaid` jette : c'est la moitié la plus coûteuse de l'activation.
    expect(apres.payAnchorAt).toBeGreaterThan(0);
  });

  test("une fiche partie n'est pas ressuscitée par une validation", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 2;
    const creatorId = await ficheEnOnboarding(
      "partner",
      "autochurn",
      ts,
      "churned",
    );
    const compteId = await admin.mutation(api.comptes.declareManagedCompte, {
      creatorId,
      plateforme: "TikTok" as const,
      handle: `@e2eautochurn${ts}`,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: compteId,
      status: "actif",
    });

    expect((await statutDe(creatorId)).status).toBe("churned");
  });
});
