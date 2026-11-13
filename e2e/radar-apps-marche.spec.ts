import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — les apps et logiciels qui paient des créateurs sur une place de marché de campagnes (13/11/2026). Ni la
 * collecte (les pages publiques de la place de marché) ni l'IA ne tournent en e2e : on sème des campagnes « lues »,
 * on donne la réponse que l'IA aurait rendue, et on lit ce que l'écran propose et ce que « Suivre » en fait.
 *
 * Apps, comptes suivis et campagnes sont GLOBAUX et le projet e2e est partagé : tout porte un marqueur, effacé à la fin.
 */
test.describe("Radar — apps et logiciels qui paient des créateurs", () => {
  test("un produit est proposé avec ce que ses campagnes paient ; un extrait de streamer non ; le suivre crée l'app et rattache ses comptes", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const pre = `e2emk${ts}`;
    const p = `e2emkapp${ts}`;
    // Un produit à deux campagnes (dont une portée par une agence), un logiciel à ignorer, un extrait de streamer.
    const route = { marque: `Roadly${ts}`, cle: `roadly${ts}` };
    const outil = { marque: `Fixly${ts}`, cle: `fixly${ts}` };
    const h = (nom: string) => `${nom}_${ts}`;
    const lue = (name: string, org: string, description: string, o: { rateCents: number | null; creators: number; views: number; spentCents: number; handles: string[] }) => ({
      name,
      org,
      description,
      launchedAt: ts - 30 * 86_400_000,
      ...o,
    });
    const ids = await admin.mutation(api.radarMarket.e2eSeedMarketCampaigns, {
      secret: E2E_SECRET,
      campaigns: [
        {
          campaignId: `${pre}-a1`,
          read: lue(`${route.marque} Clipping | $5.25K Budget | $1.25 CPM`, `Clipix ${ts}`, `${route.marque} (@${route.cle}app) is a drive tracker for iOS and Android, like Strava for your car.`, {
            rateCents: 125,
            creators: 46,
            views: 589_966,
            spentCents: 169_580,
            handles: [h("reign"), h("leos")],
          }),
        },
        {
          campaignId: `${pre}-a2`,
          read: lue(`${route.marque} UGC`, route.marque, `Film yourself using ${route.marque} on a road trip.`, { rateCents: 200, creators: 4, views: 12_000, spentCents: 2_400, handles: [h("leos"), h("jace")] }),
        },
        { campaignId: `${pre}-b1`, read: lue("Kennedy Kay Clipping", "Clip Farm", "Clip Kennedy Kay, a creator with 100K+ YouTube subscribers.", { rateCents: 100, creators: 289, views: 2_776_020, spentCents: 381_800, handles: [h("clipper")] }) },
        { campaignId: `${pre}-c1`, read: lue(`${outil.marque} PDF editor`, outil.marque, `${outil.marque}.net is a PDF editor that fixes typos in any document.`, { rateCents: null, creators: 0, views: 0, spentCents: 0, handles: [] }) },
      ],
    });
    expect(ids).toHaveLength(4);
    const lignes = page.getByRole("region", { name: "Apps et logiciels qui paient des créateurs" }).getByTestId("radar-app-marche");
    const ligne = (x: { marque: string }) => lignes.filter({ hasText: x.marque });
    try {
      // Lues, pas encore jugées : rien n'est proposé.
      await page.goto(adminPath("/radar?onglet=comptes"));
      await expect(page.getByTestId("radar-marche-avancement")).toBeVisible();
      await expect(ligne(route)).toHaveCount(0);

      // La réponse de l'IA : le produit des deux premières campagnes (écrit de deux façons), un streamer, un logiciel,
      // et une campagne qu'on ne lui a pas demandée.
      const r = await admin.mutation(api.radarMarket.e2eJudgeMarket, {
        secret: E2E_SECRET,
        answer: {
          campaigns: [
            { id: ids[0], kind: "app", product: route.marque, handle: `${route.cle}app` },
            { id: ids[1], kind: "app", product: ` ${route.marque.toUpperCase()} `, handle: "" },
            { id: ids[2], kind: "other", product: "", handle: "" },
            { id: ids[3], kind: "software", product: outil.marque, handle: "" },
            { id: "inventee", kind: "app", product: "Fantôme", handle: "" },
          ],
        },
      });
      expect(r).toEqual({ judged: 4, found: 2 });

      // ── L'écran ─────────────────────────────────────────────────────────────
      // Le produit, une ligne pour ses deux campagnes : créateurs, vues et versements additionnés, le tarif le plus haut.
      await expect(ligne(route)).toHaveCount(1);
      await expect(ligne(route)).toContainText(`${route.marque} · app mobile · payé par Clipix ${ts}`);
      await expect(ligne(route)).toContainText(/50 créateurs · 601\s966 vues · 1\s719,80\s\$ versés · 2,00\s\$ pour 1 000 vues · 2 campagnes/);
      // Les comptes de ses meilleurs clips, chacun une fois.
      for (const nom of ["reign", "leos", "jace"]) await expect(ligne(route).getByRole("link", { name: `@${h(nom)}` })).toHaveAttribute("href", `https://www.tiktok.com/@${h(nom)}`);
      // Le lien mène à sa campagne la plus vue.
      await expect(ligne(route).getByRole("link", { name: "Voir la campagne" })).toHaveAttribute("href", `https://contentrewards.com/c/campaigns/${pre}-a1`);
      // Le logiciel, sans créateur encore ni tarif à la vue.
      await expect(ligne(outil)).toContainText(`${outil.marque} · logiciel`);
      await expect(ligne(outil)).toContainText("aucun créateur encore");
      await expect(ligne(outil)).not.toContainText("pour 1 000 vues");
      // L'extrait de streamer n'est pas un produit à suivre.
      await expect(lignes.filter({ hasText: "Kennedy Kay" })).toHaveCount(0);

      // Ignorer : le logiciel sort de la liste.
      await ligne(outil).getByRole("button", { name: "Ignorer" }).click();
      await expect(ligne(outil)).toHaveCount(0);
      await page.reload();
      await expect(ligne(route)).toHaveCount(1);
      await expect(ligne(outil)).toHaveCount(0);

      // Suivre : le formulaire arrive rempli (nom, motifs : le nom collé et son pseudo), sans la cocher « concurrente » ;
      // les comptes de ses meilleurs clips rejoignent son réseau.
      await ligne(route).getByRole("button", { name: "Suivre", exact: true }).click();
      await expect(page.getByLabel("Nom de l'app")).toHaveValue(route.marque);
      await expect(page.getByLabel("Motifs qui la citent")).toHaveValue(`${route.cle}, ${route.cle}app`);
      await expect(page.getByRole("checkbox", { name: "Concurrente de ce projet" })).not.toBeChecked();
      await page.getByRole("button", { name: "Suivre l'app" }).click();
      await expect(page.getByText(`${route.marque} suivie : 3 comptes rejoignent son réseau.`)).toBeVisible();
      await expect(ligne(route)).toHaveCount(0);
      const suivie = page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: route.marque });
      await expect(suivie).toContainText("3 comptes");
    } finally {
      await admin.mutation(api.radarMarket.e2eClearMarket, { secret: E2E_SECRET, prefix: pre });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: route.cle });
    }
  });
});
