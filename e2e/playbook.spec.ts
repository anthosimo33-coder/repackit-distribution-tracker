import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/**
 * Un identifiant de vidéo TikTok qui ENCODE sa date de mise en ligne (les 32 bits
 * de poids fort = secondes Unix), comme les vrais : c'est cette date qui borne la
 * recherche de la publication quand on colle un lien.
 */
const idTikTok = (ts: number, bas: number) =>
  ((BigInt(Math.floor(ts / 1000)) << BigInt(32)) + BigInt(bas)).toString();

/**
 * PLAYBOOK — de bout en bout : créer une fiche, l'écrire avec un motif, la passer
 * « En test », lui donner un post de preuve par son LIEN (vues relues en direct),
 * refuser la même vidéo collée depuis l'autre compte, la relire par Claude
 * (outil MCP `playbook`), puis la supprimer.
 */
test.describe("Playbook", () => {
  test("fiche, journal, post par lien, doublon refusé, lecture MCP, suppression", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const titre = `[E2E_TEST] Format nouvelle personne ${ts}`;

    // ── Une même vidéo publiée sur deux comptes (comme le 833 400 de Kelly) ──
    const misEnLigne = ts - 30 * HOUR;
    const video = idTikTok(misEnLigne, 4242 + (ts % 1000));
    const lienA = `https://www.tiktok.com/@e2e_pb_a_${ts}/video/${video}?_r=1&_t=ZN-99Ll1tvhOVS`;
    const lienB = `https://www.tiktok.com/@e2e_pb_b_${ts}/video/${video}?_r=1&_t=ZN-99LkRc4osQl`;
    const icpId = (await admin.mutation(api.icps.createIcp, { nom: `[E2E_TEST] Playbook ${ts}` })) as Id<"icps">;
    async function poste(compte: string, lien: string, vues: number): Promise<Id<"publications">> {
      const carouselId = await admin.query(api.publications.getNextCarouselId, {});
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Playbook ${compte}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: ["TikTok"],
        compte,
        // La confirmation suit la mise en ligne de quelques heures (TD-020).
        datePubli: misEnLigne + 3 * HOUR,
        notes: "[E2E_TEST] playbook",
      });
      const id = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, { id, postUrl: lien });
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: id,
        vues,
        likes: Math.round(vues * 0.07),
        capturedAt: ts - HOUR,
        source: "tiktok",
      });
      return id;
    }
    const pubA = await poste(`@e2e_pb_a_${ts}`, lienA, 48_213);
    await poste(`@e2e_pb_b_${ts}`, lienB, 47_906);

    // ── Créer la fiche ───────────────────────────────────────────────────────
    await page.goto(adminPath("/playbook"));
    await page.getByTestId("playbook-nouvelle").click();
    await page.getByLabel("Titre").fill(titre);
    await page.getByRole("button", { name: "Créer", exact: true }).click();
    await expect(page).toHaveURL(/\/playbook\/[a-z0-9]+$/);
    await expect(page.getByTestId("playbook-journal-ligne")).toHaveCount(1);
    await expect(page.getByTestId("playbook-journal-ligne").first()).toContainText("Fiche créée");

    // ── L'écrire, la passer « En test », avec un motif ───────────────────────
    const recette = `Hook « trois jours que je trouve mon mec bizarre », flux LA NOUVELLE PERSONNE ${ts}`;
    await page.getByTestId("playbook-champ-recette").fill(recette);
    await page.getByTestId("playbook-statut-select").click();
    await page.getByRole("option", { name: "En test" }).click();
    await page.getByLabel("Pourquoi ce changement").fill("Signal fort 5,2 × sur 12 posts");
    await expect(page.getByText("Modifications non enregistrées.")).toBeVisible();
    await page.getByTestId("playbook-enregistrer").click();
    await expect(page.getByText("Modifications non enregistrées.")).toBeHidden();
    await expect(page.getByTestId("playbook-journal-ligne")).toHaveCount(2);
    const modif = page.getByTestId("playbook-journal-ligne").first();
    await expect(modif).toContainText("Statut : Hypothèse → En test");
    await expect(modif).toContainText("Modifié : Recette");
    await expect(modif).toContainText("« Signal fort 5,2 × sur 12 posts »");
    // Enregistrer sans rien changer n'écrit rien : le bouton reste éteint.
    await expect(page.getByTestId("playbook-enregistrer")).toBeDisabled();

    // ── Un post de preuve par son lien : vues relues en direct ───────────────
    await page.getByTestId("playbook-post-url").fill(lienA);
    await page.getByTestId("playbook-post-ajouter").click();
    await expect(page.getByTestId("playbook-post")).toHaveCount(1);
    await expect(page.getByTestId("playbook-post-chiffres")).toContainText(/48\s?213 vues/);
    await expect(page.getByTestId("playbook-journal-ligne")).toHaveCount(3);
    await expect(page.getByTestId("playbook-journal-ligne").first()).toContainText("Post ajouté");

    // La même vidéo, collée depuis l'autre compte : refusée, la fiche n'en compte qu'une.
    await page.getByTestId("playbook-post-url").fill(lienB);
    await page.getByTestId("playbook-post-ajouter").click();
    // Le toast seul : en dev, Next recopie aussi l'erreur serveur dans son overlay.
    const toast = page.locator("[data-sonner-toast]");
    await expect(toast.filter({ hasText: "Ce post est déjà dans la fiche." })).toBeVisible();
    await expect(page.getByTestId("playbook-post")).toHaveCount(1);
    // Un lien court ne désigne pas une vidéo : refusé avant toute recherche.
    await page.getByTestId("playbook-post-url").fill("https://vm.tiktok.com/ZN-99Ll1tvhOVS/");
    await page.getByTestId("playbook-post-ajouter").click();
    await expect(toast.filter({ hasText: /pas un lien court/ })).toBeVisible();

    // ── Relu après rechargement, rangé « En test » dans la liste ────────────
    await page.reload();
    await expect(page.getByTestId("playbook-champ-recette")).toHaveValue(recette);
    await page.goto(adminPath("/playbook"));
    const ligne = page.getByTestId("playbook-ligne").filter({ hasText: titre });
    await expect(ligne).toContainText("1 post");
    await expect(ligne).toContainText(/meilleur : 48\s?213 vues/);
    await expect(ligne.getByTestId("playbook-statut")).toHaveText("En test");

    // ── Claude le lit (outil MCP `playbook`) ─────────────────────────────────
    const nomCle = `E2E Playbook ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const appel = async (args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name: "playbook", arguments: { projet: E2E_PROJECT_SLUG, ...args } });
      expect(r.error ?? r.result?.isError ?? null).toBeFalsy();
      return JSON.parse(r.result!.content![0]!.text) as Record<string, unknown>;
    };
    const liste = (await appel({})) as { fiches: { titre: string; statut: string; postsDePreuve: number; meilleuresVues: number }[] };
    expect(liste.fiches.find((f) => f.titre === titre)).toMatchObject({ statut: "en test", postsDePreuve: 1, meilleuresVues: 48_213 });
    const fiche = (await appel({ fiche: `nouvelle personne ${ts}` })) as {
      recette: string;
      postsDePreuve: { vues: number; lien: string }[];
      journal: { geste: string; statut?: string; motif: string | null }[];
    };
    expect(fiche.recette).toBe(recette);
    expect(fiche.postsDePreuve).toEqual([expect.objectContaining({ vues: 48_213, lien: lienA })]);
    expect(fiche.journal.map((l) => l.geste)).toEqual(["postAjoute", "modification", "creation"]);
    expect(fiche.journal[1]).toMatchObject({ statut: "hypothèse → en test", motif: "Signal fort 5,2 × sur 12 posts" });

    // ── La publication de preuve supprimée : la fiche ne la compte plus ──────
    await admin.mutation(api.publications.deletePublication, { id: pubA });
    await page.goto(adminPath("/playbook"));
    await expect(page.getByTestId("playbook-ligne").filter({ hasText: titre })).toContainText("aucun post");

    // ── Supprimer : la fiche et son journal partent ──────────────────────────
    await page.getByTestId("playbook-ligne").filter({ hasText: titre }).click();
    await page.getByTestId("playbook-supprimer").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Supprimer" }).click();
    await expect(page).toHaveURL(/\/playbook$/);
    await expect(page.getByTestId("playbook-ligne").filter({ hasText: titre })).toHaveCount(0);
    const apres = (await appel({})) as { fiches: { titre: string }[] };
    expect(apres.fiches.some((f) => f.titre === titre)).toBe(false);
  });
});
