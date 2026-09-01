import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createCreatorSession } from "./helpers/creator-client";
import { createE2eClient } from "./helpers/authed-client";
import { dayKey } from "../convex/creatorDay";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

const admin = createE2eClient(convexUrl);

const NY = "America/New_York";
const LA = "America/Los_Angeles";

/**
 * CHANTIER FUSEAUX — le check de warmup est daté dans l'horloge de la CRÉATRICE.
 *
 * Preuves SERVEUR (le jour du check est décidé côté Convex, pas dans le
 * navigateur). Ce fichier tourne DEUX FOIS — projets `chromium-newyork` et
 * `chromium-losangeles`. Le fuseau du navigateur ne change rien à ces
 * assertions-ci, mais c'est ce périmètre que rejoindront les specs d'AFFICHAGE,
 * où il changera tout — et où un correctif juste à New York peut être faux à
 * Los Angeles.
 *
 * ⚠️ Ces assertions sont vraies à N'IMPORTE QUELLE heure d'exécution : elles
 * comparent la clé écrite au jour de la créatrice calculé au même instant,
 * jamais à une date en dur. Une spec qui n'aurait été verte qu'entre 20 h et
 * minuit n'aurait rien prouvé le reste du temps.
 */
test.describe("Warmup — le jour du check suit le fuseau de la créatrice", () => {
  test("check daté du jour VÉCU à New York, pas du jour UTC", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fuseau NY ${ts}`,
      email: `e2e-fuseau-ny-${ts}@repackit.test`,
      password: "creator-fny-12345",
    });

    // Elle confirme son fuseau, comme à sa première connexion.
    const confirme = await A.client.mutation(api.creators.confirmMyTimezone, {
      projectId: A.projectId,
      timezone: NY,
    });
    expect(confirme).toEqual({ timezone: NY, source: "confirmed" });

    // La provenance est lisible ensuite — c'est un FAIT, pas une supposition.
    expect(
      await A.client.query(api.creators.getMyTimezone, {
        projectId: A.projectId,
      }),
    ).toEqual({ timezone: NY, source: "confirmed" });

    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2efny${ts}`,
    });

    const avant = Date.now();
    await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    const apres = Date.now();

    const comptes = await A.client.query(api.comptes.listMyComptes, {
      projectId: A.projectId,
    });
    const compte = comptes.find((c) => c._id === id);
    const checks = compte?.warmupProtocol?.dailyChecks ?? [];
    expect(checks).toHaveLength(1);

    // La clé écrite est le jour de la créatrice à l'instant du check. On encadre
    // l'instant serveur par avant/après pour rester juste même si la mutation
    // franchit minuit pendant son exécution.
    expect([dayKey(avant, NY), dayKey(apres, NY)]).toContain(checks[0]);

    // Et le compte est bien « coché aujourd'hui » au sens du serveur.
    expect(compte?.doneToday).toBe(true);
    expect(compte?.dueToday).toBe(false);
    // Le fuseau retenu est servi avec le compte : l'écran n'a rien à deviner.
    expect(compte?.creatorTimezone).toBe(NY);
  });

  test("le 2e check du même jour LOCAL est refusé", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fuseau NY bis ${ts}`,
      email: `e2e-fuseau-ny2-${ts}@repackit.test`,
      password: "creator-fny2-12345",
    });
    await A.client.mutation(api.creators.confirmMyTimezone, {
      projectId: A.projectId,
      timezone: NY,
    });
    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2efny2${ts}`,
    });
    await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    await expect(
      A.client.mutation(api.comptes.markWarmupCheck, {
        projectId: A.projectId,
        id,
      }),
    ).rejects.toThrow(/ERR_WARMUP_CHECK_ALREADY_DONE/);
  });

  test("changer de fuseau change le jour retenu, sans toucher l'historique", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fuseau LA ${ts}`,
      email: `e2e-fuseau-la-${ts}@repackit.test`,
      password: "creator-fla-12345",
    });
    await A.client.mutation(api.creators.confirmMyTimezone, {
      projectId: A.projectId,
      timezone: LA,
    });
    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2efla${ts}`,
    });
    const avant = Date.now();
    await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    const apres = Date.now();

    const comptes = await A.client.query(api.comptes.listMyComptes, {
      projectId: A.projectId,
    });
    const checks =
      comptes.find((c) => c._id === id)?.warmupProtocol?.dailyChecks ?? [];
    expect([dayKey(avant, LA), dayKey(apres, LA)]).toContain(checks[0]);
  });

  test("fuseau inconnu ⇒ comportement d'AVANT (UTC), jamais Paris", async () => {
    // Aucune confirmation, aucun pays sur le compte → fuseau indéterminable.
    // La règle du chantier : on ne devine pas, et surtout pas Paris.
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fuseau vide ${ts}`,
      email: `e2e-fuseau-vide-${ts}@repackit.test`,
      password: "creator-fvide-12345",
    });
    expect(
      await A.client.query(api.creators.getMyTimezone, {
        projectId: A.projectId,
      }),
    ).toEqual({ timezone: null, source: null });

    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2efvide${ts}`,
    });
    const avant = Date.now();
    await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    const apres = Date.now();

    const comptes = await A.client.query(api.comptes.listMyComptes, {
      projectId: A.projectId,
    });
    const compte = comptes.find((c) => c._id === id);
    const checks = compte?.warmupProtocol?.dailyChecks ?? [];
    // Clé UTC — strictement l'ancien comportement.
    expect([
      new Date(avant).toISOString().slice(0, 10),
      new Date(apres).toISOString().slice(0, 10),
    ]).toContain(checks[0]);
    expect(compte?.creatorTimezone).toBeNull();
  });

  test("le fuseau DÉDUIT est FIGÉ au premier check, pas recalculé après", async () => {
    // Sans gel, le fuseau d'une créatrice sans valeur stockée est une pure
    // fonction du pays de ses comptes, relue à CHAQUE lecture : lui ajouter un
    // compte d'un autre pays ferait basculer son horloge en silence, et la
    // frontière de « aujourd'hui » se déplacerait sous ses checks déjà posés.
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fuseau gel ${ts}`,
      email: `e2e-fuseau-gel-${ts}@repackit.test`,
      password: "creator-fgel-12345",
    });

    // 1 compte US → déduction America/New_York, RIEN de stocké encore.
    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2efgel${ts}`,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id,
      targetCountry: "US",
    });
    expect(
      await A.client.query(api.creators.getMyTimezone, { projectId: A.projectId }),
    ).toEqual({ timezone: NY, source: "inferred" });

    // Premier check → la déduction devient une valeur STOCKÉE.
    await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });

    // Un 2e compte, dans un AUTRE pays : sans gel, le fuseau deviendrait null.
    const id2 = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "Instagram",
      handle: `@e2efgel2${ts}`,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: id2,
      targetCountry: "FR",
    });

    // FIGÉ : la valeur ne bouge pas, et reste marquée « déduite ».
    expect(
      await A.client.query(api.creators.getMyTimezone, { projectId: A.projectId }),
    ).toEqual({ timezone: NY, source: "inferred" });
  });

  test("chaque check laisse une TRACE horodatée (jour + instant + fuseau)", async () => {
    // AT-002 : la clé métier reste le JOUR local, mais l'instant exact est
    // désormais conservé à côté. Sans lui, un historique de checks n'est pas
    // ré-interprétable après coup — c'est ce qui a rendu impossible tout
    // recalcul rétroactif pour les créatrices américaines.
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fuseau trace ${ts}`,
      email: `e2e-fuseau-trace-${ts}@repackit.test`,
      password: "creator-ftrace-12345",
    });
    await A.client.mutation(api.creators.confirmMyTimezone, {
      projectId: A.projectId,
      timezone: NY,
    });
    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2eftrace${ts}`,
    });
    const avant = Date.now();
    await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    const apres = Date.now();

    const comptes = await A.client.query(api.comptes.listMyComptes, {
      projectId: A.projectId,
    });
    const protocol = comptes.find((c) => c._id === id)?.warmupProtocol;
    const log = protocol?.checkLog ?? [];
    expect(log).toHaveLength(1);
    // Le jour du journal est EXACTEMENT celui de la clé métier.
    expect(log[0].day).toBe(protocol?.dailyChecks?.[0]);
    // L'instant est réel et encadré par l'appel.
    expect(log[0].at).toBeGreaterThanOrEqual(avant);
    expect(log[0].at).toBeLessThanOrEqual(apres);
    // Le fuseau retenu au moment du check est conservé avec lui.
    expect(log[0].tz).toBe(NY);
  });

  test("un fuseau invalide est REFUSÉ à l'écriture", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fuseau invalide ${ts}`,
      email: `e2e-fuseau-bad-${ts}@repackit.test`,
      password: "creator-fbad-12345",
    });
    for (const mauvais of ["Paris", "UTC+2", "America/Atlantide", ""]) {
      await expect(
        A.client.mutation(api.creators.confirmMyTimezone, {
          projectId: A.projectId,
          timezone: mauvais,
        }),
      ).rejects.toThrow(/Fuseau horaire inconnu|ArgumentValidationError/);
    }
  });
});
