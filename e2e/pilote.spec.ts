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
const DAY = 24 * 3_600_000;
const jourParis = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + n * DAY));
const jourDe = (ts: number | undefined) =>
  ts === undefined ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));
type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
async function appel(url: string, token: string, name: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } } }),
  });
  const j = (await r.json()) as Rpc;
  return { erreur: j.error !== undefined || j.result?.isError === true, texte: j.error?.message ?? j.result?.content?.[0]?.text ?? "" };
}
/** Minuit de Paris de ce jour : la forme des `postDate`. */
const minuitParis = (jour: string) => {
  const t = Date.parse(`${jour}T00:00:00Z`);
  const decalage = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).format(new Date(t)),
  );
  return t - decalage * 3_600_000;
};

/**
 * PILOTE DES MISSIONS — de bout en bout, sur une vraie semence : une créatrice
 * dont un parlé a fait ×4,5 sa médiane il y a 6 jours. On classe ses deux
 * campagnes (parlé, muet), le pilote propose sa semaine — le gagnant rejoué à
 * l'identique au premier midi, des nouveaux scripts ailleurs, un muet chaque
 * soir —, on retire un créneau, on assigne : les missions sont en base avec
 * leur jour, leur plage et leur lignage, et le créneau retiré reste seul libre.
 */
test.describe("Pilote des missions", () => {
  test("classer, proposer, retirer, assigner", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const nom = `Juliette Pilote ${ts}`;
    const juliette = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] ${nom}`,
      email: `e2e-pilote-${ts}@repackit.test`,
      password: "pilote-12345",
    });
    const handle = `@juliettepilote${ts}`;
    const cible = await availableTarget({ e2eClient: admin, creatorId: juliette.creatorId, platform: "TikTok", handle });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème pilote ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2.5,
    });
    await admin.mutation(api.creators.updateCreatorPayTerms, { id: juliette.creatorId, bonusPricingId: pricingId });

    // Deux campagnes de 10 scripts : assez pour sa semaine, une fois ses passés retirés.
    const campagne = async (nomC: string) => {
      const id = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${nomC} ${ts}` })) as Id<"scriptCampaigns">;
      for (let i = 0; i < 10; i++) {
        await admin.mutation(api.scripts.createBrick, { campaignId: id, kind: "hook", label: `${nomC} hook ${i}`, content: `${nomC} ${i} ${ts}` });
      }
      await admin.mutation(api.scripts.createBrick, { campaignId: id, kind: "flux", label: "Flux", content: "Je te montre." });
      await admin.mutation(api.scripts.createBrick, { campaignId: id, kind: "cta", label: "CTA", content: "Lien en bio." });
      return id;
    };
    const parle = await campagne("Parlé");
    const muet = await campagne("Muet");

    // Ses vidéos passées, publiées et relevées : parlé 1 000 / 1 200 / 800 / 5 000 (×4,5), muet 3 000 ×3.
    let seq = 0;
    const passe = async (campaignId: Id<"scriptCampaigns">, il_y_a: number, vues: number) => {
      const jour = jourParis(-il_y_a);
      const { assignmentIds } = (await admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: juliette.creatorId,
        targets: [cible],
        videosPerCreator: 1,
        dueDate: Date.now() + DAY,
        pricingId,
        postDates: [minuitParis(jour)],
      })) as unknown as { assignmentIds?: Id<"assignments">[] };
      const id =
        assignmentIds?.[0] ??
        (await admin.query(api.assignments.listAssignments, {})).find(
          (a) => a.creatorId === juliette.creatorId && jourDe(a.postDate) === jour && a.scriptCombo?.campaignId === campaignId,
        )!._id;
      seq += 1;
      const publieeA = Date.now() - il_y_a * DAY;
      const videoId = ((BigInt(Math.floor(publieeA / 1000)) << BigInt(32)) + BigInt(7000 + seq)).toString();
      const lien = `https://www.tiktok.com/${handle}/video/${videoId}`;
      await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id,
        urls: [{ platform: "TikTok", url: lien }],
        publishedAt: publieeA,
        allowBackdate: true,
      });
      const pub = (await admin.query(api.publications.listPublications, {})).find((p) => p.postUrl === lien)!;
      await admin.mutation(api.metricSnapshots.createSnapshot, { publicationId: pub._id, capturedAt: Date.now() - 3_600_000, vues, likes: 0 });
      return id;
    };
    await passe(parle, 12, 1000);
    await passe(parle, 11, 1200);
    await passe(parle, 10, 800);
    const gagnant = await passe(parle, 6, 5000);
    await passe(muet, 9, 3000);
    await passe(muet, 8, 3000);
    await passe(muet, 7, 3000);

    // ── L'écran : choisir la créatrice, classer ses campagnes ─────────────────
    await page.goto(adminPath("/pilote"));
    await expect(page.getByRole("heading", { name: "Pilote des missions" })).toBeVisible();
    // FilterMultiSelect : la <label> est sœur du bouton role=combobox.
    await page.getByText("Créatrices", { exact: true }).locator("xpath=..").getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(nom) }).click();
    await page.keyboard.press("Escape");

    const campagnes = page.getByTestId("pilote-campagne");
    await expect(campagnes).toHaveCount(2);
    // Non classées : hors du pilote, la créatrice n'a rien à remplir.
    await expect(page.getByTestId("pilote-createatrice")).toContainText("Hors du pilote tant qu’elles ne sont pas classées");
    await campagnes.filter({ hasText: `Parlé ${ts}` }).getByRole("radio", { name: "Parlé" }).click();
    await campagnes.filter({ hasText: `Muet ${ts}` }).getByRole("radio", { name: "Muet" }).click();

    // ── Le plan : le gagnant au premier midi, un muet chaque soir ─────────────
    const creneaux = page.getByTestId("pilote-creneau");
    await expect(creneaux).toHaveCount(14);
    await expect(creneaux.first()).toContainText("Rejouer son post");
    await expect(creneaux.first()).toContainText("×4,5 la médiane");
    await expect(creneaux.first()).toContainText("Midi");
    await expect(creneaux.nth(1)).toContainText("Muet");
    await expect(creneaux.nth(1)).toContainText("Nouveau script");
    await expect(page.getByTestId("pilote-createatrice")).toContainText("Médianes à 72 h");

    // Retirer le muet du 2e soir.
    await creneaux.nth(3).getByTestId("pilote-retirer").click();
    await expect(creneaux.nth(3)).toContainText("Retiré");
    await expect(page.getByTestId("pilote-assigner")).toHaveText("Assigner 13 missions");

    // ── Assigner ──────────────────────────────────────────────────────────────
    await page.getByTestId("pilote-assigner").click();
    await expect(page.getByRole("dialog")).toContainText("UN email pour toute sa semaine");
    await page.getByTestId("pilote-confirmer").click();
    await expect(page.getByText("13 missions assignées.")).toBeVisible();

    const J1 = jourParis(1);
    const J2 = jourParis(2);
    const futures = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.creatorId === juliette.creatorId && (jourDe(a.postDate) ?? "") >= J1,
    );
    expect(futures).toHaveLength(13);
    const rejeu = futures.find((a) => a.replayedFrom === gagnant)!;
    expect(rejeu).toBeDefined();
    expect(jourDe(rejeu.postDate)).toBe(J1);
    expect(rejeu.postWindow).toEqual({ startMin: 11 * 60, endMin: 13 * 60 });
    expect(rejeu.replayVerbatim).toBe(true);
    // Chaque vidéo a son échéance : la fin de son jour de publication.
    for (const a of futures) expect(jourDe(a.dueDate)).toBe(jourDe(a.postDate));
    // Un muet chaque soir, sauf le 2e, retiré.
    const soirs = futures.filter((a) => a.postWindow?.startMin === 21 * 60).map((a) => jourDe(a.postDate));
    expect(soirs).toHaveLength(6);
    expect(soirs).not.toContain(J2);
    expect(futures.filter((a) => a.scriptCombo?.campaignId === muet)).toHaveLength(6);

    // Le plan se recalcule : seul le créneau retiré reste à remplir.
    await expect(creneaux).toHaveCount(1);
    await expect(creneaux.first()).toContainText("Muet");

    // ── Le même plan par Claude : outil MCP `piloter_missions` ────────────────
    const nomCle = `E2E pilote ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    await page.getByRole("switch", { name: `Modifications des missions pour ${nomCle}` }).click();
    await expect(page.getByRole("switch", { name: `Modifications des missions pour ${nomCle}` })).toBeChecked();

    const pilote = { createatrices: [nom], du: J1, jours: 7 };
    const sim = await appel(url, token, "piloter_missions", { ...pilote, simuler: true });
    expect(sim.erreur, sim.texte).toBe(false);
    const plan = JSON.parse(sim.texte).plan as { creneaux: { creneau: string; etage: string; nouveau?: string }[] }[];
    expect(plan[0].creneaux).toEqual([expect.objectContaining({ creneau: `${J2} soir`, etage: "muet" })]);
    // Retiré, ce créneau ne crée rien.
    const rien = await appel(url, token, "piloter_missions", { ...pilote, retirer: [`${nom} ${J2} soir`] });
    expect(rien.erreur, rien.texte).toBe(false);
    expect(rien.texte).toContain("Aucune mission créée");
    const ok = await appel(url, token, "piloter_missions", pilote);
    expect(ok.erreur, ok.texte).toBe(false);
    expect(JSON.parse(ok.texte).parCreatrice[0]).toMatchObject({ creees: 1, emailEnvoye: true });
    const deJ2 = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.creatorId === juliette.creatorId && jourDe(a.postDate) === J2,
    );
    expect(deJ2.map((a) => a.postWindow?.startMin ?? -1).sort((x, y) => x - y)).toEqual([11 * 60, 21 * 60]);
  });
});
