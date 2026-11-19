import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/** Instant UTC absolu : utcAt(2026, 8, 7, 12, 40) = 7 août 2026 12:40 UTC. */
const utcAt = (y: number, m: number, d: number, h: number, min = 0) =>
  Date.UTC(y, m - 1, d, h, min);

type Vues = {
  periode: { du: string; au: string; jours: number };
  total: number;
  parJour: { jour: string; vues: number; vuesEstimees: number; partEstimeePct: number | null }[];
  estimation: { vuesEstimees: number; partEstimeePct: number | null };
  repartition: { par: string; lignes: { nom: string; vues: number }[] };
  comparaison?: { du: string; au: string; total: number; evolutionPct: number | null };
};

async function vues(url: string, token: string, args: Record<string, unknown>): Promise<Vues> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "vues", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as Vues;
}

/**
 * Outil MCP `vues` — les vues GAGNÉES pendant une période.
 *
 * Deux vidéos, à la forme de la prod :
 *  - NOUVELLE : publiée le 07/08 à 14:40 Paris, premier relevé le soir même à
 *    23:30 (relevé nocturne) avec déjà 18 437 vues. Elle doit compter TOUTES
 *    ses vues — celles d'avant son premier relevé comprises (le « départ ») ;
 *  - ANCIENNE : publiée en juillet, dont on ne doit compter QUE ce qu'elle
 *    gagne dans la période — jamais son historique.
 *
 * Et le chiffre de Claude est, jour par jour, celui de la courbe « Vues gagnées
 * par jour » du Tracker.
 */
test.describe("Outil MCP vues", () => {
  test("vues gagnées sur une période : départ compté, historique non, jour par jour comme le Tracker", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const racine = `@e2emcpvues${ts}`;
    const compteNouvelle = `${racine}_rs`;
    const compteAncienne = `${racine}_fr`;
    for (const [handle, pays] of [
      [compteNouvelle, "RS"],
      [compteAncienne, "FR"],
    ] as const) {
      await admin.mutation(api.comptes.createCompte, {
        handle,
        plateforme: "TikTok",
        notes: "[E2E_TEST] mcp-vues",
        targetCountry: pays,
      });
    }
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] MCP vues ${ts}`,
    })) as Id<"icps">;

    async function video(compte: string, datePubli: number, suffixe: string) {
      const carouselId = await admin.query(api.publications.getNextCarouselId, {});
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] MCP vues ${suffixe} ${ts}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script e2e",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: ["TikTok"],
        compte,
        datePubli,
        notes: "[E2E_TEST] mcp-vues",
      });
      const id = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, {
        id,
        postUrl: `https://www.tiktok.com/@e2e/video/6${suffixe}${ts}`,
      });
      return id;
    }
    async function releve(publicationId: Id<"publications">, capturedAt: number, v: number) {
      const res = await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId,
        vues: v,
        capturedAt,
        source: "tiktok",
      });
      expect(res.action).toBe("inserted");
    }

    const nouvelle = await video(compteNouvelle, utcAt(2026, 8, 7, 12, 40), "1");
    await releve(nouvelle, utcAt(2026, 8, 7, 21, 30), 18_437); // 23:30 Paris
    await releve(nouvelle, utcAt(2026, 8, 8, 21, 30), 26_012);
    await releve(nouvelle, utcAt(2026, 8, 9, 21, 30), 29_540);

    const ancienne = await video(compteAncienne, utcAt(2026, 7, 20, 10), "2");
    await releve(ancienne, utcAt(2026, 8, 1, 21, 30), 100_000);
    await releve(ancienne, utcAt(2026, 8, 7, 21, 30), 104_000);
    await releve(ancienne, utcAt(2026, 8, 9, 21, 30), 107_500);

    // ── Une clé, et l'adresse du serveur, depuis l'écran ────────────────────
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(`E2E vues ${ts}`);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
      .match(/jarvia (\S+\/mcp) /)![1];

    // ── La période du 07 au 09/08, par compte ───────────────────────────────
    const r = await vues(url, token, {
      projet: "e2e-test",
      du: "2026-08-07",
      au: "2026-08-09",
      compte: racine.slice(1),
      par: "compte",
      comparer: true,
    });
    expect(r.periode).toEqual({ du: "2026-08-07", au: "2026-08-09", jours: 3 });
    const parCompte = new Map(r.repartition.lignes.map((l) => [l.nom, l.vues]));
    // La NOUVELLE compte TOUTES ses vues : 29 540 — dont les 18 437 d'avant son
    // premier relevé (l'ancienne méthode n'en voyait que 11 103).
    expect(parCompte.get(`${compteNouvelle} (TikTok)`)).toBeGreaterThanOrEqual(29_539);
    expect(parCompte.get(`${compteNouvelle} (TikTok)`)).toBeLessThanOrEqual(29_541);
    // L'ANCIENNE ne compte que ses gains de la période — jamais ses 100 000 de
    // juillet : 4 000 × 23,5/144 + 3 500 ≈ 4 153 (l'écart du 01 au 07 est à
    // cheval sur la période, seule sa part du 07 compte).
    expect(parCompte.get(`${compteAncienne} (TikTok)`)).toBeGreaterThanOrEqual(4152);
    expect(parCompte.get(`${compteAncienne} (TikTok)`)).toBeLessThanOrEqual(4154);
    expect(r.total).toBe(r.parJour.reduce((s, j) => s + j.vues, 0));
    // PART ESTIMÉE : l'ancienne est relevée à 6 puis 2 jours d'écart, TOUTES ses
    // vues de la période sont estimées ; la nouvelle, relevée chaque soir, n'en a
    // aucune. La part estimée de la période EST donc l'ancienne (±1 d'arrondi
    // par jour) — pas « trois jours estimés ».
    const vuesAncienne = parCompte.get(`${compteAncienne} (TikTok)`)!;
    expect(Math.abs(r.estimation.vuesEstimees - vuesAncienne)).toBeLessThanOrEqual(3);
    const j07 = r.parJour.find((j) => j.jour === "2026-08-07")!;
    expect(j07.vuesEstimees).toBeGreaterThanOrEqual(688); // 4 000 × 23,5/144 + 3 500 × 0,5/48
    expect(j07.vuesEstimees).toBeLessThanOrEqual(690);
    expect(j07.partEstimeePct).toBeLessThan(5); // ~3,6 % du jour, le reste mesuré

    // ── Jour par jour, la courbe du Tracker ─────────────────────────────────
    // Même répartition, mêmes départs. Seul l'ARRONDI peut différer d'une vue :
    // chaque série arrondit ses jours au plus fort reste sur SES jours, et la
    // courbe sans filtre de dates remonte jusqu'en juillet.
    const { daily } = await admin.query(api.trackerData.trackerViewsDaily, {
      comptes: [compteNouvelle, compteAncienne],
    });
    const courbe = new Map(daily.map((p) => [p.date, p.value]));
    expect(r.parJour.map((j) => j.jour)).toEqual(["2026-08-07", "2026-08-08", "2026-08-09"]);
    for (const j of r.parJour) {
      expect(Math.abs(j.vues - (courbe.get(j.jour) ?? Number.NaN))).toBeLessThanOrEqual(1);
    }

    // ── La semaine d'avant : seule l'ancienne y gagnait (4 000 × 72/144) ─────
    expect(r.comparaison).toMatchObject({ du: "2026-08-04", au: "2026-08-06" });
    expect(Math.abs(r.comparaison!.total - 2000)).toBeLessThanOrEqual(1);

    // ── Filtre pays : la Serbie, c'est la nouvelle seule ────────────────────
    const serbie = await vues(url, token, {
      projet: "e2e-test",
      du: "2026-08-07",
      au: "2026-08-09",
      compte: racine.slice(1),
      pays: "RS",
    });
    expect(Math.abs(serbie.total - 29_540)).toBeLessThanOrEqual(1);
  });

  /**
   * UN MOIS de relevés, au volume de la prod. Le 19/11/2026, l'outil répondait
   * « Erreur interne » dès 15 jours sur Snytch : il lisait toute la fenêtre de
   * relevés en UNE query, et la query dépassait sa seconde de calcul. Ici,
   * 31 posts relevés toutes les heures sur la fenêtre lue (la période, 7 jours
   * avant, 7 jours après) : 33 449 relevés, plus que les 32 000 documents
   * qu'une query Convex peut lire. L'outil doit répondre, et juste.
   *
   * Projet À PART (`e2e-vues-volume`) : ces relevés ne doivent jamais entrer
   * dans une lecture du projet e2e partagé.
   */
  test("un mois entier au volume de la prod : l'outil répond, au chiffre près", async ({ page }) => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const { projectId } = await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug: "e2e-vues-volume",
      name: "E2E vues volume",
    });
    // Le backend local plafonne l'écriture à 4 Mio par seconde : semer ou
    // effacer des dizaines de milliers de relevés le touche. On attend et on
    // reprend, plutôt que de ralentir chaque appel.
    async function sansDebordement<T>(f: () => Promise<T>): Promise<T> {
      for (let essai = 1; ; essai++) {
        try {
          return await f();
        } catch (e) {
          if (essai >= 20 || !String(e).includes("TooManyWrites")) throw e;
          await new Promise((ok) => setTimeout(ok, 1_000));
        }
      }
    }
    const effacer = async () => {
      for (;;) {
        const { reste } = await sansDebordement(() =>
          admin.mutation(api.apifySync.e2eEffacerRelevesDuProjet, { secret: E2E_SECRET, projectId }),
        );
        if (!reste) return;
      }
    };
    await effacer(); // une exécution précédente interrompue

    try {
      const compte = `@e2emcpvuesvol${ts}`;
      await admin.mutation(api.comptes.createCompte, {
        projectId,
        handle: compte,
        plateforme: "TikTok",
        notes: "[E2E_TEST] mcp-vues volume",
        targetCountry: "FR",
      });
      const icpId = (await admin.mutation(api.icps.createIcp, {
        projectId,
        nom: `[E2E_TEST] MCP vues volume ${ts}`,
      })) as Id<"icps">;

      // Publiés le 10/02/2025, bien avant la fenêtre lue : pas de « départ », le
      // premier relevé lu (0 vue) est la référence de chaque post.
      const POSTS = 31;
      const debutReleves = utcAt(2025, 2, 21, 23); // 22/02 00:00 Paris = début de la fenêtre lue
      const HEURE = 3_600_000;
      const RELEVES = 1079; // jusqu'au 07/04 22:00 UTC exclu : 45 jours de Paris moins l'heure d'été
      for (let i = 0; i < POSTS; i++) {
        const carouselId = await admin.query(api.publications.getNextCarouselId, { projectId });
        const { ids } = await admin.mutation(api.publications.createPublication, {
          projectId,
          carouselId,
          hookId: null,
          hookText: `[E2E] MCP vues volume ${i} ${ts}`,
          mecanique: "Erreur",
          niveau: "Broad-A",
          mediaType: "short",
          script: "script e2e",
          angleTonal: "Psycho",
          langue: "FR",
          icpId,
          plateformes: ["TikTok"],
          compte,
          datePubli: utcAt(2025, 2, 10, 12),
          notes: "[E2E_TEST] mcp-vues volume",
        });
        const id = ids[0] as Id<"publications">;
        await admin.mutation(api.publications.updateMetrics, {
          projectId,
          id,
          postUrl: `https://www.tiktok.com/@e2e/video/7${i}${ts}`,
        });
        await sansDebordement(() =>
          admin.mutation(api.apifySync.e2eSemerReleves, {
            secret: E2E_SECRET,
            publicationId: id,
            debut: debutReleves,
            pasMs: HEURE,
            n: RELEVES,
            vuesParPas: 10,
          }),
        );
      }

      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E vues volume ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      const r = await vues(url, token, {
        projet: "e2e-vues-volume",
        du: "2025-03-01",
        au: "2025-03-31",
        par: "plateforme",
        comparer: true,
      });
      expect(r.periode).toEqual({ du: "2025-03-01", au: "2025-03-31", jours: 31 });
      // 10 vues par heure et par post : 743 heures en mars à Paris (l'heure
      // d'été du 30 en retire une) × 10 × 31 posts.
      expect(r.total).toBe(743 * 10 * POSTS);
      expect(r.parJour).toHaveLength(31);
      expect(r.parJour.find((j) => j.jour === "2025-03-30")!.vues).toBe(23 * 10 * POSTS);
      expect(r.parJour.find((j) => j.jour === "2025-03-31")!.vues).toBe(24 * 10 * POSTS);
      expect(r.estimation.vuesEstimees).toBe(0); // relevés horaires : rien d'estimé
      expect(r.repartition.lignes).toEqual([{ nom: "TikTok", vues: 743 * 10 * POSTS, partPct: 100 }]);
      // La période précédente (29/01 → 28/02) ne voit que ses 7 derniers jours
      // de relevés — ceux de SA fenêtre, pas ceux lus pour mars.
      expect(r.comparaison).toMatchObject({ du: "2025-01-29", au: "2025-02-28", total: 168 * 10 * POSTS });
    } finally {
      await effacer();
    }
  });
});
