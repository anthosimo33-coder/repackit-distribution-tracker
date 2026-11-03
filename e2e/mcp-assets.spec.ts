import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { createE2eClient, E2E_EMAIL, E2E_PASSWORD, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { minuitParisDecale } from "./helpers/paris-day";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { readFileSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

/**
 * OUTILS MCP `assets` (lecture) et `lier_assets` (domaine « missions »).
 *
 * Ce que la spec tient :
 *  1. `assets` liste les dossiers : nombre de fichiers, statut « À publier »,
 *     et pour chaque vidéo sa durée LUE DANS LE FICHIER (un vrai MP4 dont la
 *     boîte moov est après les données, un vrai MOV) et sa taille ; la durée
 *     lue est gardée sur le fichier ;
 *  2. `lier_assets` désigne la mission comme les autres outils : deux missions
 *     le même jour → refus qui les cite (avec leurs dossiers déjà liés) ;
 *  3. la créatrice voit le dossier dans SA mission et télécharge le fichier ;
 *  4. une liste est TOUT OU RIEN : une ligne refusée (mission publiée, dossier
 *     ambigu) et aucune autre n'est écrite ;
 *  5. `defaire` remet les dossiers d'avant — et refuse si l'écran les a changés.
 *
 * Données à la forme de la prod : nom complet, handle suffixé, jours ≠
 * aujourd'hui, noms de dossiers de l'équipe (« Kelly 2006 »), fichiers réels.
 */

type Rpc = { result?: { tools?: { name: string; annotations?: Record<string, unknown> }[]; content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/** Client authentifié SANS projectId injecté : generateUploadUrl ne le prend pas. */
async function clientBrut(): Promise<ConvexHttpClient> {
  const raw = new ConvexHttpClient(convexUrl!);
  const signin = await raw.action(api.auth.signIn, {
    provider: "password",
    params: { email: E2E_EMAIL, password: E2E_PASSWORD, flow: "signIn" },
  });
  const token = signin.tokens?.token;
  if (!token) throw new Error("signIn e2e sans token");
  raw.setAuth(token);
  return raw;
}

async function envoyer(raw: ConvexHttpClient, octets: Uint8Array<ArrayBuffer>, contentType: string): Promise<Id<"_storage">> {
  const uploadUrl = await raw.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body: octets });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

const fixture = (nom: string) => new Uint8Array(readFileSync(join(process.cwd(), "e2e/fixtures", nom)));
const PNG_1x1 = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
);
const jourParis = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

test.describe("MCP — assets et lier_assets", () => {
  test("lire les dossiers, lier (désignation, tout ou rien), la créatrice télécharge, défaire", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const lorenaNom = `Lorena Duarte ${ts}`;
    const lorena = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] ${lorenaNom}`,
      email: `e2e-mcp-assets-${ts}@repackit.test`,
      password: "lorena-12345",
    });
    const handle = `@lorena.duarte.fr${ts}`;
    const cible = await availableTarget({ e2eClient: admin, creatorId: lorena.creatorId, platform: "TikTok", handle });

    // ── Deux campagnes, deux missions LE MÊME JOUR, une troisième publiée ─────
    const campagne = async (nom: string) => {
      const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${nom}` })) as Id<"scriptCampaigns">;
      for (const [kind, label, content] of [
        ["hook", "Hook 2006", `En 2006 j'avais un Sidekick et un MSN ${nom}`],
        ["hook", "Hook ex", `Mon ex m'a écrit à 3 h du matin ${nom}`],
        ["flux", "Flux appli", "J'ai mis la conv dans l'appli et le verdict est tombé."],
        ["cta", "CTA bio", "Le lien est dans ma bio."],
      ] as const) {
        await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
      }
      return campaignId;
    };
    const collage = `Collage ${ts}`;
    const muet = `Réaction muette ${ts}`;
    const idCollage = await campagne(collage);
    const idMuet = await campagne(muet);
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème assets ${ts}`,
      montantFixe: 120,
      nbVideosCible: 12,
      tauxCPM: 1.5,
    });
    const J3 = minuitParisDecale(3);
    const J5 = minuitParisDecale(5);
    const assigner = (campaignId: Id<"scriptCampaigns">, postDate: number) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: lorena.creatorId,
        targets: [cible],
        videosPerCreator: 1,
        dueDate: postDate + DAY,
        pricingId,
        postDates: [postDate],
      });
    await assigner(idCollage, J3);
    await assigner(idMuet, J3);
    await assigner(idMuet, J5);
    const missions = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter((a) => a.creatorId === lorena.creatorId);
    const mission = async (nom: string, jour: number) =>
      (await missions()).find((a) => a.scriptCampaignName === `[E2E_TEST] ${nom}` && a.postDate === jour)!;
    const mCollage = await mission(collage, J3);
    const mMuet = await mission(muet, J3);
    const mPubliee = await mission(muet, J5);
    expect(mCollage && mMuet && mPubliee).toBeTruthy();
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id: mPubliee._id, status: "to_publish" });
    await lorena.client.mutation(api.assignments.confirmPublication, {
      projectId: lorena.projectId,
      id: mPubliee._id,
      urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/7${ts}` }],
    });

    // ── Trois dossiers, aux noms de l'équipe, avec de VRAIS fichiers ──────────
    const raw = await clientBrut();
    const dossier = async (nom: string, aPublier: boolean, fichiers: [string, Uint8Array<ArrayBuffer>, string][]) => {
      const folderId = (await admin.mutation(api.assets.createAssetFolder, {
        name: `[E2E_TEST] ${nom}`,
        postprocessImages: aPublier,
      })) as Id<"assetFolders">;
      for (const [fileName, octets, contentType] of fichiers) {
        await admin.mutation(api.assets.createAsset, {
          folderId,
          storageId: await envoyer(raw, octets, contentType),
          fileName,
          contentType,
          size: octets.length,
        });
      }
      return folderId;
    };
    const mp4 = fixture("video-7s4.mp4"); // moov APRÈS les données
    const kelly2006 = `Kelly 2006 ${ts}`;
    const kelly3ans = `Kelly 3 ans ensemble ${ts}`;
    const screens = `Screen Notification FR ${ts}`;
    const fKelly2006 = await dossier(kelly2006, true, [["Kelly 2006.mp4", mp4, "video/mp4"]]);
    const fKelly3ans = await dossier(kelly3ans, true, [["Kelly 3 ans ensmble.mov", fixture("video-7s4.mov"), "video/quicktime"]]);
    const fScreens = await dossier(screens, false, [
      ["notif-1.png", PNG_1x1, "image/png"],
      ["notif-2.png", PNG_1x1, "image/png"],
    ]);

    // ── Une clé, depuis l'écran ───────────────────────────────────────────────
    const nomCle = `E2E assets ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const noms = async () => ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
    const dossiersDe = async (id: Id<"assignments">) => (await missions()).find((a) => a._id === id)!.linkedFolderIds;

    // Lecture seule : `assets` oui, `lier_assets` non (ni listé, ni appelable).
    expect(await noms()).toContain("assets");
    expect(await noms()).not.toContain("lier_assets");
    const ferme = await appel("lier_assets", { createatrice: lorenaNom, jour: jourParis(J3), campagne: collage, dossier: kelly2006 });
    expect(ferme.erreur).toBe(true);
    expect(await dossiersDe(mCollage._id)).toEqual([]);

    // ── 1. `assets` : fichiers, statut, durée et taille des vidéos ────────────
    const liste = await appel("assets", {});
    expect(liste.erreur, liste.texte).toBe(false);
    type Ligne = { nom: string; fichiers: number; aPublier: boolean; images?: number; videos?: { fichier: string; dureeSec: number | null; taille: string }[]; missionsLiees?: number };
    const lignes = JSON.parse(liste.texte).dossiers as Ligne[];
    const ligne = (nom: string) => lignes.find((l) => l.nom === `[E2E_TEST] ${nom}`)!;
    expect(ligne(kelly2006)).toMatchObject({ fichiers: 1, aPublier: true, missionsLiees: 0 });
    expect(ligne(kelly2006).videos).toEqual([{ fichier: "Kelly 2006.mp4", dureeSec: 7.4, taille: `${Math.round(mp4.length / 1024)} Ko` }]);
    expect(ligne(kelly3ans).videos![0].dureeSec).toBe(7.4);
    expect(ligne(screens)).toMatchObject({ fichiers: 2, aPublier: false, images: 2, missionsLiees: 0 });
    expect(ligne(screens).videos).toBeUndefined();
    // La durée lue est gardée sur le fichier (la prochaine lecture ne relit pas l'en-tête).
    const [video] = await admin.query(api.assets.listAssets, { folderId: fKelly2006 });
    expect(video.durationSec).toBeCloseTo(7.4, 2);

    // Domaine « missions » ouvert : l'outil apparaît, annoté écriture.
    const interrupteur = page.getByRole("switch", { name: `Modifications des missions pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    const outil = (await rpc(url, token, "tools/list")).result!.tools!.find((t) => t.name === "lier_assets");
    expect(outil?.annotations).toMatchObject({ readOnlyHint: false });

    // ── 2. Désignation : deux missions ce jour-là → refus qui les cite ────────
    const ambigu = await appel("lier_assets", { createatrice: lorenaNom, jour: jourParis(J3), dossier: kelly2006 });
    expect(ambigu.erreur).toBe(true);
    expect(ambigu.texte).toContain("Plusieurs missions");
    expect(ambigu.texte).toContain(collage);
    expect(ambigu.texte).toContain(muet);
    expect(await dossiersDe(mCollage._id)).toEqual([]);
    expect(await dossiersDe(mMuet._id)).toEqual([]);

    // Un dossier ambigu (« Kelly » : deux dossiers) → refus qui les cite.
    const dossierAmbigu = await appel("lier_assets", { createatrice: lorenaNom, jour: jourParis(J3), campagne: collage, dossier: `Kelly` });
    expect(dossierAmbigu.erreur).toBe(true);
    expect(dossierAmbigu.texte).toContain("désigne plusieurs dossiers d'Assets");
    expect(dossierAmbigu.texte).toContain(kelly2006);
    expect(dossierAmbigu.texte).toContain(kelly3ans);

    // Départagée par la campagne, dossier par un MORCEAU de son nom : écrit.
    const lie = await appel("lier_assets", { createatrice: lorenaNom, jour: jourParis(J3), campagne: collage, dossier: `2006 ${ts}` });
    expect(lie.erreur, lie.texte).toBe(false);
    expect(JSON.parse(lie.texte).fait).toEqual([expect.stringContaining(`« [E2E_TEST] ${kelly2006} » lié`)]);
    expect(await dossiersDe(mCollage._id)).toEqual([fKelly2006]);
    expect(await dossiersDe(mMuet._id)).toEqual([]);

    // Le dossier lié se voit : dans le refus (sur la bonne mission seulement) et dans `planning`.
    const reAmbigu = (await appel("lier_assets", { createatrice: lorenaNom, jour: jourParis(J3), dossier: screens })).texte;
    const parMission = reAmbigu.split(" ; ");
    expect(parMission.find((m) => m.includes(collage))).toContain(`dossier « [E2E_TEST] ${kelly2006} »`);
    expect(parMission.find((m) => m.includes(muet))).not.toContain("dossier «");
    const planning = JSON.parse((await appel("planning", { createatrice: lorenaNom, jours: 10 })).texte);
    const aVenir = planning.aVenir.posts as { quoi: string; dossiersAssets?: string[] }[];
    expect(aVenir.find((p) => p.quoi === `[E2E_TEST] ${collage}`)?.dossiersAssets).toEqual([`[E2E_TEST] ${kelly2006}`]);
    expect(aVenir.find((p) => p.quoi === `[E2E_TEST] ${muet}`)?.dossiersAssets).toBeUndefined();

    // `assets` avec « dossier » : ses fichiers et la mission liée.
    const detail = JSON.parse((await appel("assets", { dossier: kelly2006 })).texte);
    expect(detail.fichiers).toEqual([
      expect.objectContaining({ nom: "Kelly 2006.mp4", type: "vidéo", dureeSec: 7.4 }),
    ]);
    expect(detail.missionsLiees).toEqual([
      expect.objectContaining({ createatrice: `[E2E_TEST] ${lorenaNom}`, jourPrevu: jourParis(J3), campagne: `[E2E_TEST] ${collage}`, statut: "à faire" }),
    ]);

    // ── 3. La créatrice voit le dossier dans SA mission, et télécharge ────────
    const sienne = await lorena.client.query(api.assignments.getMyAssignment, { projectId: lorena.projectId, id: mCollage._id });
    expect(sienne!.assets!.folders.map((f) => f.name)).toEqual([`[E2E_TEST] ${kelly2006}`]);
    const item = sienne!.assets!.folders[0].items[0];
    expect(item.fileName).toBe("Kelly 2006.mp4");
    const telecharge = await fetch(item.url!);
    expect(telecharge.status).toBe(200);
    expect(Buffer.from(await telecharge.arrayBuffer()).equals(Buffer.from(mp4))).toBe(true);
    // Son autre mission du jour n'a rien reçu.
    const autre = await lorena.client.query(api.assignments.getMyAssignment, { projectId: lorena.projectId, id: mMuet._id });
    expect(autre!.assets).toBeNull();

    // ── 4. Tout ou rien : la ligne 3 vise une mission publiée → rien d'écrit ──
    const refusLot = await appel("lier_assets", {
      liens: [
        { createatrice: lorenaNom, jour: jourParis(J3), campagne: muet, dossier: screens },
        { createatrice: lorenaNom, jour: jourParis(J3), campagne: collage, dossier: kelly3ans },
        { createatrice: lorenaNom, jour: jourParis(J5), dossier: kelly2006 },
      ],
    });
    expect(refusLot.erreur).toBe(true);
    expect(refusLot.texte).toContain("Ligne 3");
    expect(refusLot.texte).toContain("déjà publiée");
    expect(refusLot.texte).toContain("Rien n'a été écrit");
    expect(await dossiersDe(mMuet._id)).toEqual([]);
    expect(await dossiersDe(mCollage._id)).toEqual([fKelly2006]);
    expect(await dossiersDe(mPubliee._id)).toEqual([]);

    // Le même lot sans la ligne refusée, plus un REMPLACEMENT (dossier "" puis un autre).
    const lot = await appel("lier_assets", {
      liens: [
        { createatrice: lorenaNom, jour: jourParis(J3), campagne: muet, dossier: screens },
        { createatrice: lorenaNom, jour: jourParis(J3), campagne: collage, dossier: "" },
        { createatrice: lorenaNom, jour: jourParis(J3), campagne: collage, dossier: `3 ans ensemble ${ts}` },
      ],
    });
    expect(lot.erreur, lot.texte).toBe(false);
    expect(JSON.parse(lot.texte).fait).toHaveLength(3);
    expect(await dossiersDe(mMuet._id)).toEqual([fScreens]);
    expect(await dossiersDe(mCollage._id)).toEqual([fKelly3ans]);

    // ── 5. defaire : le lot entier revient ; refus si l'écran a changé depuis ─
    const journal = async () =>
      JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; fait: string; etat: string }[];
    const defaire = async (morceau: string) => {
      const l = (await journal()).find((m) => m.outil === "lier_assets" && m.fait.includes(morceau) && m.etat === "se défait");
      expect(l, `aucune modification lier_assets défaisable contenant « ${morceau} »`).toBeDefined();
      return appel("defaire", { rang: l!.rang, outil: "lier_assets" });
    };
    const defaitLot = await defaire(screens);
    expect(defaitLot.erreur, defaitLot.texte).toBe(false);
    expect(await dossiersDe(mMuet._id)).toEqual([]);
    expect(await dossiersDe(mCollage._id)).toEqual([fKelly2006]);

    // L'écran rajoute un dossier : défaire le premier lien n'écrase rien.
    await admin.mutation(api.assignments.setAssetFolders, { id: mCollage._id, folderIds: [fKelly2006, fScreens] });
    const refusDefaire = await defaire(`+ « [E2E_TEST] ${kelly2006} »`);
    expect(refusDefaire.erreur).toBe(true);
    expect(refusDefaire.texte).toContain("rien n'a été écrasé");
    expect(await dossiersDe(mCollage._id)).toEqual([fKelly2006, fScreens]);
    // Remis comme Claude l'avait laissé : défaire passe, la mission n'a plus de dossier.
    await admin.mutation(api.assignments.setAssetFolders, { id: mCollage._id, folderIds: [fKelly2006] });
    const defaitLien = await defaire(`+ « [E2E_TEST] ${kelly2006} »`);
    expect(defaitLien.erreur, defaitLien.texte).toBe(false);
    expect(await dossiersDe(mCollage._id)).toEqual([]);
    const plusRien = await lorena.client.query(api.assignments.getMyAssignment, { projectId: lorena.projectId, id: mCollage._id });
    expect(plusRien!.assets).toBeNull();
  });
});
