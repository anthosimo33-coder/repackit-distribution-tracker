import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { parisDayKey } from "../convex/viewsDaily";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DOCS = path.resolve(__dirname, "../docs/scenarios");
const BIBLE_C2 = readFileSync(path.join(DOCS, "bibles/bible_C2.json"), "utf8");
const EXPORT_KELLY = readFileSync(path.join(DOCS, "samples/WhatsApp Chat - Kelly, Yanis.txt"), "utf8");
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** La bible C2 sous un autre code : chaque test a son scénario, le projet e2e est partagé. */
function bibleSous(code: string): string {
  return BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`);
}

/**
 * SCÉNARIOS — l'écran et ses fonctions. Le moteur lui-même est couvert par
 * lib/scenario-engine.test.ts (égalité avec le Python) ; ici, on tient le
 * chemin COMPLET : la bible importée par l'écran, générée dans le navigateur,
 * téléchargée — et le fichier obtenu est celui du moteur de référence.
 */
test.describe("Scénarios", () => {
  test("serveur : création, code unique, bible invalide refusée, thème, statut, duplication", async () => {
    const ts = Date.now().toString(36).toUpperCase();
    const code = `T${ts}`.slice(0, 12);
    const id = await admin.mutation(api.scenarios.creerScenario, { bible: bibleSous(code), theme: " La dispute " });
    const lu = await admin.query(api.scenarios.getScenario, { id });
    expect(lu).toMatchObject({ code, titre: "Le like de l'ex", type: "couple", theme: "La dispute", statut: "brouillon" });

    // Le même code une seconde fois : refusé.
    await expect(
      admin.mutation(api.scenarios.creerScenario, { bible: bibleSous(code), theme: "" }),
    ).rejects.toThrow(/ERR_SCENARIO_CODE_TAKEN/);
    // Une bible cassée n'est jamais enregistrée (écran choc sans secondes).
    const cassee = bibleSous(`${code}X`).replace('"2026-10-12 21:47:12"', '"2026-10-12 21:47"');
    await expect(
      admin.mutation(api.scenarios.creerScenario, { bible: cassee, theme: "" }),
    ).rejects.toThrow(/ERR_SCENARIO_BIBLE_INVALID/);
    await expect(admin.mutation(api.scenarios.modifierScenario, { id, bible: "{" })).rejects.toThrow(
      /ERR_SCENARIO_BIBLE_INVALID/,
    );

    await admin.mutation(api.scenarios.modifierScenario, { id, theme: "Il répond plus pareil" });
    await admin.mutation(api.scenarios.changerStatutScenario, { id, statut: "actif" });
    expect(await admin.query(api.scenarios.getScenario, { id })).toMatchObject({
      theme: "Il répond plus pareil",
      statut: "actif",
      bible: bibleSous(code),
    });

    const copie = await admin.mutation(api.scenarios.dupliquerScenario, { id, code: `${code}B` });
    const c = await admin.query(api.scenarios.getScenario, { id: copie });
    expect(c).toMatchObject({ code: `${code}B`, statut: "brouillon", theme: "Il répond plus pareil" });
    expect(JSON.parse(c!.bible).ecran_choc).toEqual(JSON.parse(BIBLE_C2).ecran_choc);

    const liste = await admin.query(api.scenarios.listScenarios, {});
    expect(liste.map((s) => s.code)).toEqual(expect.arrayContaining([code, `${code}B`]));
    // La liste ne transporte pas les bibles.
    expect(liste.every((s) => !("bible" in s))).toBe(true);
  });

  test("écran : import, erreurs en clair, Tester → l'export du moteur de référence", async ({ page }) => {
    test.setTimeout(120_000);
    const code = `E${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
    await page.goto(adminPath("/scenarios"));
    await expect(page.getByRole("heading", { name: "Scénarios" })).toBeVisible({ timeout: 20_000 });

    // Import : la bible est vérifiée dans la fenêtre AVANT l'envoi.
    await page.getByTestId("scenario-import-input").setInputFiles({
      name: "bible_C2.json",
      mimeType: "application/json",
      buffer: Buffer.from(bibleSous(code)),
    });
    const dialogue = page.getByRole("dialog");
    await expect(dialogue.getByTestId("bible-ok")).toBeVisible();
    await dialogue.getByLabel("Thème").fill("La dispute");
    await dialogue.getByRole("button", { name: "Créer" }).click();

    // L'éditeur : saisie cassée → erreurs nommées ; rétablie → valide.
    const bible = page.getByTestId("scenario-bible");
    await expect(bible).toHaveValue(bibleSous(code), { timeout: 20_000 });
    await bible.fill(bibleSous(code).replace('"type": "couple"', '"type": "situationship"').replace('"L": 0.012', '"L": 1.5'));
    const erreurs = page.getByTestId("bible-erreur");
    await expect(erreurs).toHaveCount(2);
    await expect(page.getByTestId("bible-erreurs")).toContainText("type inconnu");
    await expect(page.getByTestId("bible-erreurs")).toContainText("vocaux.L");
    await expect(page.getByTestId("scenario-enregistrer")).toBeDisabled();
    await bible.fill(bibleSous(code));
    await expect(page.getByTestId("bible-ok")).toBeVisible();

    // La liste range le scénario importé sous son thème.
    await page.goto(adminPath("/scenarios"));
    const theme = page.getByTestId("scenario-theme").filter({ hasText: "La dispute" });
    await expect(theme.getByTestId("scenario-row").filter({ hasText: code })).toBeVisible({ timeout: 20_000 });

    // La graine du moteur contient le CODE (« C2-Kelly-7 ») : l'égalité avec le
    // Python se vérifie sur le scénario C2 lui-même (créé s'il n'existe pas
    // encore dans la base e2e).
    const existant = (await admin.query(api.scenarios.listScenarios, {})).find((s) => s.code === "C2");
    const c2 = existant?._id ?? (await admin.mutation(api.scenarios.creerScenario, { bible: BIBLE_C2, theme: "La dispute" }));
    await page.goto(adminPath(`/scenarios/${c2}`));
    await expect(page.getByTestId("scenario-bible")).toHaveValue(BIBLE_C2, { timeout: 20_000 });

    // Tester, dates de la bible, Kelly, graine 7 : les chiffres du Python…
    await page.getByLabel("Prénom de la créatrice").fill("Kelly");
    await page.getByRole("button", { name: "Dates de la bible" }).click();
    await page.getByTestId("scenario-tester").click();
    const stats = page.getByTestId("scenario-stats");
    await expect(stats).toContainText("messages : 5920 (Kelly 2996, Yanis 2924)", { timeout: 30_000 });
    await expect(stats).toContainText("jour record : 212 messages le 2026-02-14");
    await expect(page.getByTestId("scenario-ecran")).toBeVisible();

    // …et le .txt téléchargé est, octet pour octet, celui du moteur de référence.
    const dlTxt = page.waitForEvent("download");
    await page.getByTestId("telecharger-txt").click();
    const txt = await dlTxt;
    expect(txt.suggestedFilename()).toBe("WhatsApp Chat - Kelly, Yanis.txt");
    expect(sha(readFileSync((await txt.path())!))).toBe(sha(EXPORT_KELLY));

    const dlZip = page.waitForEvent("download");
    await page.getByTestId("telecharger-zip").click();
    const zip = await dlZip;
    expect(zip.suggestedFilename()).toBe("WhatsApp Chat - Yanis.zip");
    const contenu = unzipSync(new Uint8Array(readFileSync((await zip.path())!)));
    expect(Object.keys(contenu)).toEqual(["_chat.txt"]);
    expect(sha(strFromU8(contenu["_chat.txt"]!))).toBe(sha(EXPORT_KELLY));

    const dlPng = page.waitForEvent("download");
    await page.getByTestId("telecharger-png").click();
    const png = readFileSync((await (await dlPng).path())!);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1170, 2532]);

    // Option A (défaut) : la même conv finit aujourd'hui.
    await page.getByRole("button", { name: "Finir aujourd'hui" }).click();
    await page.getByTestId("scenario-tester").click();
    await expect(page.getByTestId("scenario-resultat")).toContainText("Dates glissées");
    const dlAuj = page.waitForEvent("download");
    await page.getByTestId("telecharger-txt").click();
    const auj = readFileSync((await (await dlAuj).path())!, "utf8");
    const [a, m, j] = parisDayKey(Date.now()).split("-");
    expect(auj.trimEnd().split("\n").slice(-1)[0]).toBe(`[${j}/${m}/${a} 22:33:05] Kelly: t'as raison pardon`);

  });
});
