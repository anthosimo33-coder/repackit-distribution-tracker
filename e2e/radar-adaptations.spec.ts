import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const jourParis = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + n * DAY));
const jourDe = (ts: number | undefined) => (ts === undefined ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts)));
/** Minuit de Paris de ce jour : la forme des `postDate`. */
const minuitParis = (jour: string) => {
  const t = Date.parse(`${jour}T00:00:00Z`);
  const decalage = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).format(new Date(t)));
  return t - decalage * HOUR;
};
/** « 11/11 » : le jour tel que l'écran l'écrit. */
const jourCourt = (n: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "numeric" }).format(new Date(minuitParis(jourParis(n))));

/**
 * RADAR — TES ADAPTATIONS, sur une vraie semence : une créatrice dont la médiane
 * est à 1 000 vues, une campagne « Mise à jour » déjà tournée (5 000, 4 000 et
 * 500 vues à 72 h : deux gagnantes sur trois, comme le Pilote les juge), une
 * « Nouvelle obsession » planifiée. Trois vidéos « à adapter » : on relie la
 * dernière à l'écran, on en délie une.
 */
test.describe("Radar — Tes adaptations", () => {
  test("relier une vidéo à adapter à sa campagne, la suivre en tournage, juger nos résultats", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const m = `e2eadapt${ts}`;
    const juliette = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Juliette Adapt ${ts}`,
      email: `e2e-adapt-${ts}@repackit.test`,
      password: "adapt-12345",
    });
    const handle = `@julietteadapt${ts}`;
    const cible = await availableTarget({ e2eClient: admin, creatorId: juliette.creatorId, platform: "TikTok", handle });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] Barème adapt ${ts}`, montantFixe: 100, nbVideosCible: 10, tauxCPM: 2.5 });
    await admin.mutation(api.creators.updateCreatorPayTerms, { id: juliette.creatorId, bonusPricingId: pricingId });

    const campagne = async (nom: string) => {
      const id = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${nom} ${ts}` })) as Id<"scriptCampaigns">;
      for (let i = 0; i < 4; i++) await admin.mutation(api.scripts.createBrick, { campaignId: id, kind: "hook", label: `${nom} ${i}`, content: `${nom} ${i} ${ts}` });
      await admin.mutation(api.scripts.createBrick, { campaignId: id, kind: "flux", label: "Flux", content: "Je te montre." });
      await admin.mutation(api.scripts.createBrick, { campaignId: id, kind: "cta", label: "CTA", content: "Lien en bio." });
      return id;
    };
    const base = await campagne("Base");
    const miseAJour = await campagne("Mise à jour");
    const obsession = await campagne("Nouvelle obsession");

    const mission = async (campaignId: Id<"scriptCampaigns">, jour: number) => {
      const j = jourParis(jour);
      const { assignmentIds } = (await admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: juliette.creatorId,
        targets: [cible],
        videosPerCreator: 1,
        dueDate: Date.now() + DAY,
        pricingId,
        postDates: [minuitParis(j)],
      })) as unknown as { assignmentIds?: Id<"assignments">[] };
      return (
        assignmentIds?.[0] ??
        (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === juliette.creatorId && jourDe(a.postDate) === j && a.scriptCombo?.campaignId === campaignId)!._id
      );
    };
    let seq = 0;
    const publier = async (id: Id<"assignments">, ilYa: number, vues: number) => {
      seq += 1;
      const publieeA = Date.now() - ilYa * DAY;
      const videoId = ((BigInt(Math.floor(publieeA / 1000)) << BigInt(32)) + BigInt(9000 + seq)).toString();
      const lien = `https://www.tiktok.com/${handle}/video/${videoId}`;
      await admin.mutation(api.assignments.confirmPublicationAsAdmin, { id, urls: [{ platform: "TikTok", url: lien }], publishedAt: publieeA, allowBackdate: true });
      const pub = (await admin.query(api.publications.listPublications, {})).find((p) => p.postUrl === lien)!;
      await admin.mutation(api.metricSnapshots.createSnapshot, { publicationId: pub._id, capturedAt: Date.now() - HOUR, vues, likes: 0 });
    };
    // Sa médiane : 1 000 vues.
    for (const j of [9, 8, 7]) await publier(await mission(base, -j), j, 1_000);
    // « Mise à jour », mesurée à 72 h : 5×, 4× (gagnantes), 0,5×.
    for (const [j, vues] of [[6, 5_000], [5, 4_000], [4, 500]] as const) await publier(await mission(miseAJour, -j), j, vues);
    // « Nouvelle obsession » : deux missions à venir.
    await mission(obsession, 2);
    await mission(obsession, 4);

    // Trois vidéos de concurrents « à adapter ».
    const hook = (n: number) => `La mise à jour qui montre tout ${n} ${ts}`;
    const { ids } = await admin.mutation(api.radarSignals.e2eSeedSignals, {
      secret: E2E_SECRET,
      signals: [1, 2, 3].map((n) => ({
        videoId: `${m}${n}`,
        handle: `rxadapt${n}_${ts}`,
        fans: 2_000,
        caption: `${hook(n)} ${m}`,
        lang: "fr",
        publishedAt: Date.now() - 40 * HOUR,
        views: 199_000,
        multiplier: 199,
        hook: hook(n),
      })),
    });
    try {
      for (const id of ids) await admin.mutation(api.radarSignals.markSignal, { signalId: id, status: "adapte" });
      await admin.mutation(api.radarAdaptations.linkAdaptation, { signalId: ids[0], campaignId: miseAJour });
      await admin.mutation(api.radarAdaptations.linkAdaptation, { signalId: ids[1], campaignId: obsession });

      await page.goto(adminPath("/radar"));
      const colonne = (c: "todo" | "doing" | "results") => page.getByTestId(`radar-adaptations-${c}`);
      const item = (c: "todo" | "doing" | "results", texte: string) => colonne(c).getByTestId("radar-adaptation").filter({ hasText: texte });

      // Résultats chez nous : jugée comme le Pilote.
      const resultat = item("results", `Mise à jour ${ts}`);
      await expect(resultat.getByTestId("radar-adaptation-verdict")).toHaveText("Marche chez nous");
      await expect(resultat).toContainText(`D'après « ${hook(1)} »`);
      await expect(resultat.getByRole("definition").nth(0)).toHaveText("3");
      await expect(resultat.getByRole("definition").nth(1)).toHaveText("2 sur 3");
      await expect(resultat.getByRole("definition").nth(2)).toHaveText("4,0×");
      await expect(resultat.getByRole("definition").nth(3)).toHaveText("199×");

      // En tournage : ses missions et quand on saura.
      const tournage = item("doing", `Nouvelle obsession ${ts}`);
      await expect(tournage.getByTestId("radar-adaptation-etat")).toHaveText(`2 missions du ${jourCourt(2)} au ${jourCourt(4)} · résultats vers le ${jourCourt(5)}`);

      // À adapter : on la relie à « Nouvelle obsession » ; elle passe en tournage.
      await page.getByRole("combobox", { name: `Relier la vidéo de @rxadapt3_${ts} à une campagne` }).click();
      await page.getByRole("option", { name: `[E2E_TEST] Nouvelle obsession ${ts}` }).click();
      await expect(item("todo", hook(3))).toHaveCount(0);
      await expect(item("doing", hook(3))).toContainText(`Nouvelle obsession ${ts}`);

      // Délier : retour dans « À adapter ».
      await resultat.getByRole("button", { name: `Délier la campagne [E2E_TEST] Mise à jour ${ts}` }).click();
      await expect(item("results", hook(1))).toHaveCount(0);
      await expect(item("todo", hook(1))).toBeVisible();
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
    }
  });
});
