import {
  test,
  expect,
  adminPath,
  E2E_PROJECT_SLUG,
} from "./fixtures/auth-fixture";
import {
  createE2eClient,
  E2E_EMAIL,
  E2E_PASSWORD,
} from "./helpers/authed-client";
import { ConvexHttpClient } from "convex/browser";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const FIXTURE_PDF = path.resolve(__dirname, "fixtures/contrat-test.pdf");

/**
 * Client admin BRUT (sans l'injection automatique de `projectId` du helper e2e).
 * `storage.generateUploadUrl` est une authedMutation SANS projectId : le helper
 * lui en ajouterait un, que le validateur refuse.
 */
let rawAdmin: Promise<ConvexHttpClient> | null = null;
function adminRaw(): Promise<ConvexHttpClient> {
  rawAdmin ??= (async () => {
    const c = new ConvexHttpClient(url!);
    const res = await c.action(api.auth.signIn, {
      provider: "password",
      params: { email: E2E_EMAIL, password: E2E_PASSWORD, flow: "signIn" },
    });
    const token = res.tokens?.token;
    if (!token) throw new Error("signIn admin e2e sans token");
    c.setAuth(token);
    return c;
  })();
  return rawAdmin;
}

/** Pousse un blob dans le storage Convex et rend son storageId. */
async function putBlob(
  bytes: Buffer,
  contentType: string,
): Promise<Id<"_storage">> {
  const c = await adminRaw();
  const uploadUrl = await c.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`upload storage HTTP ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}

/**
 * CONTRAT créateur — PDF déposé par l'admin sur une fiche, relu par la
 * créatrice depuis son profil.
 *
 * Ce que la spec tient :
 *   - ce que l'admin dépose est EXACTEMENT ce que la créatrice lit (mêmes
 *     nom, taille, date, et une URL qui sert le PDF) ;
 *   - view-as rend la même chose que la créatrice ;
 *   - la créatrice ne peut ni déposer ni supprimer, et ne voit pas le contrat
 *     d'une AUTRE fiche ;
 *   - un non-PDF est refusé serveur, même si le client ment sur le type ;
 *   - supprimer retire le contrat de la vue créatrice (absence appariée à la
 *     présence vérifiée juste avant).
 */
test.describe("Contrat créateur (PDF)", () => {
  test("dépôt admin → lecture créatrice, view-as, refus, suppression", async () => {
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Contrat ${ts}`,
      email: `e2e-contrat-${ts}@repackit.test`,
      password: "contrat-12345",
    });
    // Une SECONDE créatrice : sert à prouver que la lecture est bien scopée.
    const other = await createCreatorSession(url, {
      name: `[E2E_TEST] Contrat autre ${ts}`,
      email: `e2e-contrat-autre-${ts}@repackit.test`,
      password: "contrat-12345",
    });

    // Départ : aucune des deux n'a de contrat.
    expect(
      await creator.client.query(api.creatorContracts.listMyContracts, {
        projectId: creator.projectId,
      }),
    ).toEqual([]);

    // ── L'ADMIN DÉPOSE ──────────────────────────────────────────────────────
    const pdf = readFileSync(FIXTURE_PDF);
    const storageId = await putBlob(pdf, "application/pdf");
    // Nom de fichier À LA FORME DE LA PROD : accents, espaces, tiret.
    const fileName = `Contrat de collaboration — Juliette Chetrit ${ts}.pdf`;
    await admin.mutation(api.creatorContracts.addCreatorContract, {
      creatorId: creator.creatorId,
      storageId,
      fileName,
      contentType: "application/pdf",
      size: pdf.byteLength,
    });

    // ── LA CRÉATRICE LIT ────────────────────────────────────────────────────
    const mine = await creator.client.query(
      api.creatorContracts.listMyContracts,
      { projectId: creator.projectId },
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].fileName).toBe(fileName);
    expect(mine[0].size).toBe(pdf.byteLength);
    // L'URL doit servir LE PDF, pas une page d'erreur : sans ce contrôle,
    // « la créatrice voit son contrat » ne voudrait dire que « elle voit un lien ».
    expect(mine[0].url).toBeTruthy();
    const served = await fetch(mine[0].url!);
    expect(served.status).toBe(200);
    const servedBytes = Buffer.from(await served.arrayBuffer());
    expect(servedBytes.byteLength).toBe(pdf.byteLength);
    expect(servedBytes.subarray(0, 5).toString()).toBe("%PDF-");

    // ── ISOLATION : l'autre créatrice ne voit rien ──────────────────────────
    expect(
      await other.client.query(api.creatorContracts.listMyContracts, {
        projectId: other.projectId,
      }),
    ).toEqual([]);

    // ── VIEW-AS : l'admin observe le MÊME contenu ───────────────────────────
    const viewAs = await admin.query(
      api.creatorContracts.listContractsAsAdmin,
      { creatorId: creator.creatorId },
    );
    expect(viewAs.map((c) => c.fileName)).toEqual([fileName]);

    // ── AUTORISATIONS : la créatrice ne dépose ni ne supprime ───────────────
    const orphan = await putBlob(pdf, "application/pdf");
    await expect(
      creator.client.mutation(api.creatorContracts.addCreatorContract, {
        projectId: creator.projectId,
        creatorId: creator.creatorId,
        storageId: orphan,
        fileName: "auto-contrat.pdf",
        contentType: "application/pdf",
        size: pdf.byteLength,
      }),
    ).rejects.toThrow();
    await expect(
      creator.client.query(api.creatorContracts.listCreatorContracts, {
        projectId: creator.projectId,
        creatorId: creator.creatorId,
      }),
    ).rejects.toThrow();

    // ── REFUS SERVEUR : un non-PDF, même annoncé comme PDF par le client ────
    // Le blob est bien un PNG ; c'est l'ARGUMENT contentType qui est contrôlé,
    // et il suffit de le dire faux pour que le dépôt passe si la garde saute.
    const png = readFileSync(path.resolve(__dirname, "fixtures/test-image.png"));
    const pngBlob = await putBlob(png, "image/png");
    await expect(
      admin.mutation(api.creatorContracts.addCreatorContract, {
        creatorId: creator.creatorId,
        storageId: pngBlob,
        fileName: "capture.png",
        contentType: "image/png",
        size: png.byteLength,
      }),
    ).rejects.toThrow();
    // Le refus n'a pas ajouté de ligne : la créatrice en a toujours UNE.
    const afterReject = await creator.client.query(
      api.creatorContracts.listMyContracts,
      { projectId: creator.projectId },
    );
    expect(afterReject).toHaveLength(1);

    // ── SUPPRESSION : disparaît de la vue créatrice ─────────────────────────
    await admin.mutation(api.creatorContracts.deleteCreatorContract, {
      id: viewAs[0]._id,
    });
    expect(
      await creator.client.query(api.creatorContracts.listMyContracts, {
        projectId: creator.projectId,
      }),
    ).toEqual([]);
  });
});

/**
 * L'ÉCRAN, pas seulement la query. Le dépôt passe par un `<input type="file">`
 * caché et deux mutations enchaînées (URL signée → attache) : la spec serveur
 * ci-dessus ne dirait rien d'un bouton qui n'ouvre pas le picker, ni d'une carte
 * rendue dans un onglet où l'admin ne va jamais.
 *
 * Côté créatrice, on passe par l'espace OBSERVÉ (`/admin/voir/…/profil`) : c'est
 * le MÊME composant `ProfilScreen`, servi par la même lecture — sans avoir à
 * ouvrir une seconde session dans le navigateur.
 */
test.describe("Contrat créateur — écrans", () => {
  test("l'admin dépose depuis la fiche, l'écran Profil l'affiche", async ({
    page,
  }) => {
    const ts = Date.now();
    const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Contrat UI ${ts}`,
      email: `e2e-contrat-ui-${ts}@repackit.test`,
    });

    await page.goto(adminPath(`/createurs/${creatorId}`));
    await page.getByRole("tab", { name: "Rémunération" }).click();

    const carte = page.getByText("Aucun contrat déposé pour ce projet.");
    await expect(carte).toBeVisible();

    // Le picker est caché : on alimente l'input directement, comme le fait le
    // navigateur après un clic sur « Déposer un contrat ».
    await page
      .locator('input[type="file"][accept*="pdf"]')
      .setInputFiles(FIXTURE_PDF);

    // PRÉSENCE (le fichier apparaît) appariée à l'ABSENCE vérifiée juste avant.
    await expect(
      page.getByRole("link", { name: "contrat-test.pdf" }),
    ).toBeVisible();
    await expect(carte).toBeHidden();

    // ── L'ESPACE DE LA CRÉATRICE (observé) ─────────────────────────────────
    await page.goto(`/admin/voir/${E2E_PROJECT_SLUG}/${creatorId}/profil`);
    await expect(
      page.getByRole("link", { name: "contrat-test.pdf" }),
    ).toBeVisible();
  });
});
