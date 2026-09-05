import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * OBSERVATION ADMIN DES ESPACES TALENT ET CLIPPEUR (TD-025) — preuve SERVEUR.
 *
 * La forme des assertions est la décision qui compte ici : chaque lecture
 * d'observation est comparée à CE QUE LA PERSONNE OBTIENT DE SA PROPRE SESSION,
 * pas à « non vide ». Une divergence d'allowlist — un champ qui sortirait pour
 * l'admin et pas pour elle, ou l'inverse — passerait un test « non vide » sans
 * qu'on le voie ; une égalité l'attrape. Chaque égalité est doublée d'une
 * assertion de CONTENU, sinon deux réponses vides seraient « égales » (la
 * fenêtre dégénérée, forme n°1 du chantier).
 *
 * La spec qui garantit la lecture seule n'est pas « le bouton est grisé » : elle
 * appelle les mutations talent et clippeur avec une session ADMIN et vérifie
 * qu'elles refusent. Le bouton est du confort ; le refus serveur est la garantie.
 *
 * Nommage `[E2E_TEST]` + emails `e2e-creator-*` : ramassés par le cleanup.
 */

const JOUR = 86_400_000;

/** Fiche + signUp réel (le même chemin que la personne). Nom COMPLET, comme en prod. */
async function inscrire(
  kind: "talent" | "clipper" | "partner",
  nom: string,
  ts: number,
  suffix: string,
): Promise<{
  creatorId: Id<"creators">;
  client: ConvexHttpClient;
  email: string;
  password: string;
}> {
  const email = `e2e-creator-va-${suffix}-${ts}@repackit.test`;
  const password = `va-${suffix}-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${nom}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  expect(res.tokens?.token).toBeTruthy();
  client.setAuth(res.tokens!.token);
  return { creatorId, client, email, password };
}

/** Le dépôt est fermé par défaut sur le projet e2e (slug `e2e-test`). */
async function ouvrirLeDepot() {
  await admin.mutation(api.projects.setTalentSettings, { fileDropEnabled: true });
}

/** Brief permanent : un format du projet, désigné comme brief talent. */
async function poserLeBrief(ts: number, texte: string) {
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Brief observation ${ts}`,
    type: "short",
    brief: texte,
    hooks: ["Accroche réservée à l'admin"],
    rateModel: { basePerPost: 42.5, viewBonusPer1k: 1.75 },
  });
  await admin.mutation(api.projects.setTalentSettings, {
    talentBriefFormatId: formatId as Id<"formats">,
  });
  return formatId as Id<"formats">;
}

/** Campagne montable sur un rush : hook + flux « afficher », cta sans mode (D7). */
async function campagneAffichable(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Observation ${ts}`,
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "hook",
    label: `hook ${ts}`,
    content: `Accroche affichée ${ts}`,
    tier: "S",
    mode: "afficher",
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "flux",
    label: `flux ${ts}`,
    content: `Corps affiché ${ts}`,
    mode: "afficher",
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "cta",
    label: `cta ${ts}`,
    content: `Appel à l'action ${ts}`,
  });
  return campaignId;
}

test.describe("Observation admin — espaces talent et clippeur", () => {
  test("observer un TALENT rend exactement ce que le talent lit", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await ouvrirLeDepot();
    const briefTexte = `Filme en extérieur, lumière du matin — consigne ${ts}`;
    await poserLeBrief(ts, briefTexte);

    const talent = await inscrire(
      "talent",
      `Camille Devauchelle talent ${ts}`,
      ts,
      "talent",
    );

    // Deux dépôts, dont un refusé : le motif de refus est le champ qui FRANCHIT
    // la frontière de rôle (écrit par l'admin, lu par le talent), donc celui dont
    // une divergence d'allowlist compterait le plus.
    const { rushId: gardé } = await talent.client.mutation(
      api.rushes.confirmDeposit,
      {
        projectId,
        driveFileId: `drive-va-ok-${ts}`,
        fileName: `prise-matin-${ts}.mov`,
        mimeType: "video/quicktime",
        sizeBytes: 33_554_431,
      },
    );
    const { rushId: refusé } = await talent.client.mutation(
      api.rushes.confirmDeposit,
      {
        projectId,
        driveFileId: `drive-va-ko-${ts}`,
        fileName: `prise-contrejour-${ts}.mov`,
        mimeType: "video/quicktime",
        sizeBytes: 19_283_746,
      },
    );
    const motif = "Contre-jour : on ne voit pas ton visage. Refilme face fenêtre.";
    await admin.mutation(api.rushes.rejectRush, { rushId: refusé, reason: motif });

    // ── Les dépôts ────────────────────────────────────────────────────────────
    const vuTalent = await talent.client.query(api.rushes.listMyRushes, {
      projectId,
    });
    const vuAdmin = await admin.query(api.rushes.listRushesAsAdmin, {
      creatorId: talent.creatorId,
    });
    // L'ÉGALITÉ est l'assertion utile : elle attrape une divergence d'allowlist
    // entre les deux chemins, qu'un « non vide » laisserait passer.
    expect(vuAdmin).toEqual(vuTalent);
    // …et le contenu empêche l'égalité DÉGÉNÉRÉE (deux listes vides).
    expect(vuAdmin).toHaveLength(2);
    expect(vuAdmin.map((r) => r.fileName).sort()).toEqual(
      [`prise-contrejour-${ts}.mov`, `prise-matin-${ts}.mov`].sort(),
    );
    expect(vuAdmin.find((r) => r._id === refusé)?.rejectionReason).toBe(motif);
    expect(vuAdmin.find((r) => r._id === gardé)?.status).toBe("deposited");

    // ── Le brief ──────────────────────────────────────────────────────────────
    const briefTalent = await talent.client.query(api.formats.getMyTalentBrief, {
      projectId,
    });
    const briefAdmin = await admin.query(api.formats.getTalentBriefAsAdmin, {
      creatorId: talent.creatorId,
    });
    expect(briefAdmin).toEqual(briefTalent);
    // Non-dégénéré : deux `null` seraient « égaux » sans rien prouver.
    expect(briefAdmin?.brief).toBe(briefTexte);
    // L'allowlist tient des DEUX côtés : un format porte aussi les textes de
    // script et la grille de paie, et l'observation ne les fait pas apparaître.
    const brut = JSON.stringify(briefAdmin);
    expect(brut).not.toContain("rateModel");
    expect(brut).not.toContain("Accroche réservée à l'admin");
  });

  test("observer un CLIPPEUR rend exactement ce que le clippeur lit", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await ouvrirLeDepot();

    const talent = await inscrire(
      "talent",
      `Salomé Bréhat talent ${ts}`,
      ts,
      "clip-talent",
    );
    const clipper = await inscrire(
      "clipper",
      `Ousmane Traoré clippeur ${ts}`,
      ts,
      "clip",
    );
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      clipperId: clipper.creatorId,
    });

    // Compte validé 13 jours plus TÔT (jamais aujourd'hui) → phase de croisière,
    // quota 2/jour : une valeur non dégénérée, contrairement à la phase de
    // chauffe où tout vaut 0.
    const handle = `@e2evaclip${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle,
      validatedAt: ts - 13 * JOUR,
    });

    // Un clip réel : rush du talent → script assigné → assignation au clippeur.
    const { rushId } = await talent.client.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-va-clip-${ts}`,
      fileName: `prise-clip-${ts}.mov`,
      mimeType: "video/quicktime",
      sizeBytes: 28_311_552,
    });
    const campaignId = await campagneAffichable(ts);
    const { assignmentId } = await admin.mutation(api.scripts.assignScriptToRush, {
      rushId,
      campaignId,
      targets: [target],
      dueDate: ts + 3 * JOUR,
      instructions: "Coupe le silence à la fin.",
    });

    // ── Ses comptes ───────────────────────────────────────────────────────────
    const comptesClippeur = await clipper.client.query(
      api.comptes.listMyClipperComptes,
      { projectId },
    );
    const comptesAdmin = await admin.query(
      api.comptes.listClipperComptesAsAdmin,
      { creatorId: clipper.creatorId },
    );
    expect(comptesAdmin).toEqual(comptesClippeur);
    expect(comptesAdmin).toHaveLength(1);
    expect(comptesAdmin[0].handle).toBe(handle);
    expect(comptesAdmin[0].validatedAt).toBe(ts - 13 * JOUR);
    expect(comptesAdmin[0].publiable).toBe(true);

    // ── Son quota ─────────────────────────────────────────────────────────────
    const quotaClippeur = await clipper.client.query(
      api.clipQuota.myQuotaWindow,
      { projectId },
    );
    const quotaAdmin = await admin.query(api.clipQuota.getQuotaWindowAsAdmin, {
      creatorId: clipper.creatorId,
    });
    // On compare les DONNÉES (par compte), pas les bornes : elles dérivent de
    // Date.now() à chaque appel et changeraient de journée UTC si le run
    // enjambait minuit — un faux rouge qui n'apprendrait rien.
    expect(quotaAdmin.comptes).toEqual(quotaClippeur.comptes);
    expect(quotaAdmin.comptes).toHaveLength(1);
    expect(quotaAdmin.comptes[0].handle).toBe(handle);
    expect(quotaAdmin.windowEnd - quotaAdmin.windowStart).toBe(30 * JOUR);

    // ── Sa file de clips ──────────────────────────────────────────────────────
    const clipsClippeur = await clipper.client.query(api.assignments.listMyClips, {
      projectId,
    });
    const clipsAdmin = await admin.query(api.assignments.listClipsAsAdmin, {
      creatorId: clipper.creatorId,
    });
    expect(clipsAdmin).toEqual(clipsClippeur);
    expect(clipsAdmin).toHaveLength(1);
    expect(clipsAdmin[0]._id).toBe(assignmentId);
    expect(clipsAdmin[0].assembledScript).toContain(`Accroche affichée ${ts}`);

    // ── La fiche d'un clip ────────────────────────────────────────────────────
    const ficheClippeur = await clipper.client.query(api.assignments.getMyClip, {
      projectId,
      id: assignmentId,
    });
    const ficheAdmin = await admin.query(api.assignments.getClipDetailAsAdmin, {
      creatorId: clipper.creatorId,
      id: assignmentId,
    });
    expect(ficheAdmin).toEqual(ficheClippeur);
    expect(ficheAdmin?.instructions).toBe("Coupe le silence à la fin.");
    // Contenu réel de la fiche. PAS `scriptZones` : le découpage en zones est
    // réservé au projet Snytch (convex/assignments.splitScriptZones) et vaut
    // `null` ici — deux `null` s'accordent sans rien prouver.
    expect(ficheAdmin?.assembledScript).toContain(`Corps affiché ${ts}`);
    expect(ficheAdmin?.targets).toHaveLength(1);
    expect(ficheAdmin?.targets[0].accountHandle).toBe(handle);
    // INVARIANT D'ARGENT, retenu des DEUX côtés : le clippeur est payé au clip,
    // un pricingSnapshot sur sa fiche serait le chemin du double paiement.
    expect(JSON.stringify(ficheAdmin)).not.toContain("pricingSnapshot");
  });

  test("le point d'entrée créateur n'a AUCUN argument d'identité", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await ouvrirLeDepot();

    const a = await inscrire("talent", `Inès Charpentier ${ts}`, ts, "iso-a");
    const b = await inscrire("talent", `Nadia Bouchard ${ts}`, ts + 1, "iso-b");
    await a.client.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-va-iso-${ts}`,
      fileName: `prise-privee-${ts}.mov`,
      mimeType: "video/quicktime",
      sizeBytes: 41_234_567,
    });

    // B lit SA liste, qui est vide — et il n'existe aucun argument par lequel il
    // désignerait A. C'est la forme exacte de l'interdit du chantier : deux
    // points d'entrée séparés, pas un point d'entrée à deux gardes.
    expect(
      await b.client.query(api.rushes.listMyRushes, { projectId }),
    ).toEqual([]);

    // Passer un creatorId à la query TALENT est refusé par le validateur : la
    // fonction n'a littéralement pas ce paramètre.
    await expect(
      b.client.query(api.rushes.listMyRushes, {
        projectId,
        creatorId: a.creatorId,
      } as unknown as { projectId: Id<"projects"> }),
    ).rejects.toThrow();

    // Et le point d'entrée qui, LUI, prend un creatorId exige le rôle admin : la
    // session d'un talent y est rejetée, quelle que soit la fiche visée.
    await expect(
      b.client.query(api.rushes.listRushesAsAdmin, {
        projectId,
        creatorId: a.creatorId,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);
    await expect(
      b.client.query(api.rushes.listRushesAsAdmin, {
        projectId,
        creatorId: b.creatorId,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);
  });

  test("les mutations talent et clippeur REFUSENT une session admin", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await ouvrirLeDepot();

    // Décor minimal : un clip réel, pour que les mutations clippeur portent sur
    // un objet EXISTANT — un refus obtenu sur un id inexistant ne prouverait pas
    // que c'est la garde de rôle qui a parlé.
    const talent = await inscrire("talent", `Théo Marchand ${ts}`, ts, "mut-t");
    const clipper = await inscrire("clipper", `Léa Fontaine ${ts}`, ts, "mut-c");
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      clipperId: clipper.creatorId,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2evamut${ts}`,
      validatedAt: ts - 13 * JOUR,
    });
    const { rushId } = await talent.client.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-va-mut-${ts}`,
      fileName: `prise-mut-${ts}.mov`,
      mimeType: "video/quicktime",
      sizeBytes: 30_123_456,
    });
    const campaignId = await campagneAffichable(ts);
    const { assignmentId } = await admin.mutation(api.scripts.assignScriptToRush, {
      rushId,
      campaignId,
      targets: [target],
      dueDate: ts + 3 * JOUR,
    });

    // Un vrai blob : sans lui, `submitClipVideo` échouerait sur la VALIDATION de
    // storageId et le rouge ne dirait rien de la garde de rôle (forme n°5 du
    // chantier — rouge pour la mauvaise raison). Les messages attendus sont
    // d'ailleurs assertés nommément, pour la même raison.
    // Session du clippeur, pas le client e2e : ce dernier injecte `projectId`
    // dans tous ses appels, or `generateUploadUrl` n'en prend pas.
    const uploadUrl = await clipper.client.mutation(
      api.storage.generateUploadUrl,
      {},
    );
    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    });
    const { storageId } = (await upload.json()) as { storageId: string };

    // ── TALENT ────────────────────────────────────────────────────────────────
    await expect(
      admin.mutation(api.rushes.confirmDeposit, {
        projectId,
        driveFileId: `drive-va-admin-${ts}`,
        fileName: `depot-admin-${ts}.mov`,
        mimeType: "video/quicktime",
        sizeBytes: 12_345_678,
      }),
    ).rejects.toThrow(/Réservé aux talents/i);

    // ── CLIPPEUR ──────────────────────────────────────────────────────────────
    await expect(
      admin.mutation(api.comptes.declareClipperCompte, {
        projectId,
        plateforme: "TikTok",
        handle: `@e2evaadmin${ts}`,
      }),
    ).rejects.toThrow(/Réservé aux clippeurs/i);
    await expect(
      admin.mutation(api.assignments.startClip, { projectId, id: assignmentId }),
    ).rejects.toThrow(/Réservé aux clippeurs/i);
    await expect(
      admin.mutation(api.assignments.submitClipVideo, {
        projectId,
        id: assignmentId,
        storageId: storageId as Id<"_storage">,
        mimeType: "video/mp4",
      }),
    ).rejects.toThrow(/Réservé aux clippeurs/i);
    await expect(
      admin.mutation(api.assignments.confirmClipPublication, {
        projectId,
        id: assignmentId,
        urls: [{ platform: "TikTok", url: "https://www.tiktok.com/@x/video/1" }],
      }),
    ).rejects.toThrow(/Réservé aux clippeurs/i);

    // Le clip n'a pas bougé : les refus ci-dessus n'ont rien écrit au passage.
    const apres = await admin.query(api.assignments.listAssignments, {});
    expect(apres.find((x) => x._id === assignmentId)?.status).toBe("todo");
  });

  test("l'observation refuse une fiche d'une AUTRE population", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await ouvrirLeDepot();
    await poserLeBrief(ts, `Consigne ${ts}`);

    const talent = await inscrire("talent", `Awa Diallo ${ts}`, ts, "pop-t");
    const clipper = await inscrire("clipper", `Marius Lévêque ${ts}`, ts, "pop-c");
    const partner = await inscrire("partner", `Jeanne Alvarez ${ts}`, ts, "pop-p");

    // Contrôle POSITIF d'abord : sans lui, un refus universel (une query cassée)
    // passerait pour une garde qui fonctionne.
    expect(
      await admin.query(api.rushes.listRushesAsAdmin, {
        creatorId: talent.creatorId,
      }),
    ).toEqual([]);
    expect(
      await admin.query(api.comptes.listClipperComptesAsAdmin, {
        creatorId: clipper.creatorId,
      }),
    ).toEqual([]);

    // Le point d'entrée TALENT refuse un clippeur et un partenaire…
    for (const cible of [clipper.creatorId, partner.creatorId]) {
      await expect(
        admin.query(api.rushes.listRushesAsAdmin, { creatorId: cible }),
      ).rejects.toThrow(/Réservé aux talents/i);
      // …y compris la query dont le creatorId ne FILTRE rien (le brief est au
      // projet) : c'est là que l'argument sert uniquement à cette garde.
      await expect(
        admin.query(api.formats.getTalentBriefAsAdmin, { creatorId: cible }),
      ).rejects.toThrow(/Réservé aux talents/i);
    }

    // …et le point d'entrée CLIPPEUR refuse un talent et un partenaire. Sans
    // cette garde, observer un partenaire par ce chemin servirait ses
    // assignations sous l'allowlist du clippeur — la vue fausse de #45, servie
    // par le serveur cette fois.
    for (const cible of [talent.creatorId, partner.creatorId]) {
      await expect(
        admin.query(api.assignments.listClipsAsAdmin, { creatorId: cible }),
      ).rejects.toThrow(/Réservé aux clippeurs/i);
      await expect(
        admin.query(api.comptes.listClipperComptesAsAdmin, { creatorId: cible }),
      ).rejects.toThrow(/Réservé aux clippeurs/i);
      await expect(
        admin.query(api.clipQuota.getQuotaWindowAsAdmin, { creatorId: cible }),
      ).rejects.toThrow(/Réservé aux clippeurs/i);
    }

    // NON-RÉGRESSION : l'observation PARTENAIRE, elle, n'a pas bougé — elle sert
    // toujours la fiche d'un partenaire (adminViewAsQuery reste kind-aveugle,
    // asymétrie assumée dans convex/functions.ts).
    const profil = await admin.query(api.creators.getProfileAsAdmin, {
      creatorId: partner.creatorId,
    });
    expect(profil?.name).toContain("Jeanne Alvarez");
  });

  test("le scoping projet de l'observation vaut aussi pour les deux populations", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const slugB = `e2e-va-pop-${ts}`;
    const { projectId: projectB } = await admin.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: slugB, name: `Observation B ${ts}` },
    );
    const { creatorId: talentB } = await admin.mutation(
      api.creators.inviteCreator,
      {
        projectId: projectB,
        name: `[E2E_TEST] Hélène Vasseur talent B ${ts}`,
        email: `e2e-creator-va-b-${ts}@repackit.test`,
        kind: "talent",
      },
    );

    // Fiche d'un AUTRE projet passée avec le projet e2e → introuvable, avant même
    // que la population soit regardée. Aucune fuite inter-projets.
    await expect(
      admin.query(api.rushes.listRushesAsAdmin, { creatorId: talentB }),
    ).rejects.toThrow(/introuvable dans ce projet/i);
    await expect(
      admin.query(api.clipQuota.getQuotaWindowAsAdmin, { creatorId: talentB }),
    ).rejects.toThrow(/introuvable dans ce projet/i);

    await admin.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: slugB,
    });
  });
});
