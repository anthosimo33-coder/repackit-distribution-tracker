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
 * File de validation, refus motivé, appariement clippeur↔talent, et avertissement
 * de phase à l'assignation.
 *
 * Le clippeur ne peut pas encore déclarer ses comptes (son espace est une
 * coquille) : on passe par `declareManagedCompte`, le chemin ADMIN qui pose
 * `creatorId` à la création. Le compte obtenu est identique à celui que le
 * clippeur déclarera en PR 6 (même statut warmup, même absence d'ancre).
 */

/** Fiche de la population voulue (pas d'onboarding : aucune assignation ici). */
async function fiche(
  kind: "clipper" | "partner" | "talent",
  label: string,
  ts: number,
): Promise<Id<"creators">> {
  const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${label} ${ts}`,
    email: `e2e-${label}-${ts}@repackit.test`,
    kind,
  });
  return creatorId;
}

const compte = (creatorId: Id<"creators">, handle: string) =>
  admin.mutation(api.comptes.declareManagedCompte, {
    creatorId,
    plateforme: "TikTok" as const,
    handle,
  });

test.describe("Comptes — file de validation et refus", () => {
  test("la file ne contient QUE les comptes de clippeur non validés", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const clipperId = await fiche("clipper", "clip-file", ts);
    const partnerId = await fiche("partner", "part-file", ts);
    const idClip = await compte(clipperId, `@e2efile.clip${ts}`);
    const idPart = await compte(partnerId, `@e2efile.part${ts}`);

    const file = await admin.query(api.comptes.listComptesAValider, {});
    const ids = file.map((c) => c._id);
    expect(ids).toContain(idClip);
    // Un compte de PARTENAIRE en warmup n'est pas « à valider » : son warmup se
    // termine par des checks réels, pas par une décision (arbitrage D3). Sans ce
    // filtre la file listerait tous les warmups du projet.
    expect(ids).not.toContain(idPart);

    // Valider POSE l'ancre de phase — c'est tout l'objet de la file.
    await admin.mutation(api.comptes.updateCompte, {
      id: idClip,
      status: "actif",
    });
    const apres = await admin.query(api.comptes.listComptesAValider, {});
    expect(apres.map((c) => c._id)).not.toContain(idClip);
  });

  test("l'audit signale un pseudo qui annonce la marque, sans bloquer", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 1;
    const clipperId = await fiche("clipper", "clip-audit", ts);
    // Le projet e2e s'appelle « E2E Test » → on cible le talent, dont le nom
    // est sous notre contrôle.
    await fiche("talent", "Zorglubine", ts);
    const idSuspect = await compte(clipperId, `@zorglubine.clips${ts}`);
    const idNeutre = await compte(clipperId, `@quotidien.neutre${ts}`);

    const file = await admin.query(api.comptes.listComptesAValider, {});
    const suspect = file.find((c) => c._id === idSuspect)!;
    const neutre = file.find((c) => c._id === idNeutre)!;
    expect(suspect.audit.mentionsTalent).not.toBeNull();
    expect(neutre.audit.mentionsTalent).toBeNull();
    expect(neutre.audit.mentionsProduct).toBeNull();

    // L'audit n'empêche RIEN : le compte signalé se valide normalement.
    await admin.mutation(api.comptes.updateCompte, {
      id: idSuspect,
      status: "actif",
    });
  });

  test("refuser archive, exige un motif, et n'écrase pas le premier refus", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 2;
    const clipperId = await fiche("clipper", "clip-refus", ts);
    const id = await compte(clipperId, `@e2erefus${ts}`);

    await expect(
      admin.mutation(api.comptes.refuseCompte, { id, reason: "   " }),
    ).rejects.toThrow(/motif/i);

    const r1 = await admin.mutation(api.comptes.refuseCompte, {
      id,
      reason: "Le pseudo annonce la marque.",
    });
    expect(r1.alreadyRefused).toBe(false);

    // Sorti de la file, et archivé.
    const file = await admin.query(api.comptes.listComptesAValider, {});
    expect(file.map((c) => c._id)).not.toContain(id);

    // Idempotent : le PREMIER refus est celui qui compte.
    const r2 = await admin.mutation(api.comptes.refuseCompte, {
      id,
      reason: "Autre motif.",
    });
    expect(r2.alreadyRefused).toBe(true);
  });
});

test.describe("Appariement clippeur ↔ talent", () => {
  test("apparier, dépairer, et refuser les cibles qui n'ont pas de sens", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 3;
    const clipperId = await fiche("clipper", "clip-pair", ts);
    const talentId = await fiche("talent", "tal-pair", ts);
    const partnerId = await fiche("partner", "part-pair", ts);

    await admin.mutation(api.creators.updateCreator, {
      id: talentId,
      clipperId,
    });
    let list = await admin.query(api.creators.listCreators, {});
    expect(list.find((c) => c._id === talentId)?.clipperId).toBe(clipperId);

    // Dépairer : le talent redevient invisible de tout clippeur.
    await admin.mutation(api.creators.updateCreator, {
      id: talentId,
      clipperId: null,
    });
    list = await admin.query(api.creators.listCreators, {});
    expect(list.find((c) => c._id === talentId)?.clipperId).toBeUndefined();

    // Les deux invariants portés par la mutation (PR 4), re-vérifiés ici parce
    // que l'écran s'appuie dessus au lieu de les redéfinir.
    await expect(
      admin.mutation(api.creators.updateCreator, {
        id: partnerId,
        clipperId,
      }),
    ).rejects.toThrow(/talent/i);
    await expect(
      admin.mutation(api.creators.updateCreator, {
        id: talentId,
        clipperId: talentId,
      }),
    ).rejects.toThrow(/clippeur/i);
  });
});

test.describe("Avertissement de phase à l'assignation", () => {
  test("phase exposée pour un clippeur, JAMAIS pour un partenaire", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 4;
    const clipperId = await fiche("clipper", "clip-phase", ts);
    const partnerId = await fiche("partner", "part-phase", ts);
    const idClip = await compte(clipperId, `@e2ephase.clip${ts}`);
    const idPart = await compte(partnerId, `@e2ephase.part${ts}`);

    // Les deux passent en actif → les DEUX reçoivent une ancre `validatedAt`,
    // c'est précisément ce qui rend la garde nécessaire.
    for (const id of [idClip, idPart]) {
      await admin.mutation(api.comptes.updateCompte, { id, status: "actif" });
    }

    const pourClippeur = await admin.query(
      api.comptes.listCreatorAvailableComptes,
      { creatorId: clipperId },
    );
    const ligneClip = pourClippeur.find((c) => c._id === idClip)!;
    expect(ligneClip.phase).toBe("chauffe");
    expect(ligneClip.postsPerDay).toBe(0);
    expect(ligneClip.sortieDeChauffeAt).not.toBeNull();
    // `available` est INCHANGÉ : le compte reste cochable, seule l'information
    // s'ajoute. C'est tout l'arbitrage « avertir sans bloquer ».
    expect(ligneClip.available).toBe(true);

    const pourPartenaire = await admin.query(
      api.comptes.listCreatorAvailableComptes,
      { creatorId: partnerId },
    );
    const lignePart = pourPartenaire.find((c) => c._id === idPart)!;
    // Le modèle de phase ne concerne PAS les partenaires (arbitrage D3) —
    // l'exposer ici le ferait fuiter dans un écran qui n'en relève pas.
    expect(lignePart.phase).toBeNull();
    expect(lignePart.postsPerDay).toBeNull();
    expect(lignePart.sortieDeChauffeAt).toBeNull();
  });
});
