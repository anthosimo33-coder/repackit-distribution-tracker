import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * ESPACE TALENT — dépôt de rushes, brief permanent, cycle de vie.
 *
 * Sessions RÉELLES obtenues par le signUp du flow d'invitation (le chemin de la
 * personne réelle), comme e2e/talent-clipper-role-guard.spec.ts. Ce qui est
 * prouvé ici tient en quatre points :
 *
 *  1. le cloisonnement — un talent ne voit que SES dépôts ;
 *  2. l'anti-fuite du brief — un `formats` porte des textes de SCRIPT et une
 *     grille de PAIE, et ni l'un ni l'autre n'atteint le talent ;
 *  3. `creators.firstPostAt` n'est JAMAIS posé sur une fiche de talent — acquis
 *     par construction (il ne passe pas par confirmPublicationCore), mais un
 *     acquis non testé est un acquis qu'on perd ;
 *  4. le cycle de vie — refus motivé et expiration à 60 jours, cette dernière
 *     prouvée avec un `now` INJECTÉ plutôt qu'en attendant deux mois.
 *
 * Nommage `[E2E_TEST]` + emails `e2e-creator-*` : ramassés par le cleanup
 * existant (creators.cleanupTestCreators, qui cascade sur les rushes).
 */

const JOUR = 24 * 60 * 60 * 1000;

/** Ouvre une session RÉELLE pour une population donnée, via /join → signUp. */
async function signUpAs(
  kind: "talent" | "clipper" | "partner",
  ts: number,
  password = `rush-${ts}`,
): Promise<{
  client: ConvexHttpClient;
  creatorId: Id<"creators">;
  email: string;
  password: string;
  token: string;
}> {
  const email = `e2e-creator-${kind}-${ts}@repackit.test`;
  const { creatorId, token } = await convex.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} ${ts}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  const sessionToken = res.tokens?.token;
  expect(sessionToken).toBeTruthy();
  client.setAuth(sessionToken!);
  return { client, creatorId, email, password, token };
}

/**
 * Ouvre le dépôt sur le projet e2e. Le gate d'origine était `slug === "snytch"` ;
 * le projet de test porte `e2e-test`, donc SANS ce réglage aucune de ces specs ne
 * pourrait exister — c'est la raison d'être du champ de projet.
 */
async function enableFileDrop() {
  await convex.mutation(api.projects.setTalentSettings, {
    fileDropEnabled: true,
  });
}

/** Dépose un rush (le binaire est déjà « sur Drive » — on confirme les métas). */
async function deposit(
  client: ConvexHttpClient,
  projectId: Id<"projects">,
  driveFileId: string,
  fileName = "hook-01.mov",
  sizeBytes = 31_457_280,
): Promise<Id<"rushes">> {
  const res = await client.mutation(api.rushes.confirmDeposit, {
    projectId,
    driveFileId,
    fileName,
    mimeType: "video/quicktime",
    sizeBytes,
  });
  return res.rushId;
}

test.describe("Espace talent — dépôt de rushes", () => {
  test("un talent dépose, relit SES rushes, et ne voit pas ceux d'un autre", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    await enableFileDrop();

    const alice = await signUpAs("talent", ts);
    const bob = await signUpAs("talent", ts + 1);

    await deposit(alice.client, projectId, `drive-alice-${ts}`, "alice-hook.mov");
    await deposit(bob.client, projectId, `drive-bob-${ts}`, "bob-hook.mov");

    const mineAlice = await alice.client.query(api.rushes.listMyRushes, {
      projectId,
    });
    const mineBob = await bob.client.query(api.rushes.listMyRushes, {
      projectId,
    });

    expect(mineAlice.map((r) => r.fileName)).toEqual(["alice-hook.mov"]);
    expect(mineBob.map((r) => r.fileName)).toEqual(["bob-hook.mov"]);
    expect(mineAlice[0].status).toBe("deposited");

    // L'allowlist tient : ni chemin vers le flux clip, ni référence Drive.
    const exposed = Object.keys(mineAlice[0]);
    for (const interdit of [
      "assignmentId",
      "assignedAt",
      "driveFileId",
      "webViewLink",
      "thumbnailLink",
      "talentId",
      "projectId",
      "binaryPurgedAt",
    ]) {
      expect(exposed).not.toContain(interdit);
    }
  });

  test("re-confirmer le MÊME fichier ne crée pas un second rush", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    await enableFileDrop();
    const talent = await signUpAs("talent", ts);

    const driveFileId = `drive-retry-${ts}`;
    const first = await deposit(talent.client, projectId, driveFileId);
    const second = await deposit(talent.client, projectId, driveFileId);

    // Un retry réseau du client ne doit pas produire deux lignes qui pointent le
    // même binaire.
    expect(second).toBe(first);
    const mine = await talent.client.query(api.rushes.listMyRushes, {
      projectId,
    });
    expect(mine).toHaveLength(1);
  });

  test("le brief permanent ne laisse passer ni script ni grille de paie", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    await enableFileDrop();

    const hookSecret = `HOOK-SECRET-${ts}`;
    const formatId = await convex.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Brief talent ${ts}`,
      type: "short",
      brief: `Filme en extérieur, lumière naturelle. Repère ${ts}.`,
      // Le format PORTE bien ce qui ne doit pas sortir — sinon le test ne prouve
      // rien : il faut que la fuite soit possible pour que son absence compte.
      hooks: [hookSecret, "Arrête de scroller"],
      guidelines: { do: ["cadrer serré"], dont: ["parler"] },
      rateModel: { basePerPost: 4242, viewBonusPer1k: 7 },
    });
    await convex.mutation(api.projects.setTalentSettings, {
      talentBriefFormatId: formatId,
    });

    const talent = await signUpAs("talent", ts);
    const brief = await talent.client.query(api.formats.getMyTalentBrief, {
      projectId,
    });

    expect(brief).not.toBeNull();
    expect(brief!.brief).toContain(`Repère ${ts}`);
    expect(Object.keys(brief!).sort()).toEqual(["brief", "exampleVideos"]);

    // Balayage du payload ENTIER : aucun texte de script, aucun montant.
    const payload = JSON.stringify(brief);
    expect(payload).not.toContain(hookSecret);
    expect(payload).not.toContain("Arrête de scroller");
    expect(payload).not.toContain("4242");
    expect(payload).not.toContain("rateModel");
    expect(payload).not.toContain("guidelines");
  });

  test("partenaire et clippeur sont rejetés de TOUTES les fonctions rush", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    await enableFileDrop();

    for (const kind of ["partner", "clipper"] as const) {
      const intrus = await signUpAs(kind, ts + (kind === "partner" ? 10 : 20));
      await expect(
        intrus.client.query(api.rushes.listMyRushes, { projectId }),
      ).rejects.toThrow(/talents/i);
      await expect(
        intrus.client.mutation(api.rushes.confirmDeposit, {
          projectId,
          driveFileId: `drive-intrus-${kind}-${ts}`,
          fileName: "intrus.mov",
          mimeType: "video/quicktime",
          sizeBytes: 1,
        }),
      ).rejects.toThrow(/talents/i);
      await expect(
        intrus.client.action(api.rushes.getDepositSession, {
          projectId,
          fileName: "intrus.mov",
          mimeType: "video/quicktime",
          sizeBytes: 1,
        }),
      ).rejects.toThrow(/talents/i);
      await expect(
        intrus.client.query(api.formats.getMyTalentBrief, { projectId }),
      ).rejects.toThrow(/talents/i);
    }

    // Le talent, lui, franchit la garde de rôle sur cette action : la seule chose
    // qui l'arrête ici est l'absence d'env Drive sur le déploiement de test.
    const talent = await signUpAs("talent", ts + 30);
    const session = await talent.client.action(api.rushes.getDepositSession, {
      projectId,
      fileName: "hook.mov",
      mimeType: "video/quicktime",
      sizeBytes: 1,
    });
    expect(session.ok).toBe(false);
    if (!session.ok) expect(session.reason).toBe("disabled");
  });

  test("creators.firstPostAt n'est JAMAIS posé sur une fiche de talent", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    await enableFileDrop();
    const talent = await signUpAs("talent", ts);

    // Cycle complet : dépôt → refus → expiration. Aucune de ces étapes ne doit
    // toucher l'ancre du cycle de paie créateur.
    const garde = await deposit(talent.client, projectId, `drive-garde-${ts}`);
    const rejete = await deposit(
      talent.client,
      projectId,
      `drive-garde-rej-${ts}`,
    );
    await convex.mutation(api.rushes.rejectRush, {
      rushId: rejete,
      reason: "Cadrage trop serré.",
    });
    await convex.mutation(api.rushes.e2eRunExpiration, {
      secret: E2E_SECRET,
      now: Date.now() + 61 * JOUR,
    });
    expect(garde).toBeTruthy();

    const fiche = await convex.query(api.creators.getCreator, {
      id: talent.creatorId,
    });
    expect(fiche).not.toBeNull();
    expect(fiche!.kind).toBe("talent");
    // L'ancre du cycle J+30 reste vide : le talent ne publie jamais.
    expect(fiche!.firstPostAt).toBeUndefined();

    // Et le seul chemin qui la poserait lui est fermé.
    await expect(
      talent.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id: "nope" as unknown as Id<"assignments">,
        urls: [{ platform: "TikTok", url: "https://www.tiktok.com/@x/video/1" }],
      }),
    ).rejects.toThrow();
  });

  test("refus : motif obligatoire, borné serveur, et lu par le talent", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    await enableFileDrop();
    const talent = await signUpAs("talent", ts);
    const rushId = await deposit(talent.client, projectId, `drive-refus-${ts}`);

    // Un refus sans explication est ce qui fait qu'on arrête de filmer.
    await expect(
      convex.mutation(api.rushes.rejectRush, { rushId, reason: "   " }),
    ).rejects.toThrow(/motif/i);

    // Borné SERVEUR, pas seulement dans le formulaire : ce texte franchit une
    // frontière de rôle. Trop long → refusé, jamais tronqué en silence.
    await expect(
      convex.mutation(api.rushes.rejectRush, {
        rushId,
        reason: "x".repeat(501),
      }),
    ).rejects.toThrow(/500/);

    const motif = "Cadrage trop serré, on ne voit pas le produit.";
    await convex.mutation(api.rushes.rejectRush, { rushId, reason: motif });

    const mine = await talent.client.query(api.rushes.listMyRushes, {
      projectId,
    });
    expect(mine[0].status).toBe("rejected");
    expect(mine[0].rejectionReason).toBe(motif);
    expect(mine[0].rejectedAt).toBeTruthy();

    // Un rush déjà traité n'est plus refusable (son binaire est parti).
    await expect(
      convex.mutation(api.rushes.rejectRush, { rushId, reason: "bis" }),
    ).rejects.toThrow(/plus refusable/i);
  });

  test("expiration : 61 jours bascule, 59 non, et rejouer ne change rien", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    const secret = E2E_SECRET;
    await enableFileDrop();
    const talent = await signUpAs("talent", ts);

    const rushId = await deposit(talent.client, projectId, `drive-exp-${ts}`);
    const depositedAt = (
      await talent.client.query(api.rushes.listMyRushes, { projectId })
    )[0].depositedAt;

    // À 59 jours, rien ne bouge.
    await convex.mutation(api.rushes.e2eRunExpiration, {
      secret,
      now: depositedAt + 59 * JOUR,
    });
    let mine = await talent.client.query(api.rushes.listMyRushes, { projectId });
    expect(mine.find((r) => r._id === rushId)!.status).toBe("deposited");

    // À 61 jours, le rush périme.
    const first = await convex.mutation(api.rushes.e2eRunExpiration, {
      secret,
      now: depositedAt + 61 * JOUR,
    });
    expect(first.expired).toBeGreaterThanOrEqual(1);
    mine = await talent.client.query(api.rushes.listMyRushes, { projectId });
    const expired = mine.find((r) => r._id === rushId)!;
    expect(expired.status).toBe("expired");
    expect(expired.expiredAt).toBeTruthy();

    // Idempotent : un second passage ne repasse pas sur ce qui est déjà expiré.
    const second = await convex.mutation(api.rushes.e2eRunExpiration, {
      secret,
      now: depositedAt + 61 * JOUR,
    });
    expect(second.expired).toBe(0);
  });

  test("l'écran talent affiche brief, dépôt et statut — et aucun script", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    await enableFileDrop();

    const hookSecret = `HOOK-SECRET-${ts}`;
    const formatId = await convex.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Brief écran ${ts}`,
      type: "short",
      brief: `Filme dehors, plan serré. Repère ${ts}.`,
      hooks: [hookSecret],
      rateModel: { basePerPost: 4242 },
    });
    await convex.mutation(api.projects.setTalentSettings, {
      talentBriefFormatId: formatId,
    });

    // Invitation SANS la consommer : le token est à usage unique, et c'est le
    // NAVIGATEUR qui doit le consommer ici — c'est le chemin réel de la personne.
    // (Un signUp serveur préalable rendrait le lien invalide au moment du goto.)
    const email = `e2e-creator-talent-ui-${ts}@repackit.test`;
    const password = `rush-ui-${ts}`;
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] talent ui ${ts}`,
      email,
      kind: "talent",
    });

    // Onboarding réel en navigation privée, sur un viewport de téléphone : c'est
    // le seul appareil sur lequel cet écran sera ouvert.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();

    // La matrice de redirection par rôle mène au portail talent, pas à /app.
    await page.waitForURL("**/talent", { timeout: 20_000 });

    // Le compte existe maintenant : on ouvre une session SERVEUR distincte (flow
    // "signIn", pas de refresh token partagé avec le navigateur) pour semer un
    // dépôt, puis on recharge.
    const talentClient = new ConvexHttpClient(convexUrl!);
    const signed = await talentClient.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signIn" },
    });
    talentClient.setAuth(signed.tokens!.token);
    await deposit(talentClient, projectId, `drive-ui-${ts}`, "ma-prise.mov");
    await page.reload();

    await expect(page.getByText(`Repère ${ts}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /choisir mes vidéos/i })).toBeVisible();
    await expect(page.getByText("ma-prise.mov")).toBeVisible();
    await expect(page.getByText("Déposé", { exact: true })).toBeVisible();

    // Ce que l'écran ne montre PAS : le texte de script du format, le montant de
    // la grille partenaire, et le vocabulaire système.
    await expect(page.getByText(hookSecret)).toHaveCount(0);
    await expect(page.getByText("4242")).toHaveCount(0);
    await expect(page.getByText(/retenu|assigné/i)).toHaveCount(0);

    await ctx.close();
  });
});
