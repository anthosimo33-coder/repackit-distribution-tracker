import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;

/**
 * Nouveau Radar — écran Signaux, Budget, outil MCP `signaux`.
 *
 * Les signaux sont GLOBAUX (pas de projet) : chaque test sème les siens sous un
 * marqueur unique, les isole par la recherche, et les efface à la fin. Les
 * vidéos reprennent les vraies du test du 06/11/2026 (abonnés, vues, âge), sous
 * des pseudos suffixés.
 */
function semis(ts: number) {
  const m = `e2esig${ts}`;
  const now = Date.now();
  const s = (n: number, handle: string, fans: number, views: number, ageH: number, lang: string, caption: string, snapshots?: { h: number; views: number }[]) => ({
    videoId: `${m}${n}`,
    handle: `${handle}_${ts}`,
    fans,
    views,
    lang,
    caption: `${caption} ${m}`,
    publishedAt: now - ageH * HOUR,
    ...(snapshots ? { snapshots: snapshots.map((p) => ({ at: now - ageH * HOUR + p.h * HOUR, views: p.views })) } : {}),
  });
  return {
    marqueur: m,
    signaux: [
      s(1, "arpegesauvage", 1_801, 168_850, 21, "fr", "Voici toutes les applications qu'il faut installer", [
        { h: 6, views: 61_204 },
        { h: 21, views: 168_850 },
      ]),
      s(2, "cleversonmgallego", 3_389, 415_872, 84, "pt", "E se a internet caísse amanhã?"),
      s(3, "thefern.app", 64, 58_679, 14, "en", "I made a social media app that teaches you to invest"),
      s(4, "alex.maneja23", 2_445, 49_713, 116, "es-es", "Si quieres hacer tu propia aplicación"),
      s(5, "s.ecrettacc.vero", 3_332, 5_939_334, 1_226, "en", "This is actually insane theick.io"),
    ],
  };
}

test.describe("Nouveau Radar — Signaux", () => {
  test("filtres combinés, vide avec sortie, statuts, détail, vues enregistrées, adresse", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { marqueur, signaux } = semis(ts);
    await admin.mutation(api.radarSignals.e2eSeedSignals, { secret: E2E_SECRET, signals: signaux, rivalProject: E2E_PROJECT_SLUG });
    try {
      const compte = page.getByTestId("radar-signaux-compte");
      await page.goto(adminPath(`/radar?q=${marqueur}`));
      // 7 jours par défaut : la vidéo The Ick (51 jours) n'y est pas.
      await expect(compte).toHaveText("4 vidéos");

      // OU dans un groupe.
      await page.getByRole("checkbox", { name: /^Français/ }).check();
      await expect(compte).toHaveText("1 vidéo");
      await expect(page).toHaveURL(/[?&]l=fr(&|$)/);
      await page.getByRole("checkbox", { name: /^Portugais/ }).check();
      await expect(compte).toHaveText("2 vidéos");
      await expect(page.getByRole("button", { name: "Retirer le filtre Langue : Portugais (Brésil)" })).toBeVisible();
      // Aucun concurrent en français ou portugais sur 7 jours : la case ne se coche pas.
      await expect(page.getByRole("checkbox", { name: /^Concurrents/ })).toBeDisabled();

      // ET avec le seuil : 93× et 123×, aucune à 200× → vide, avec la sortie chiffrée.
      await page.getByText("200× et plus", { exact: false }).first().click();
      await expect(compte).toHaveText("0 vidéo");
      await expect(page.getByText("Aucune vidéo ne passe tous ces filtres.")).toBeVisible();
      await page.getByRole("button", { name: "Retirer « Sortie du lot » (2)" }).click();
      await expect(compte).toHaveText("2 vidéos");

      // Ignorer, puis annuler.
      await page.getByRole("button", { name: "Retirer le filtre Langue : Français" }).click();
      await page.getByRole("button", { name: "Retirer le filtre Langue : Portugais (Brésil)" }).click();
      await expect(compte).toHaveText("4 vidéos");
      await page.getByRole("button", { name: `Ignorer la vidéo de @thefern.app_${ts}` }).click();
      await expect(compte).toHaveText("3 vidéos");
      await expect(page.getByRole("status")).toContainText(`@thefern.app_${ts}`);
      await page.getByRole("button", { name: "Annuler" }).click();
      await expect(compte).toHaveText("4 vidéos");

      // Enregistrer : statut serveur, qui tient au rechargement.
      const carte = page.getByTestId("radar-signal").filter({ hasText: `@arpegesauvage_${ts}` });
      await carte.getByRole("button", { name: "Enregistrer" }).click();
      await expect(carte.getByRole("button", { name: "Retirer des enregistrées" })).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(compte).toHaveText("4 vidéos");
      await expect(carte.getByText("Enregistrée", { exact: true })).toBeVisible();

      // Le détail : la courbe (H+6 → H+21, +176 %), et le statut posé de là.
      await page.getByRole("button", { name: `Voir le détail de la vidéo de @arpegesauvage_${ts}` }).click();
      const courbe = page.getByTestId("radar-courbe");
      await expect(courbe.getByRole("listitem")).toHaveCount(2);
      await expect(courbe).toContainText("H+6");
      await expect(courbe).toContainText("H+21");
      await expect(courbe).toContainText("+176 %");
      await page.getByRole("radio", { name: "Adaptée" }).click();
      await expect(page.getByRole("radio", { name: "Adaptée" })).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await expect(carte.getByText("Adaptée", { exact: true })).toBeVisible();

      // Une vue enregistrée : concurrents sur 90 jours (la recherche saute, l'adresse suit).
      await page.getByRole("button", { name: "Concurrents · 90 j" }).click();
      await expect(page).toHaveURL(/o=concurrent/);
      await expect(page).toHaveURL(/age=90/);
      await expect(page.getByTestId("radar-signal").filter({ hasText: `@s.ecrettacc.vero_${ts}` })).toBeVisible();
      await expect(page.getByRole("button", { name: "Concurrents · 90 j" })).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(page.getByTestId("radar-signal").filter({ hasText: `@s.ecrettacc.vero_${ts}` })).toBeVisible();
      await expect(page.getByTestId("radar-signal").filter({ hasText: `@arpegesauvage_${ts}` })).toHaveCount(0);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: marqueur });
    }
  });

  test("budget : dépense du mois, marge, plafond et poste coupé, enregistrés", async ({ page }) => {
    test.setTimeout(90_000);
    // 2 128 crédits = 4,00 $ dépensés ce mois-ci.
    await admin.mutation(api.radarSignals.e2eResetRadarBudget, { secret: E2E_SECRET, searchCredits: 2_128 });
    try {
      await page.goto(adminPath("/radar?onglet=budget"));
      await expect(page.getByTestId("radar-budget-depense")).toHaveText(/^4,00\s\$$/);
      // Pas de clé ScrapeCreators en e2e : la collecte se dit en pause.
      await expect(page.getByText(/Collecte en pause/)).toBeVisible();
      // Défaut : recherche (3,38 $) + courbe 100 vidéos/jour (16,92 $) + 2 000 relevés de
      // comptes/jour (112,80 $) + réseaux (22,56 $) = 155,66 $ prévus sur 200 $.
      const verdict = page.getByTestId("radar-budget-verdict");
      await expect(verdict).toContainText("44,34");

      await page.getByRole("radio", { name: /^300,00\s\$$/ }).click();
      await expect(verdict).toContainText("144,34");
      await page.getByRole("switch", { name: "Couper : Suivre la courbe des vidéos repérées" }).click();
      // Sans la courbe : 138,74 $ prévus.
      await expect(verdict).toContainText("161,26");
      await page.getByRole("button", { name: "Enregistrer le budget" }).click();
      await expect(page.getByText("Budget enregistré.")).toBeVisible();

      await page.reload();
      await expect(page.getByRole("radio", { name: /^300,00\s\$$/ })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("switch", { name: "Rallumer : Suivre la courbe des vidéos repérées" })).toHaveAttribute("aria-checked", "false");
      await expect(verdict).toContainText("161,26");
    } finally {
      await admin.mutation(api.radarSignals.e2eResetRadarBudget, { secret: E2E_SECRET });
    }
  });

  test("budget : des réglages de la phase 1 passent au plan « le plus de données » sans rien choisir", async ({ page }) => {
    test.setTimeout(60_000);
    await admin.mutation(api.radarSignals.e2eResetRadarBudget, { secret: E2E_SECRET, v1Settings: true });
    try {
      await page.goto(adminPath("/radar?onglet=budget"));
      // Le poste « comptes » était en COMPTES et éteint : il revient en relevés/jour, allumé.
      await expect(page.getByRole("switch", { name: "Couper : Relever les comptes suivis" })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText(/2\s000\s*relevés\/jour/)).toBeVisible();
      await expect(page.getByRole("switch", { name: "Couper : Retrouver le réseau des apps" })).toHaveAttribute("aria-checked", "true");
      // La courbe suit 100 vidéos/jour, et le plafond passe de 60 à 200 $.
      await expect(page.getByText(/100\s*vidéos\/jour/)).toBeVisible();
      await expect(page.getByRole("radio", { name: /^200,00\s\$$/ })).toHaveAttribute("aria-checked", "true");
    } finally {
      await admin.mutation(api.radarSignals.e2eResetRadarBudget, { secret: E2E_SECRET });
    }
  });

  test("outil MCP signaux : les mêmes filtres et le même ordre que l'écran", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { marqueur, signaux } = semis(ts);
    await admin.mutation(api.radarSignals.e2eSeedSignals, { secret: E2E_SECRET, signals: signaux, rivalProject: E2E_PROJECT_SLUG });
    try {
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E signaux ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      const appel = async (args: Record<string, unknown>) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "signaux", arguments: { projet: E2E_PROJECT_SLUG, ...args } } }),
        });
        const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
        expect(result.isError, result.content[0].text).not.toBe(true);
        return JSON.parse(result.content[0].text);
      };

      const fr_pt = await appel({ recherche: marqueur, langue: ["fr", "pt"] });
      expect(fr_pt.total).toBe(2);
      // Trié par vues ÷ abonnés : 122,7× puis 93,8×.
      expect(fr_pt.videos.map((v: { compte: string; foisAbonnes: number }) => [v.compte, v.foisAbonnes])).toEqual([
        [`cleversonmgallego_${ts}`, 122.7],
        [`arpegesauvage_${ts}`, 93.8],
      ]);
      expect(fr_pt.videos[1].courbe.map((p: { heuresApresPublication: number; vues: number }) => [p.heuresApresPublication, p.vues])).toEqual([
        [6, 61_204],
        [21, 168_850],
      ]);
      // Le compteur d'une langue ne dépend pas des autres cases de son groupe.
      expect(fr_pt.compteurs.langue).toMatchObject({ fr: 1, pt: 1, en: 1, "es-es": 1 });
      expect(fr_pt.budget.collecteActive).toBe(false);

      const concurrents = await appel({ recherche: marqueur, origine: "concurrents", periode: "90j" });
      expect(concurrents.videos.map((v: { compte: string; concurrent: string }) => [v.compte, v.concurrent])).toEqual([[`s.ecrettacc.vero_${ts}`, "The Ick"]]);

      // Même lecture que l'écran : même nombre de vidéos pour les mêmes filtres.
      await page.goto(adminPath(`/radar?q=${marqueur}&l=fr,pt`));
      await expect(page.getByTestId("radar-signaux-compte")).toHaveText("2 vidéos");
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: marqueur });
    }
  });
});
