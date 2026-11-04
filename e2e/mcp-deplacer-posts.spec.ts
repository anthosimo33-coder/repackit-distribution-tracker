import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}
const jourParis = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + n * DAY));

/**
 * OUTIL MCP `deplacer_posts` — cas du 04/11/2026 : Ilona renomme son TikTok, le
 * nouveau @ est déclaré et l'ancien archivé ; les posts déjà sortis restent sur
 * la fiche archivée. L'outil range les posts publiés sur l'autre compte de la
 * même créatrice : le handle du post ET le compte de la cible de sa mission.
 * Lot choisi par liens ou tout le compte, refus vers un compte archivé, défaisable.
 */
test.describe("MCP — deplacer_posts", () => {
  test("déplacer un post par son lien, puis le reste ; refusé vers un compte archivé ; défaire", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const nom = `Ilona Renommée ${ts}`;
    const ancien = `@ilosnitchy${ts}`;
    const nouveau = `@ilosnytch${ts}`;
    const c = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-deplacer-${ts}@repackit.test`, password: "deplacer-123456" });
    const cAncien = await availableTarget({ e2eClient: admin, creatorId: c.creatorId, platform: "TikTok", handle: ancien });
    await availableTarget({ e2eClient: admin, creatorId: c.creatorId, platform: "TikTok", handle: nouveau });

    // Deux missions sur l'ancien compte, deux jours.
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Renommage ${ts}` })) as Id<"scriptCampaigns">;
    for (const [kind, label, content] of [
      ["hook", "Hook 1", `Il m'a dit qu'il dormait ${ts}`],
      ["hook", "Hook 2", `Elle était « juste une amie » ${ts}`],
      ["flux", "Flux", "Je scanne son compte avec l'appli."],
      ["cta", "CTA", "Le lien est dans ma bio."],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] Barème ${ts}`, montantFixe: 70, nbVideosCible: 7, tauxCPM: 1.5 });
    const J2 = jourParis(2);
    const J3 = jourParis(3);
    const midi = (j: string) => {
      const [y, m, d] = j.split("-").map(Number);
      return Date.UTC(y, m - 1, d, 12);
    };
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: c.creatorId,
      targets: [cAncien],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [midi(J2), midi(J3)],
    });

    // Une clé « Publications » (deplacer_posts, confirmer_publication) + « Missions » (planning).
    const nomCle = `E2E deplacer ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const interrupteur = page.getByRole("switch", { name: `Modifications des publications pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };

    // Les deux posts sortent sur l'ancien compte (liens au @ du nouveau : TikTok sert par l'id).
    const lien = (n: number) =>
      `https://www.tiktok.com/${nouveau}/video/${((BigInt(Math.floor(ts / 1000)) << BigInt(32)) + BigInt(n)).toString()}`;
    for (const [jour, n] of [[J2, 1], [J3, 2]] as const) {
      const cp = await appel("confirmer_publication", { createatrice: nom, jour, liens: [lien(n)] });
      expect(cp.erreur, cp.texte).toBe(false);
    }
    // L'équipe archive l'ancien @ : les posts publiés y restent.
    await admin.mutation(api.comptes.updateCompte, { id: cAncien.accountId, status: "archived" });

    const comptesDesPosts = async () => {
      const pubs = await admin.query(api.publications.listPublications, {});
      return [lien(1), lien(2)].map((l) => pubs.find((p) => p.postUrl === l)?.compte);
    };
    const comptesDesMissions = async () =>
      (await admin.query(api.assignments.listAssignments, {}))
        .filter((a) => a.creatorId === c.creatorId)
        .sort((a, b) => (a.postDate ?? 0) - (b.postDate ?? 0))
        .map((a) => a.targets[0].accountHandle);
    expect(await comptesDesPosts()).toEqual([ancien, ancien]);
    expect(await comptesDesMissions()).toEqual([ancien, ancien]);

    // ── Refus : jamais vers un compte archivé ─────────────────────────────────
    const versArchive = await appel("deplacer_posts", { compte: nouveau, nouveau_compte: ancien });
    expect(versArchive.erreur).toBe(true);
    expect(versArchive.texte).toContain("archivé");

    // ── Un post, désigné par son lien (paramètres de partage compris) ─────────
    const un = await appel("deplacer_posts", { compte: ancien, nouveau_compte: nouveau, liens: [`${lien(1)}?_r=1&_t=ZN-9B7zsPjiAVS`] });
    expect(un.erreur, un.texte).toBe(false);
    expect(JSON.parse(un.texte).fait).toContain("1 post(s) déplacé(s)");
    expect(await comptesDesPosts()).toEqual([nouveau, ancien]);
    expect(await comptesDesMissions()).toEqual([nouveau, ancien]);

    // ── Le reste du compte, sans liens ────────────────────────────────────────
    const reste = await appel("deplacer_posts", { compte: ancien, nouveau_compte: nouveau });
    expect(reste.erreur, reste.texte).toBe(false);
    expect(JSON.parse(reste.texte).fait).toContain("1 post(s) déplacé(s)");
    expect(await comptesDesPosts()).toEqual([nouveau, nouveau]);
    expect(await comptesDesMissions()).toEqual([nouveau, nouveau]);
    const vide = await appel("deplacer_posts", { compte: ancien, nouveau_compte: nouveau });
    expect(vide.erreur).toBe(true);
    expect(vide.texte).toContain("ne porte aucun post");

    // ── Défaire le dernier déplacement : ce post-là revient, l'autre reste ────
    const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const dernier = liste.find((m) => m.outil === "deplacer_posts" && m.etat === "se défait");
    expect(dernier, "rien à défaire pour deplacer_posts").toBeDefined();
    const d = await appel("defaire", { rang: dernier!.rang, outil: "deplacer_posts" });
    expect(d.erreur, d.texte).toBe(false);
    expect(await comptesDesPosts()).toEqual([nouveau, ancien]);
    expect(await comptesDesMissions()).toEqual([nouveau, ancien]);
  });
});
