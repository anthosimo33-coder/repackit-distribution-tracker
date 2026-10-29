import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import type { Page } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;

type Rpc = { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/** Une clé créée dans l'écran, interrupteur « Scripts » allumé (le playbook en fait partie). */
async function cle(page: Page, nom: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const interrupteur = page.getByRole("switch", { name: `Modifications des scripts pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  await page.keyboard.press("Escape");
  const noms = ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
  expect(noms).toContain("documenter_format");
  const appel = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  const defaire = async () => {
    const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const cible = liste.find((m) => m.outil === "documenter_format" && m.etat === "se défait");
    expect(cible, "aucune modification « documenter_format » défaisable").toBeDefined();
    return appel("defaire", { rang: cible!.rang, outil: "documenter_format" });
  };
  return { appel, defaire };
}

/** Un identifiant TikTok qui ENCODE sa date de mise en ligne (32 bits de poids fort = secondes Unix), comme les vrais. */
const idTikTok = (ts: number, bas: number) => ((BigInt(Math.floor(ts / 1000)) << BigInt(32)) + BigInt(bas)).toString();

type Post = { compte: string; vues: number; lien: string };

/**
 * DOCUMENTER UN FORMAT PAR CLAUDE — la file « à documenter » (posts qui sortent
 * du lot sans fiche), `documenter_format` qui crée puis met à jour une fiche
 * (posts par lien, doublon d'une même vidéo ignoré, motif au journal de la
 * fiche, signé « écrit par Claude »), et `defaire`, refusé quand la fiche a été
 * retouchée depuis.
 */
test.describe("Playbook — documenter_format", () => {
  test("file à documenter, créer, mettre à jour, défaire", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const titre = `[E2E_TEST] Format conv qui choque ${ts}`;
    const nomCle = `E2E Documenter ${ts}`;
    // Des vues PLUS HAUTES à chaque run (secondes Unix) : la file n'en montre que 15,
    // et la base locale garde les posts des runs précédents et des autres specs.
    const haut = Math.floor(ts / 1000);

    const misEnLigne = ts - 30 * HOUR;
    const icpId = (await admin.mutation(api.icps.createIcp, { nom: `[E2E_TEST] Documenter ${ts}` })) as Id<"icps">;
    const creees: Id<"publications">[] = [];
    async function poste(compte: string, lien: string, vues: number) {
      const carouselId = await admin.query(api.publications.getNextCarouselId, {});
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Documenter ${compte}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: ["TikTok"],
        compte,
        datePubli: misEnLigne + 3 * HOUR,
        notes: "[E2E_TEST] documenter",
      });
      const id = ids[0] as Id<"publications">;
      creees.push(id);
      await admin.mutation(api.publications.updateMetrics, { id, postUrl: lien });
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: id,
        vues,
        likes: Math.round(vues * 0.05),
        capturedAt: ts - HOUR,
        source: "tiktok",
      });
    }
    const compte = (x: string) => `@e2e_doc_${x}_${ts}`;
    const video1 = idTikTok(misEnLigne, 101 + (ts % 1000));
    const video2 = idTikTok(misEnLigne, 2101 + (ts % 1000));
    const video3 = idTikTok(misEnLigne, 4101 + (ts % 1000));
    // La vidéo 1 sur DEUX comptes ; la 2 seule ; la 3 sous le seuil.
    const v1a: Post = { compte: compte("a"), vues: haut + 2, lien: `https://www.tiktok.com/${compte("a")}/video/${video1}` };
    const v1b: Post = { compte: compte("b"), vues: haut - 5_000, lien: `https://www.tiktok.com/${compte("b")}/video/${video1}?_r=1` };
    const v2: Post = { compte: compte("c"), vues: haut + 3, lien: `https://www.tiktok.com/${compte("c")}/video/${video2}` };
    const v3: Post = { compte: compte("d"), vues: 9_999, lien: `https://www.tiktok.com/${compte("d")}/video/${video3}` };
    for (const p of [v1a, v1b, v2, v3]) await poste(p.compte, p.lien, p.vues);

    const { appel, defaire } = await cle(page, nomCle);
    const lirePlaybook = async () =>
      JSON.parse((await appel("playbook", {})).texte) as {
        fiches: { titre: string; statut: string; postsDePreuve: number }[];
        aDocumenter: { total: number; posts: { compte: string; vues: number }[] };
      };
    const miens = (posts: { compte: string; vues: number }[]) => posts.filter((p) => p.compte.includes(`_${ts}`));

    // ── La file : la vidéo 1 une fois (son meilleur compte), la 2, pas la 3 ──
    const avant = await lirePlaybook();
    expect(miens(avant.aDocumenter.posts)).toEqual([
      expect.objectContaining({ compte: v2.compte, vues: v2.vues }),
      expect.objectContaining({ compte: v1a.compte, vues: v1a.vues }),
    ]);

    // ── Créer la fiche, avec deux posts (la vidéo 1 par son AUTRE compte) ────
    const recette = `Hook sur la conv, flux capture, CTA « je vois ça que maintenant » ${ts}`;
    const creation = await appel("documenter_format", {
      titre,
      statut: "en_test",
      recette,
      preuves: "2 posts au-dessus de 10 000 vues au 29/10",
      posts: [v1b.lien, v2.lien],
      motif: "Deux posts sortent du lot en 30 jours",
    });
    expect(creation.erreur, creation.texte).toBe(false);
    const cree = JSON.parse(creation.texte) as { fait: string; lien: string };
    expect(cree.fait).toBe(`Fiche « ${titre} » créée (en test, 2 posts de preuve)`);
    const ficheId = cree.lien.split("/").pop() as Id<"playbookFiches">;
    // Rangés : la vidéo 1 sort de la file même par son autre compte.
    expect(miens((await lirePlaybook()).aDocumenter.posts)).toEqual([]);

    // ── Un titre qui existe déjà, ou pas de motif : refusé, rien n'est écrit ─
    const doublon = await appel("documenter_format", { titre: titre.toUpperCase(), motif: "doublon" });
    expect(doublon.erreur).toBe(true);
    expect(doublon.texte).toContain("existe déjà");
    const sansMotif = await appel("documenter_format", { fiche: titre, statut: "prouve" });
    expect(sansMotif.erreur).toBe(true);

    // ── Mettre à jour : prouvé, la vidéo 1 recollée (ignorée), la 2 retirée ─
    const maj = await appel("documenter_format", {
      fiche: `conv qui choque ${ts}`,
      statut: "prouve",
      posts: [v1a.lien],
      retirer_posts: [v2.lien],
      motif: "Troisième post au-dessus de 10 000",
    });
    expect(maj.erreur, maj.texte).toBe(false);
    const modifiee = JSON.parse(maj.texte) as { fait: string; dejaPresents?: string[] };
    expect(modifiee.fait).toBe(`Fiche « ${titre} » : statut en test → prouvé ; −1 post`);
    expect(modifiee.dejaPresents).toEqual([v1a.lien]);
    expect(miens((await lirePlaybook()).aDocumenter.posts)).toEqual([expect.objectContaining({ compte: v2.compte })]);

    // ── À l'écran : le journal dit que Claude a écrit, la file montre la vidéo 2 ─
    await page.goto(adminPath(`/playbook/${ficheId}`));
    // Une écriture = une ligne par geste (statut, post retiré), chacune avec le motif et la signature.
    const lignes = page.getByTestId("playbook-journal-ligne");
    const statut = lignes.filter({ hasText: "Statut : En test → Prouvé" });
    await expect(statut).toContainText("« Troisième post au-dessus de 10 000 »");
    await expect(statut).toContainText(`écrit par Claude (${nomCle})`);
    const retrait = lignes.filter({ hasText: "Post retiré" });
    await expect(retrait).toContainText(v2.lien);
    await expect(retrait).toContainText("« Troisième post au-dessus de 10 000 »");
    await page.goto(adminPath("/playbook"));
    await expect(page.getByTestId("playbook-a-documenter-post").filter({ hasText: v2.compte })).toHaveCount(1);
    await expect(page.getByTestId("playbook-a-documenter-post").filter({ hasText: v1a.compte })).toHaveCount(0);

    // ── Défaire la mise à jour : en test, la vidéo 2 revient ─────────────────
    const d1 = await defaire();
    expect(d1.erreur, d1.texte).toBe(false);
    const remise = JSON.parse((await appel("playbook", { fiche: titre })).texte) as {
      statut: string;
      postsDePreuve: { lien: string }[];
      journal: { motif: string | null }[];
    };
    expect(remise.statut).toBe("en test");
    expect(remise.postsDePreuve.map((p) => p.lien).sort()).toEqual([v1b.lien, v2.lien].sort());
    expect(remise.journal[0].motif).toBe("Défait : modification de Claude annulée.");

    // ── Retouchée à l'écran depuis : défaire la création est refusé ──────────
    await admin.mutation(api.playbook.modifierFiche, { id: ficheId, regles: `Ne pas toucher au CTA ${ts}` });
    const d2 = await defaire();
    expect(d2.erreur).toBe(true);
    expect(d2.texte).toContain("retouchée depuis");
    expect((await lirePlaybook()).fiches.some((f) => f.titre === titre)).toBe(true);

    // ── Une fiche créée puis défaite tout de suite : elle disparaît ──────────
    const titre2 = `[E2E_TEST] Format éphémère ${ts}`;
    expect((await appel("documenter_format", { titre: titre2, motif: "essai" })).erreur).toBe(false);
    const d3 = await defaire();
    expect(d3.erreur, d3.texte).toBe(false);
    expect((await lirePlaybook()).fiches.some((f) => f.titre === titre2)).toBe(false);

    // ── Ménage ───────────────────────────────────────────────────────────────
    await admin.mutation(api.playbook.supprimerFiche, { id: ficheId });
    for (const id of creees) await admin.mutation(api.publications.deletePublication, { id });
  });
  /**
   * La voie de la routine : une connexion en LECTURE SEULE propose la fiche, la
   * carte de l'accueil montre ce qui sera écrit, et « Appliquer » l'écrit.
   */
  test("proposer une fiche, la lire sur l'accueil, l'appliquer", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const titre = `[E2E_TEST] Format proposé ${ts}`;
    const nomCle = `E2E routine playbook ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const noms = ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
    expect(noms).not.toContain("documenter_format");
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const recette = `Capture de la conv en plan fixe, puis la réaction ${ts}`;
    const resume = `Ouvrir la fiche « ${titre} » (en test)`;
    const p = await appel("proposer", {
      outil: "documenter_format",
      arguments: { titre, statut: "en_test", recette, regles: "Garder le texte incrusté mot pour mot", motif: "Un post à 31 000 vues au 29/10" },
      resume,
      pourquoi: "Un post à 31 000 vues sans fiche (file « à documenter »).",
    });
    expect(p.erreur, p.texte).toBe(false);

    await page.goto(adminPath("/dashboard"));
    const ligne = page.getByTestId("propositions-claude").getByTestId("proposition").filter({ hasText: resume });
    await expect(ligne).toContainText("Fiche du playbook écrite");
    const apercu = ligne.getByTestId("proposition-apercu");
    await expect(apercu).toContainText("Ce qui sera écrit dans la fiche du playbook :");
    await expect(apercu).toContainText(`Nouvelle fiche « ${titre} » · en test`);
    await expect(apercu).toContainText(recette);
    await expect(apercu).toContainText("Garder le texte incrusté mot pour mot");
    await ligne.getByRole("button", { name: "Appliquer" }).click();
    await expect(page.getByText(/Appliquée :/)).toBeVisible();

    const fiche = JSON.parse((await appel("playbook", { fiche: titre })).texte) as {
      statut: string;
      recette: string;
      journal: { geste: string; motif: string | null }[];
      lien: string;
    };
    expect(fiche).toMatchObject({ statut: "en test", recette });
    expect(fiche.journal).toEqual([expect.objectContaining({ geste: "creation", motif: "Un post à 31 000 vues au 29/10" })]);
    await admin.mutation(api.playbook.supprimerFiche, { id: fiche.lien.split("/").pop() as Id<"playbookFiches"> });
  });
});
