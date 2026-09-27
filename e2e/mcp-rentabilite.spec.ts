import { ConvexHttpClient } from "convex/browser";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey, parisMidnightUtc } from "../convex/viewsDaily";
import { shiftDay } from "../convex/analyticsDates";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

/**
 * Outil MCP `rentabilite` — Claude annonce EXACTEMENT ce que la carte
 * Rentabilité affiche.
 *
 * Projet DÉDIÉ, pour des montants exacts : la base e2e partagée porte les
 * paiements Whop d'autres specs, dans d'autres devises, qui rendraient le revenu
 * « inexploitable » au hasard de l'ordre des fichiers. Forme de la prod Snytch :
 * paie en dollars, revenu Whop en euros, taux posé sur le projet, montants à
 * décimales.
 */

type Chiffres = {
  revenuNet: number;
  coutCreatrices: number;
  marge: number | null;
  vues: number;
  rpm: number | null;
};

/** Un appel d'outil, réponse JSON (refus = échec du test, message en clair). */
async function appel<T>(url: string, token: string, name: string, args: Record<string, unknown>) {
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
      params: { name, arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as T;
}

async function rpc(url: string, token: string, args: Record<string, unknown>) {
  return appel<{
    devises: { revenu: string; paie: string; tauxPaieVersRevenu: number | null };
    cumul: Chiffres;
    mois: (Chiffres & { mois: string; enCours: boolean; fige: boolean })[];
    avertissements?: string[];
  }>(url, token, "rentabilite", args);
}

/** « 1 873,42 € », « −21,23 € », « 12 347 », « — » → nombre (ou null). */
function nombre(texte: string): number | null {
  const t = texte.replace(/[\s  ]/g, "").replace("−", "-");
  if (t === "—") return null;
  const n = Number(t.replace(/[^\d,.-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Montant illisible : « ${texte} »`);
  return n;
}

/**
 * Valeur d'une tuile de la carte : le DIV du libellé, puis le div juste dessous.
 * XPath sur des div seulement — « Marge » est aussi un en-tête du tableau (th).
 */
async function tuile(carte: Locator, libelle: string): Promise<number | null> {
  const valeur = carte.locator(
    `xpath=.//div[normalize-space(text())="${libelle}"]/following-sibling::div[1]`,
  );
  return nombre((await valeur.textContent()) ?? "");
}

test.describe("Outil MCP rentabilite", () => {
  test("Claude annonce les chiffres de la carte Rentabilité, toggle compris", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-rentab-${ts}`;
    const nom = `E2E MCP Rentab ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_mcp_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });

      // ── Revenu : un paiement Whop en euros, ce mois-ci ─────────────────────
      await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
        secret: E2E_SECRET,
        projectId,
        whopId: `pay_e2e_mcp_${ts}`,
        status: "paid",
        grossAmount: 1999,
        netAmount: 1873.42,
        paidAt: Date.now(),
        currency: "eur",
      });

      // ── Coût : une vidéo au CPM de 2 $, 81 234 vues ─────────────────────────
      // Au-delà du plafond de 150 $/vidéo (75 000 vues à 2 $), une vue reste
      // SUIVIE mais n'est plus FACTURÉE : 6 234 vues non facturées, exactement
      // la situation qui sépare le RPM business du RPM dilué en prod.
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Rentab ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Rentab ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-rentab-${ts}@repackit.test`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] Inès Moreau ${ts}`,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `rentab-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId,
        platform: "TikTok",
        handle: `@ines.moreau_${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        projectId,
        formatId,
        creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: Date.now() + 7 * DAY,
        pricingId,
      });
      const row = (await admin.query(api.assignments.listAssignments, { projectId })).find(
        (a) => a.creatorId === creatorId,
      )!;
      const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        projectId,
        id: row._id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@ines.moreau_${ts}/video/72${ts}` }],
      });
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
        vues: 81_234,
        capturedAt: Date.now(),
        source: "tiktok",
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(`/admin/${slug}/paiements`);
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E rentab ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];
      await page.keyboard.press("Escape");

      // ── L'outil : les montants semés, exacts ────────────────────────────────
      const outil = await rpc(url, token, { projet: slug });
      expect(outil.devises).toEqual({ revenu: "eur", paie: "usd", tauxPaieVersRevenu: 0.86 });
      expect(outil.cumul.revenuNet).toBe(1873.42);
      expect(outil.cumul.vues).toBe(75_000); // facturées : plafond atteint
      expect(outil.cumul.coutCreatrices).toBe(150); // 75 000 × 2 $ / 1 000
      // 1 873,42 − 150 × 0,86 = 1 744,42 € : le coût est CONVERTI avant soustraction.
      expect(outil.cumul.marge).toBe(1744.42);
      expect(outil.cumul.rpm).toBe(24.98); // 1 873,42 / 75
      const courant = outil.mois.find((m) => m.enCours)!;
      expect(courant).toMatchObject({ revenuNet: 1873.42, vues: 75_000, fige: false });

      // ── L'écran : la carte affiche les mêmes chiffres ───────────────────────
      const carte = page.locator('[data-slot="card"]').filter({ hasText: "Rentabilité — cumul" });
      await expect(carte).toBeVisible();
      expect(await tuile(carte, "Marge")).toBeCloseTo(outil.cumul.marge!, 2);
      expect(await tuile(carte, "Revenu Whop")).toBeCloseTo(outil.cumul.revenuNet, 2);
      expect(await tuile(carte, "Coût créateurs")).toBeCloseTo(outil.cumul.coutCreatrices, 2);
      expect(await tuile(carte, "RPM business")).toBeCloseTo(outil.cumul.rpm!, 2);
      expect(await tuile(carte, "Vues")).toBe(outil.cumul.vues);

      // ── Le toggle : RPM dilué, des deux côtés ───────────────────────────────
      await carte.getByRole("switch", { name: "Inclure les vues non facturées" }).click();
      const dilue = await rpc(url, token, { projet: slug, inclure_non_facturees: true });
      // Les 6 234 vues au-delà du plafond entrent au dénominateur : le RPM baisse.
      expect(dilue.cumul.vues).toBe(81_234);
      expect(dilue.cumul.rpm).toBe(23.06); // 1 873,42 / 81,234
      await expect.poll(() => tuile(carte, "RPM dilué")).toBeCloseTo(dilue.cumul.rpm!, 2);
      expect(await tuile(carte, "Vues")).toBe(dilue.cumul.vues);
      expect(dilue.cumul.marge).toBe(outil.cumul.marge); // le toggle ne touche pas la marge

      // ── Sans taux : marge absente, et dite absente, des deux côtés ──────────
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: null,
      });
      const sansTaux = await rpc(url, token, { projet: slug });
      expect(sansTaux.cumul.marge).toBeNull();
      expect(sansTaux.avertissements?.join(" ")).toMatch(/Marge non calculable/);
      await expect
        .poll(() => tuile(carte, "Marge"))
        .toBeNull();
    } finally {
      // La vraie suppression, purge comprise (PR #289).
      await admin.mutation(api.projectLifecycle.deleteProject, {
        projectId,
        confirmation: nom,
      });
    }
  });
  test("sur une période : revenu de ces jours ÷ vues FACTURÉES gagnées ces jours-là, plafond 150 $ compris", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const slug = `e2e-mcp-rentab-per-${ts}`;
    const nom = `E2E MCP Rentab Periode ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    // Jours de Paris, relatifs à aujourd'hui : J(-1) = hier.
    const J = (n: number) => shiftDay(parisDayKey(ts), n);
    const aParis = (jour: string, h: number, min: number) => {
      const [y, m, d] = jour.split("-").map(Number);
      return parisMidnightUtc(y, m, d) + (h * 60 + min) * 60_000;
    };
    /** Le relevé de 23 h 30 Paris, DST comprise (minuit du lendemain − 30 min). */
    const releveDu = (jour: string) => {
      const [y, m, d] = jour.split("-").map(Number);
      return parisMidnightUtc(y, m, d + 1) - 30 * 60_000;
    };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_mcp_per_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });

      // ── Revenu : trois paiements, deux jours ────────────────────────────────
      for (const [id, jour, h, min, net] of [
        ["a", J(-8), 14, 12, 17.42],
        ["b", J(-8), 20, 5, 34.87],
        ["c", J(-12), 9, 30, 17.42],
      ] as const) {
        await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
          secret: E2E_SECRET,
          projectId,
          whopId: `pay_e2e_mcp_per_${id}_${ts}`,
          status: "paid",
          grossAmount: 19.99,
          netAmount: net,
          paidAt: aParis(jour, h, min),
          currency: "eur",
        });
      }

      // ── Barème : CPM 2 $, sans fixe ⇒ plafond à 75 000 vues facturées ────────
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Rentab Periode ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Rentab Periode ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-rentab-per-${ts}@repackit.test`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] Maëlle Dubois-Laurent ${ts}`,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `rentab-per-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });

      /** Une vidéo publiée à `publishedAt` (antidatée), et ses relevés du soir. */
      async function video(handle: string, publishedAt: number, releves: [string, number][]) {
        const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
        await admin.mutation(api.assignments.assignFormat, {
          projectId,
          formatId,
          creatorId,
          targets: [target],
          postsPerCreator: 1,
          dueDate: ts + 7 * DAY,
          pricingId,
        });
        const row = (await admin.query(api.assignments.listAssignments, { projectId })).find(
          (a) => a.creatorId === creatorId && a.status !== "published" && a.status !== "paid",
        )!;
        const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
          projectId,
          id: row._id,
          urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/73${ts % 1_000_000}${releves.length}` }],
          publishedAt,
          allowBackdate: true,
        });
        const publicationId = (pub.publicationIds ?? [])[0] as Id<"publications">;
        for (const [jour, vues] of releves) {
          await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
            secret: E2E_SECRET,
            publicationId,
            vues,
            capturedAt: releveDu(jour),
            source: "tiktok",
          });
        }
      }

      // Vidéo ANCIENNE (publiée à J-45, mois d'avant) : 8 046 vues à J+29, sous
      // le plafond (16,09 $). Le relevé de J+35 est HORS fenêtre de paie.
      await video(`@maelle.dl_old_${ts}`, aParis(J(-45), 18, 47), [
        [J(-35), 5_183],
        [J(-16), 8_046],
        [J(-10), 9_517],
      ]);
      // Vidéo VIRALE (publiée à J-9, 18:47) : 115 020 vues, dont 75 000
      // facturées — le plafond est franchi le 4e soir (J-6).
      await video(`@maelle.dl_${ts}`, aParis(J(-9), 18, 47), [
        [J(-9), 18_412],
        [J(-8), 47_903],
        [J(-7), 71_266],
        [J(-6), 90_118],
        [J(-5), 101_457],
        [J(-4), 108_004],
        [J(-3), 112_391],
        [J(-2), 115_020],
      ]);

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(`/admin/${slug}/paiements`);
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E rentab periode ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];
      await page.keyboard.press("Escape");

      type Periode = {
        periode: { du: string; au: string; jours: number };
        revenuNet: number;
        vuesFacturees: number;
        rpm: number | null;
        parJour: { jour: string; revenuNet: number; vuesFacturees: number }[];
        avertissements?: string[];
      };
      const periode = (du: string, au: string) =>
        appel<Periode>(url, token, "rentabilite", { projet: slug, du, au });
      const vuesGagnees = async (du: string, au: string) =>
        (await appel<{ total: number }>(url, token, "vues", { projet: slug, du, au })).total;

      // ── Toute la vie des deux vidéos ────────────────────────────────────────
      const tout = await periode(J(-45), J(-1));
      expect(tout.periode.jours).toBe(45);
      // 75 000 (plafond) + 8 046 (fenêtre J+30) : ni les 40 020 vues virales
      // au-delà du plafond, ni les 1 471 vues d'après J+30.
      expect(tout.vuesFacturees).toBe(83_046);
      expect(tout.revenuNet).toBe(69.71);
      expect(tout.rpm).toBe(0.84); // 69,71 / 83,046
      expect(tout.parJour).toHaveLength(45);
      expect(tout.parJour.reduce((s, j) => s + j.vuesFacturees, 0)).toBe(83_046);
      expect(tout.parJour.find((j) => j.jour === J(-8))!.revenuNet).toBe(52.29);

      // ── Avant le plafond : chaque vue gagnée est une vue facturée ───────────
      const avant = await periode(J(-9), J(-8));
      const vuesAvant = await vuesGagnees(J(-9), J(-8));
      expect(avant.vuesFacturees).toBeGreaterThan(45_000);
      expect(Math.abs(avant.vuesFacturees - vuesAvant)).toBeLessThanOrEqual(2); // arrondi par jour
      expect(avant.revenuNet).toBe(52.29);
      expect(avant.rpm).toBe(Math.round((52.29 / (avant.vuesFacturees / 1000)) * 100) / 100);

      // ── Après le plafond : la vidéo fait encore des vues, plus une n'est facturée
      const apres = await periode(J(-5), J(-2));
      expect(apres.vuesFacturees).toBe(0);
      expect(apres.rpm).toBeNull();
      expect(await vuesGagnees(J(-5), J(-2))).toBeGreaterThan(20_000);

      // ── Hors fenêtre J+30 : pareil pour la vidéo ancienne ───────────────────
      // Chaque jour est arrondi à l'entier, le total de l'ENSEMBLE est préservé
      // (83 046 ci-dessus) : un sous-ensemble de jours peut s'en écarter de
      // quelques vues.
      const ancienne = await periode(J(-45), J(-15));
      expect(Math.abs(ancienne.vuesFacturees - 8_046)).toBeLessThanOrEqual(5);
      expect((await periode(J(-14), J(-10))).vuesFacturees).toBe(0);
      expect(await vuesGagnees(J(-14), J(-10))).toBeGreaterThan(1_000);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, {
        projectId,
        confirmation: nom,
      });
    }
  });
});
