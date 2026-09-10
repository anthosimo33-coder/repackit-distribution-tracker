import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
const MARKER = "[E2E_TEST]";

/**
 * DURÉE DE WARMUP PAR PROJET — les CINQ chemins d'écriture.
 *
 * Le danger du chantier n'est pas le calcul, c'est l'OUBLI : un chemin qui
 * figerait encore 7 pendant que le projet dit 3, sans erreur ni test rouge. Le
 * paramètre obligatoire le rend impossible à compiler ; ce fichier le rend
 * impossible à régresser, chemin par chemin.
 *
 * Le projet de test est réglé à 3 jours partout (comme Snytch) : si un chemin
 * retombait sur le barème global, il poserait 7 ou 14 et l'assertion tomberait.
 */
test.describe("Warmup — la durée du PROJET est posée par tous les chemins", () => {
  test("les 5 chemins d'écriture posent 3, pas 7 ni 14", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    // ⚠️ Le projet e2e est PARTAGÉ par toute la suite. On le règle à 3 jours le
    // temps de ce test, et on le REMET au barème par défaut dans un `finally` —
    // sans quoi les specs de warmup qui suivent (checks, restart) verraient une
    // cible de 3 là où elles attendent 7, et tomberaient sans rapport avec leur
    // propre sujet.
    const restore = async () =>
      convex.mutation(api.comptes.e2eSetProjectWarmupDays, {
        secret: E2E_SECRET,
        projectId,
        tiktok: 7,
        instagram: 14,
        youtube: 7,
      });
    await convex.mutation(api.comptes.e2eSetProjectWarmupDays, {
      secret: E2E_SECRET,
      projectId,
      tiktok: 3,
      instagram: 3,
      youtube: 3,
    });
    try {

    const target = async (id: string) => {
      const rows = await convex.query(api.comptes.listComptes, {});
      const row = rows.find((r) => String(r._id) === String(id));
      expect(row, "compte introuvable dans listComptes").toBeTruthy();
      return row!.warmupProtocol?.targetDays;
    };

    // ── Chemin 1 — createCompte (admin) ────────────────────────────────────
    const c1 = await convex.mutation(api.comptes.createCompte, {
      handle: `${MARKER}_tt_create_${ts}`,
      plateforme: "TikTok",
      status: "warmup",
      warmupStartedAt: Date.now(),
      notes: "",
    });
    expect(await target(c1), "createCompte").toBe(3);

    // Instagram aussi : c'est la plateforme où le global disait 14.
    const c1b = await convex.mutation(api.comptes.createCompte, {
      handle: `${MARKER}_ig_create_${ts}`,
      plateforme: "Instagram",
      status: "warmup",
      warmupStartedAt: Date.now(),
      notes: "",
    });
    expect(await target(c1b), "createCompte Instagram").toBe(3);

    // ── Chemin 2 — declareCompte (CRÉATRICE) ───────────────────────────────
    const creator = await createCreatorSession(convexUrl, {
      name: `${MARKER} Warmup Days ${ts}`,
      email: `e2e-warmupdays-${ts}@repackit.test`,
      password: "warmupdays-12345",
    });
    const c2 = await creator.client.mutation(api.comptes.declareCompte, {
      projectId: creator.projectId,
      handle: `${MARKER}_tt_declare_${ts}`,
      plateforme: "TikTok",
    });
    expect(await target(c2), "declareCompte (créatrice)").toBe(3);

    // ── Chemin 3 — declareManagedCompte (admin, compte géré) ───────────────
    const c3 = await convex.mutation(api.comptes.declareManagedCompte, {
      creatorId: creator.creatorId,
      handle: `${MARKER}_tt_managed_${ts}`,
      plateforme: "TikTok",
    });
    expect(await target(c3), "declareManagedCompte").toBe(3);

    // ── Chemin 4 — updateCompte, changement de plateforme (re-fige) ────────
    await convex.mutation(api.comptes.updateCompte, {
      id: c1,
      plateforme: "Instagram",
    });
    expect(await target(c1), "updateCompte (changement de plateforme)").toBe(3);

    // ── Chemin 5 — restartWarmup ───────────────────────────────────────────
    await convex.mutation(api.comptes.restartWarmup, { id: c3 });
    expect(await target(c3), "restartWarmup").toBe(3);

    // ── Chemin e2e — e2eSetWarmupChecks, utilisé par les autres specs ──────
    // S'il posait un défaut global, les tests de warmup deviendraient faux
    // sans que rien ne le signale.
    const c6 = await convex.mutation(api.comptes.createCompte, {
      handle: `${MARKER}_tt_e2e_${ts}`,
      plateforme: "TikTok",
      status: "warmup",
      warmupStartedAt: Date.now(),
      notes: "",
    });
    await convex.mutation(api.comptes.e2eSetWarmupChecks, {
      secret: E2E_SECRET,
      id: c6,
      dailyChecks: ["2026-01-01", "2026-01-02"],
    });
    expect(await target(c6), "e2eSetWarmupChecks").toBe(3);

    // ── Le serveur SERT la durée : l'écran n'a plus à la calculer ──────────
    const rows = await convex.query(api.comptes.listComptes, {});
    const served = rows.find((r) => String(r._id) === String(c6));
    expect(served?.targetDays, "targetDays servi par listComptes").toBe(3);
    // 2 checks sur 3 → pas terminé. Contrôle de présence apparié plus bas.
    expect(served?.warmupDone).toBe(false);

    await convex.mutation(api.comptes.e2eSetWarmupChecks, {
      secret: E2E_SECRET,
      id: c6,
      dailyChecks: ["2026-01-01", "2026-01-02", "2026-01-03"],
    });
    const done = (await convex.query(api.comptes.listComptes, {})).find(
      (r) => String(r._id) === String(c6),
    );
    expect(done?.warmupDone, "3 checks sur 3 → terminé").toBe(true);
    } finally {
      await restore();
    }
  });
});
