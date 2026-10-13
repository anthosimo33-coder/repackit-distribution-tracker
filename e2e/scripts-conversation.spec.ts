import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, type E2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { daysBetween, inspectExport } from "../convex/conversationExport";
import { parisDayKey } from "../convex/viewsDaily";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
const PNG = readFileSync(path.resolve(__dirname, "fixtures/test-image.png"));
const LRM = "‎";

/**
 * Un export WhatsApp iOS français de la FORME de la production : CRLF, ligne
 * système, médias précédés d'U+200E, message sur deux lignes, nom complet de
 * l'utilisatrice, et des dates de SEPTEMBRE — jamais celles du jour du test.
 */
function iosExport(): string {
  const lines = [
    `[02/09/2026 21:03:11] Jules: ${LRM}Les messages et les appels sont chiffrés de bout en bout. Seuls les participants à cette discussion peuvent les lire, les écouter ou les partager.`,
  ];
  for (let d = 2; d <= 27; d++) {
    const dd = String(d).padStart(2, "0");
    lines.push(`[${dd}/09/2026 21:14:02] Léa Martin: t'es où ? Léa t'attend 🙈`);
    lines.push(`[${dd}/09/2026 23:40:51] Jules: ${d % 5 === 0 ? `${LRM}image absente` : "dsl j'étais avec les gars"}`);
  }
  lines.push("[28/09/2026 23:14:02] Léa Martin: jsp si c'est moi mais t'es plus pareil depuis samedi…");
  lines.push("avant on s'appelait tous les soirs");
  lines.push("[29/09/2026 05:52:19] Jules: mdr");
  return lines.join("\r\n") + "\r\n";
}

async function upload(client: E2eClient, body: Buffer | string, contentType: string): Promise<Id<"_storage">> {
  const res = await fetch(await client.mutation(api.conversationFiles.generateConversationUploadUrl, {}), {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

/**
 * Brique CONVERSATION — activable par campagne, tirée HORS combo, une par vidéo,
 * fichiers téléchargés par la créatrice depuis sa mission (le module pur de
 * personnalisation est couvert par lib/conversation-export.test.ts, la rotation
 * par lib/script-conversation.test.ts).
 */
test.describe("Brique conversation", () => {
  test("refus sans fichier, rotation, téléchargement personnalisé, isolation, analytics", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    // Le marqueur de test va EN FIN de nom : le prénom envoyé dans l'export est
    // le premier mot du nom (« Juliette »). Le nettoyage passe par l'email.
    const creator = await createCreatorSession(url, {
      name: `Juliette Chetrit [E2E_TEST] ${ts}`,
      email: `e2e-creator-conv-${ts}@repackit.test`,
      password: "conv-12345",
    });
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Conv ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta" | "conversation", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await add("hook", "Situationship", "4 ans de situationship et je découvre ÇA");
    await add("hook", "Ruiner", "Ce site va RUINER tellement de couples");
    await add("hook", "Téléphone", "Pov : il laisse son téléphone sur la table et tu SAVAIS");
    await add("flux", "S1", "Montre la conv comme si c'était normal, puis importe-la sur le site");
    await add("cta", "Bio", "Le site est en bio 💬 #blush #couple");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingConv ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2econv${ts}`,
    });
    const assign = (videosPerCreator: number) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: creator.creatorId,
        targets: [target],
        videosPerCreator,
        dueDate: ts + 7 * DAY,
        pricingId,
      });
    const rowsFor = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId && a.creatorId === creator.creatorId,
      );

    // ── Allumée, conversations SANS fichier : refus, rien n'est créé.
    await admin.mutation(api.scripts.updateCampaign, { id: campaignId, conversationEnabled: true });
    const mdr = await add("conversation", "A1 · Le mdr", "Il répond « mdr » à 5h52. Toi : « il dormait, c'est normal ».");
    const vu = await add("conversation", "D1 · Les coches bleues", "Deux coches bleues, aucune réponse.");
    await expect(assign(1)).rejects.toThrow(/aucune conversation active/i);
    expect(await rowsFor()).toHaveLength(0);

    // Un export sur A1 (« elle » = Léa Martin, dernier message 2 jours avant le
    // téléchargement), une capture sur D1.
    const exportId = await upload(admin, iosExport(), "text/plain");
    await admin.mutation(api.conversationFiles.addConversationFile, {
      brickId: mdr,
      storageId: exportId,
      name: "WhatsApp Chat - Jules.txt",
      selfName: "Léa Martin",
      participants: ["Léa Martin", "Jules"],
      gapDays: 2,
      messages: 56,
    });
    const imageId = await upload(admin, PNG, "image/png");
    await admin.mutation(api.conversationFiles.addConversationFile, {
      brickId: vu,
      storageId: imageId,
      name: "ecran-coches-bleues.png",
    });
    // Un fichier ni texte ni image : refusé, et effacé du storage.
    const pdfId = await upload(admin, "%PDF-1.4", "application/pdf");
    await expect(
      admin.mutation(api.conversationFiles.addConversationFile, {
        brickId: mdr,
        storageId: pdfId,
        name: "contrat.pdf",
      }),
    ).rejects.toThrow(/ERR_CONVERSATION_FILE_INVALID/);

    // ── Présence : 2 vidéos, 2 conversations DIFFÉRENTES, hors combo.
    expect((await assign(2)).created).toBe(2);
    const rows = await rowsFor();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.conversationBrickId))).toEqual(new Set([mdr, vu]));
    for (const r of rows) expect(r.comboKey!.split(":")).toHaveLength(3);
    const a = rows.find((r) => r.conversationBrickId === mdr)!;
    const b = rows.find((r) => r.conversationBrickId === vu)!;

    // ── Fiche créatrice : texte, fichiers, URL pour l'image seulement, aucun id de brique.
    const mineA = await creator.client.query(api.assignments.getMyAssignment, {
      projectId: creator.projectId,
      id: a._id,
    });
    expect(mineA!.scriptConversation!.text).toBe("Il répond « mdr » à 5h52. Toi : « il dormait, c'est normal ».");
    expect(mineA!.scriptConversation!.files).toEqual([
      expect.objectContaining({ name: "WhatsApp Chat - Jules.txt", kind: "export", url: null }),
    ]);
    expect(JSON.stringify(mineA)).not.toContain(mdr);
    const mineB = await creator.client.query(api.assignments.getMyAssignment, {
      projectId: creator.projectId,
      id: b._id,
    });
    expect(mineB!.scriptConversation!.files[0]).toMatchObject({ kind: "image", name: "ecran-coches-bleues.png" });
    expect(mineB!.scriptConversation!.files[0]!.url).toMatch(/^https?:\/\//);

    // ── Téléchargement : prénom de la créatrice, dernier message à J-2 du jour de Paris.
    const dl = await creator.client.action(api.conversationFiles.downloadConversationExport, {
      projectId: creator.projectId,
      assignmentId: a._id,
      storageId: exportId,
    });
    expect(dl.name).toBe("WhatsApp Chat - Jules.txt");
    expect(dl.text).toContain("] Juliette: jsp si c'est moi mais t'es plus pareil depuis samedi…\r\navant on s'appelait");
    expect(dl.text).toContain("Juliette t'attend 🙈");
    expect(dl.text).not.toMatch(/Léa/);
    expect(dl.text).toContain(`${LRM}image absente`);
    const lu = inspectExport(dl.text);
    expect(lu.messages).toBe(inspectExport(iosExport()).messages);
    expect(daysBetween(lu.lastDay!, parisDayKey(Date.now()))).toBe(2);

    // ── Isolation : le même fichier, demandé via une mission qui ne le porte pas → introuvable.
    await expect(
      creator.client.action(api.conversationFiles.downloadConversationExport, {
        projectId: creator.projectId,
        assignmentId: b._id,
        storageId: exportId,
      }),
    ).rejects.toThrow(/ERR_CONVERSATION_FILE_NOT_FOUND/);

    // ── Remplacer « elle » par rien : le prénom n'est plus touché (dates, si).
    await admin.mutation(api.conversationFiles.updateConversationFile, {
      brickId: mdr,
      storageId: exportId,
      selfName: null,
    });
    const brut = await creator.client.action(api.conversationFiles.downloadConversationExport, {
      projectId: creator.projectId,
      assignmentId: a._id,
      storageId: exportId,
    });
    expect(brut.text).toContain("] Léa Martin: jsp si c'est moi");
    expect(daysBetween(inspectExport(brut.text).lastDay!, parisDayKey(Date.now()))).toBe(2);

    // ── Corriger le HOOK de A (combo réécrit en entier) garde sa conversation.
    const campaign = await admin.query(api.scripts.getCampaign, { id: campaignId });
    const usedHooks = new Set(rows.map((r) => r.scriptCombo!.hookBrickId));
    const otherHook = campaign!.bricks.find((x) => x.kind === "hook" && !usedHooks.has(x._id))!;
    await admin.mutation(api.scripts.editScriptCombo, { id: a._id, slot: "hook", newBrickId: otherHook._id });
    expect((await rowsFor()).find((r) => r._id === a._id)!.conversationBrickId).toBe(mdr);

    // ── Analytics PAR CONVERSATION : on publie A et B, un relevé chacun.
    const views = new Map<Id<"assignments">, number>([
      [a._id, 48_211],
      [b._id, 2_904],
    ]);
    for (const [id, vues] of views) {
      const res = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2econv${ts}/video/${ts}${vues}` }],
      });
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId: res.publicationIds[0],
        capturedAt: Date.now() + 3 * DAY,
        vues,
        likes: 0,
      });
    }
    const perf = await admin.query(api.scriptAnalytics.perfByBrick, { campaignId, window: "j3" });
    const convRows = perf.filter((p) => p.kind === "conversation");
    expect(convRows.find((p) => p.brickId === mdr)).toMatchObject({ postCount: 1, viewsMedian: 48_211 });
    expect(convRows.find((p) => p.brickId === vu)).toMatchObject({ postCount: 1, viewsMedian: 2_904 });
    const decisions = await admin.query(api.scriptDecision.campaignDecisions, { campaignId, window: "j3" });
    expect(decisions.dimensions.find((d) => d.kind === "conversation")!.decisions.map((d) => d.key)).toEqual(
      expect.arrayContaining([mdr, vu]),
    );

    // ── Publiée : la conversation ne se change plus.
    await expect(
      admin.mutation(api.scripts.setAssignmentConversation, { id: a._id, brickId: vu }),
    ).rejects.toThrow(/ERR_SCRIPT_LOCKED_PUBLISHED/);
  });

  /**
   * Les ÉCRANS : l'interrupteur fait apparaître l'onglet, l'avertissement bloque
   * l'assignation tant qu'aucune conversation n'a de fichier, le dépôt depuis le
   * volet lit l'export (auteurs proposés pour « elle »), et la fiche de la
   * créatrice télécharge l'export à son prénom.
   */
  test("interrupteur, onglet, dépôt depuis le volet, téléchargement sur la fiche", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] ConvUI ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await add("hook", "Situationship", `4 ans de situationship et je découvre ÇA ${ts}`);
    await add("flux", "S1", `Montre la conv, puis importe-la sur le site ${ts}`);
    await add("cta", "Bio", `Le site est en bio 💬 ${ts}`);

    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("combo-count")).toContainText("1", { timeout: 15_000 });
    const convTab = page.getByRole("tab", { name: /^Scénario/ });
    const assignButton = page.getByRole("button", { name: "Assigner cette campagne" });

    // Éteinte : pas d'onglet (l'onglet Hook, lui, est là), assignable.
    await expect(page.getByRole("tab", { name: /^Hook/ })).toBeVisible();
    await expect(convTab).toHaveCount(0);
    await expect(assignButton).toBeEnabled();

    // Allumée sans conversation : onglet, avertissement, assignation bloquée.
    await page.getByTestId("conversation-toggle").click();
    await expect(convTab).toBeVisible();
    await expect(page.getByTestId("conversation-missing")).toBeVisible();
    await expect(assignButton).toBeDisabled();

    // Création depuis le volet, puis dépôt de l'export.
    await convTab.click();
    await page.getByRole("button", { name: "Ajouter" }).first().click();
    const volet = page.getByRole("region", { name: "Édition de la brique sélectionnée" });
    await volet.locator("#brick-content").fill(`Il répond « mdr » à 5h52 ${ts}`);
    await volet.locator("#brick-label").fill(`A1 · Le mdr ${ts}`);
    await volet.getByRole("button", { name: "Ajouter" }).click();
    await expect(volet.getByTestId("conversation-files")).toBeVisible({ timeout: 15_000 });
    // Toujours bloquée : la conversation existe mais n'a pas de fichier.
    await expect(assignButton).toBeDisabled();

    await volet.getByTestId("conversation-file-input").setInputFiles({
      name: "WhatsApp Chat - Jules.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(iosExport()),
    });
    await expect(volet.getByTestId("conversation-file")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("brick-files-tag")).toHaveText("1 fichier");
    await expect(page.getByTestId("conversation-missing")).toHaveCount(0);
    await expect(assignButton).toBeEnabled();

    // « Elle » = Léa Martin, proposée parmi les auteurs lus dans l'export.
    await volet.getByTestId("conversation-self-name").click();
    await page.getByRole("option", { name: "Léa Martin" }).click();
    await expect
      .poll(async () => {
        const c = await admin.query(api.scripts.getCampaign, { id: campaignId });
        const f = c!.bricks.find((x) => x.kind === "conversation")!.conversationFiles![0]!;
        return { selfName: f.selfName, participants: f.participants };
      })
      .toEqual({ selfName: "Léa Martin", participants: ["Jules", "Léa Martin"] });

    // Fiche de la créatrice (vue observée) : télécharger rend l'export à SON prénom.
    const creator = await createCreatorSession(url, {
      name: `Inès Garnier [E2E_TEST] ${ts}`,
      email: `e2e-creator-convui-${ts}@repackit.test`,
      password: "convui-12345",
    });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingConvUI ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2econvui${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.scriptCombo?.campaignId === campaignId,
    )!;
    await page.goto(`/admin/voir/${E2E_PROJECT_SLUG}/${creator.creatorId}/assignments/${row._id}`);
    const card = page.getByTestId("script-conversation");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("script-conversation-text")).toHaveText(`Il répond « mdr » à 5h52 ${ts}`);
    const download = page.waitForEvent("download");
    await card.getByRole("button", { name: "Télécharger" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("WhatsApp Chat - Jules.txt");
    const text = readFileSync((await file.path())!, "utf8");
    expect(text).toContain("] Inès: jsp si c'est moi mais t'es plus pareil");
    expect(text).not.toMatch(/Léa/);
  });
});
