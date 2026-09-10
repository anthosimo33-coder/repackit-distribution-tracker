import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

test.describe("Admin publie EN SECOURS un compte de créatrice", () => {
  test("secours admin : traçabilité, bornes de date, dédup, aucune fuite créatrice", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Backup ${ts}`,
      type: "short",
      rateModel: { basePerPost: 50 },
    });
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Backup A ${ts}`,
      email: `e2e-backup-a-${ts}@repackit.test`,
      password: "backup-a-12345",
    });
    // Compte de CRÉATRICE (NON géré) sur TikTok — c'est le cas nouveau.
    const tA = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "TikTok",
      handle: `@e2ebackup${ts}`,
    });
    const r = await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorId: A.creatorId,
      targets: [tA],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    expect(r.created).toBe(1);
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid,
    )!;
    const aid = row._id;

    // PROCESS NON SUIVI : la créatrice a publié hors app, le statut est resté « À
    // faire » (todo, jamais passé to_publish). C'EST le cas d'usage du secours.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "todo",
    });

    const url = `https://www.tiktok.com/@e2ebackup${ts}/video/1`;

    // La créatrice, elle, ne peut PAS publier depuis « À faire » : gate to_publish
    // CONSERVÉ côté créatrice (seul l'admin en secours le court-circuite).
    await expect(
      A.client.mutation(api.assignments.confirmPublication, {
        projectId: A.projectId,
        id: aid,
        urls: [{ platform: "TikTok", url }],
      }),
    ).rejects.toThrow(/validation/i);

    // BORNES de la date réelle : futur REJETÉ (dur), antérieur à la création
    // REFUSÉ PAR DÉFAUT — mais franchissable, cf. test « régularisation » plus bas.
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: aid,
        urls: [{ platform: "TikTok", url }],
        publishedAt: ts + DAY,
      }),
    ).rejects.toThrow(/futur/i);
    // Le message DOIT porter la date de création : sans elle, l'admin ne sait pas
    // quelle date serait acceptée. On l'exige au format rendu (JJ/MM/AA HH:MM), et
    // pas seulement le mot « création » — c'est le défaut qui a motivé le correctif.
    // Fuseau ÉPINGLÉ des deux côtés : le backend tourne en UTC, l'admin lit Paris.
    // Sans l'épingle ce test passerait sur un poste à Paris et casserait en CI.
    const created = new Date(row.createdAt).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris",
    });
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: aid,
        urls: [{ platform: "TikTok", url }],
        publishedAt: row.createdAt - DAY,
      }),
    ).rejects.toThrow(
      new RegExp(created.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    // SECOURS : l'admin publie une assignation restée « À faire » (fromAnyStatus)
    // → passage DIRECT en publiée. Sans override → date = maintenant.
    const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: aid,
      urls: [{ platform: "TikTok", url }],
    });
    expect(pub.alreadyPublished).toBe(false);

    // Traçabilité ADMIN visible côté admin.
    const after = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === aid,
    )!;
    expect(after.status).toBe("published");
    expect((after as Record<string, unknown>).publishedBy).toBe("admin");

    // CÔTÉ CRÉATRICE : publié, MAIS `publishedBy` JAMAIS exposé (elle ne doit pas
    // voir que l'admin a saisi le lien à sa place).
    const mine = await A.client.query(api.assignments.getMyAssignment, {
      projectId: A.projectId,
      id: aid,
    });
    expect(mine?.assignment.status).toBe("published");
    expect(
      (mine!.assignment as Record<string, unknown>).publishedBy,
    ).toBeUndefined();

    // DOUBLON : la créatrice colle SON lien après coup → idempotent, aucune 2e
    // publication, et l'auteur d'origine (admin) n'est PAS réécrit.
    const again = await A.client.mutation(api.assignments.confirmPublication, {
      projectId: A.projectId,
      id: aid,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@e2ebackup${ts}/video/999` },
      ],
    });
    expect(again.alreadyPublished).toBe(true);
    const stillAdmin = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((a) => a._id === aid)!;
    expect((stillAdmin as Record<string, unknown>).publishedBy).toBe("admin");

    // Cleanup
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "todo",
    });
  });

  /**
   * RÉGULARISATION — le cas que la borne de création interdisait sans le dire :
   * le post existe DÉJÀ en ligne, l'assignation est créée après coup. Le refus par
   * défaut est CONSERVÉ (l'admin doit voir la date de création) ; `allowBackdate`
   * le franchit et la date réelle est GARDÉE telle quelle.
   *
   * Les deux assertions vont par paire : refus SANS le drapeau (absence), succès
   * AVEC + date réellement conservée (présence). Sans la seconde, un serveur qui
   * ignorerait la date en silence passerait le test.
   */
  test("régularisation : antidater est refusé par défaut, accepté sur confirmation", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Backdate ${ts}`,
      type: "short",
      rateModel: { basePerPost: 50 },
    });
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Backdate A ${ts}`,
      email: `e2e-backdate-a-${ts}@repackit.test`,
      password: "backdate-a-12345",
    });
    const tA = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "TikTok",
      handle: `@e2ebackdate${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorId: A.creatorId,
      targets: [tA],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid,
    )!;
    const url = `https://www.tiktok.com/@e2ebackdate${ts}/video/1`;
    // Post sorti 3 JOURS AVANT que l'assignation existe (forme réelle : on
    // régularise après coup, pas un décalage d'une minute).
    const reallyPublishedAt = row.createdAt - 3 * DAY;

    // 1. SANS le drapeau → refus, et le message porte la date de création.
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: row._id,
        urls: [{ platform: "TikTok", url }],
        publishedAt: reallyPublishedAt,
      }),
    ).rejects.toThrow(/ERR_PUBLISHED_AT_BEFORE_CREATION/);

    // 2. AVEC le drapeau → publié, et la date réelle est CONSERVÉE (pas réécrite
    //    en `now`, sinon la régularisation ne servirait à rien).
    const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: row._id,
      urls: [{ platform: "TikTok", url }],
      publishedAt: reallyPublishedAt,
      allowBackdate: true,
    });
    expect(pub.alreadyPublished).toBe(false);
    const after = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === row._id,
    )!;
    expect(after.status).toBe("published");
    expect(after.postedAt).toBe(reallyPublishedAt);

    // 3. Le drapeau ne relâche QUE cette borne : le futur reste refusé.
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: row._id,
        urls: [{ platform: "TikTok", url }],
        publishedAt: ts + DAY,
        allowBackdate: true,
      }),
    ).rejects.toThrow(/futur/i);

    // Cleanup
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: row._id,
      status: "todo",
    });
  });
});
