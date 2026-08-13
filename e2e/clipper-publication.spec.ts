import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { formatUtcDayFr, utcDayKey } from "../convex/accountPhase";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * PUBLICATION D'UN CLIP — les quatre points du chantier, bout en bout.
 *
 *  1. la date est VISIBLE et modifiable dans le formulaire ;
 *  2. elle est PRÉ-REMPLIE depuis le lien, et l'écran le DIT ;
 *  3. le compteur suit la DATE CHOISIE, pas « aujourd'hui » ;
 *  4. le refus serveur NOMME la date concernée.
 *
 * L'identifiant TikTok utilisé est RÉEL (relevé en prod, décodé contre son
 * datePubli) : un id fabriqué en décalant un timestamp testerait le décodeur
 * contre lui-même.
 *
 * ⚠️ L'ONBOARDING (signUp) doit précéder `assignFormat` — la mutation exige une
 * fiche rattachée à un compte, ce qui est aussi la situation réelle : un
 * clippeur à qui on assigne un clip a forcément accepté son invitation. Les
 * tests navigateur passent donc par /join AVANT de semer le clip.
 */

const JOUR = 86_400_000;

/**
 * Post réel du 2026-08-11 à 18h58 UTC. Le scénario en un identifiant : publié la
 * veille au soir, déclaré le lendemain matin.
 */
const ID_VEILLE = "7672850383298956577";
const JOUR_DU_POST = Date.UTC(2026, 7, 11, 18, 58, 13);

async function inviterClippeur(ts: number, quoi: string) {
  const email = `e2e-creator-clipper-${quoi}-${ts}@repackit.test`;
  const password = `clip-${quoi}-${ts}`;
  const { creatorId, token } = await convex.mutation(
    api.creators.inviteCreator,
    { name: `[E2E_TEST] clippeur ${quoi} ${ts}`, email, kind: "clipper" },
  );
  return { creatorId, token, email, password };
}

/**
 * Sème `count` clips PRÊTS À PUBLIER sur un compte en croisière (2 posts/jour).
 * `createdAt` ANTIDATÉ : le serveur borne la date déclarée à [createdAt, now],
 * et sans ça la fenêtre ferait quelques millisecondes — impossible de prouver
 * quoi que ce soit sur une date antérieure.
 */
async function clipsPretsAPublier(opts: {
  creatorId: Id<"creators">;
  ts: number;
  quoi: string;
  count?: number;
  /** Ancienneté de l'ancre de phase, en jours. Défaut : bien après J14. */
  ancreJours?: number;
}): Promise<{ handle: string; ids: Id<"assignments">[] }> {
  const { creatorId, ts, quoi } = opts;
  const count = opts.count ?? 1;
  const handle = `@e2eclip${quoi}${ts}`;
  // ⚠️ 20 jours, pas 13. La phase est évaluée à la DATE DÉCLARÉE : avec une
  // ancre à J14 pile, un post daté d'HIER retombe en J13 — phase démo, quota 1 —
  // et le deuxième post d'hier serait refusé pour une raison qui n'a rien à voir
  // avec ce qu'on teste. Le piège a été rencontré en écrivant cette spec.
  const target = await availableTarget({
    e2eClient: convex,
    creatorId,
    platform: "TikTok",
    handle,
    validatedAt: ts - (opts.ancreJours ?? 20) * JOUR,
  });
  const formatId = await convex.mutation(api.formats.createFormat, {
    name: `[E2E_TEST] Clip ${quoi} ${ts}`,
    type: "short",
    rateModel: { basePerPost: 0 },
  });
  await convex.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId,
    targets: [target],
    postsPerCreator: count,
    dueDate: ts + 7 * JOUR,
  });
  const ids = (await convex.query(api.assignments.listAssignments, {}))
    .filter((a) => a.formatId === formatId && a.creatorId === creatorId)
    .map((a) => a._id);
  expect(ids).toHaveLength(count);
  for (const id of ids) {
    await convex.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id,
      status: "to_publish",
      createdAt: ts - 25 * JOUR,
    });
  }
  return { handle, ids };
}

/** Session CLIPPEUR réelle (signUp par jeton d'invitation). */
async function sessionClippeur(email: string, password: string, token: string) {
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  const sessionToken = res.tokens?.token;
  expect(sessionToken).toBeTruthy();
  client.setAuth(sessionToken!);
  return client;
}

test.describe("Publication d'un clip — la date", () => {
  test("le lien pré-remplit la date, l'écran le dit, et le compteur suit", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { creatorId, token, password } = await inviterClippeur(ts, "date");

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/clip", { timeout: 20_000 });

    // Le clip est semé APRÈS l'onboarding (cf en-tête).
    const { handle, ids } = await clipsPretsAPublier({
      creatorId,
      ts,
      quoi: "date",
    });
    await page.goto(`/clip/clips/${ids[0]}`);

    const champDate = page.getByLabel(/date de sortie du post/i);
    // (1) La date est VISIBLE dès l'ouverture — pas derrière un « avancé ».
    await expect(champDate).toBeVisible({ timeout: 20_000 });
    // Par défaut : aujourd'hui, en journée UTC (le repère du quota).
    const aujourdhui = utcDayKey(Date.now());
    await expect(champDate).toHaveValue(aujourdhui);

    // (3) Le compteur parle du jour affiché.
    await expect(page.getByText(/0 publication sur 2 ce jour-là/i)).toBeVisible();

    // (2) On colle un lien RÉEL du 11 août au soir → la date recule, et l'écran
    // annonce d'où elle vient. Sans ça, le clippeur validerait « aujourd'hui »
    // et saturerait le quota du mauvais jour sans le savoir.
    await page
      .getByLabel(/lien du post TikTok/i)
      .fill(`https://www.tiktok.com/${handle}/video/${ID_VEILLE}`);
    await expect(champDate).toHaveValue(utcDayKey(JOUR_DU_POST));
    await expect(
      page.getByText(
        new RegExp(
          `date lue dans le lien\\s*:\\s*${formatUtcDayFr(JOUR_DU_POST)}`,
          "i",
        ),
      ),
    ).toBeVisible();
    // Le compteur a suivi la date lue, pas la date du jour.
    await expect(
      page.getByText(new RegExp(`pour le ${formatUtcDayFr(JOUR_DU_POST)}`, "i")),
    ).toBeVisible();

    // (1 bis) Elle reste MODIFIABLE : on la ramène à aujourd'hui à la main.
    await champDate.fill(aujourdhui);
    await expect(champDate).toHaveValue(aujourdhui);

    await ctx.close();
  });

  test("un lien raccourci ne fait pas semblant : il DIT que la date n'y est pas", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now() + 1;
    const { creatorId, token, password } = await inviterClippeur(ts, "court");

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/clip", { timeout: 20_000 });

    const { ids } = await clipsPretsAPublier({ creatorId, ts, quoi: "court" });
    await page.goto(`/clip/clips/${ids[0]}`);

    await page
      .getByLabel(/lien du post TikTok/i)
      .fill("https://vm.tiktok.com/ZGeAbc123/");
    // Ni date inventée, ni silence : la raison est écrite.
    await expect(
      page.getByText(/lien raccourci — la date n'y est pas/i),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/date de sortie du post/i)).toHaveValue(
      utcDayKey(Date.now()),
    );

    await ctx.close();
  });
});

test.describe("Publication d'un clip — le serveur", () => {
  test("la date déclarée consomme le quota de CE jour-là, et le refus le nomme", async () => {
    test.setTimeout(90_000);
    const ts = Date.now() + 2;
    const { creatorId, token, email, password } = await inviterClippeur(
      ts,
      "srv",
    );
    // Session RÉELLE du clippeur : c'est SA mutation qu'on exerce, avec sa garde
    // d'appartenance et ses bornes — pas le chemin admin.
    const client = await sessionClippeur(email, password, token);
    const { ids } = await clipsPretsAPublier({
      creatorId,
      ts,
      quoi: "srv",
      count: 3,
    });
    const projectId = await convex.getProjectId();

    const hier = ts - JOUR;
    const publier = (id: Id<"assignments">, n: number, at?: number) =>
      client.mutation(api.assignments.confirmClipPublication, {
        projectId,
        id,
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}${n}` },
        ],
        ...(at !== undefined ? { publishedAt: at } : {}),
      });

    // Deux posts DATÉS D'HIER : ils consomment le quota d'HIER.
    await publier(ids[0], 1, hier);
    await publier(ids[1], 2, hier);

    // Le troisième, daté d'hier lui aussi, est refusé — et le message NOMME hier,
    // pas aujourd'hui. Sans la date, le clippeur croirait ses créneaux du jour pris.
    await expect(publier(ids[2], 3, hier)).rejects.toThrow(
      new RegExp(
        `quota atteint pour le ${formatUtcDayFr(hier)}`.replace(/\s+/g, "\\s+"),
        "i",
      ),
    );

    // Le quota d'AUJOURD'HUI est intact : le même clip passe sans date déclarée.
    await expect(publier(ids[2], 3)).resolves.toBeTruthy();
  });

  test("les bornes de la date déclarée sont celles du secours admin", async () => {
    test.setTimeout(90_000);
    const ts = Date.now() + 3;
    const { creatorId, token, email, password } = await inviterClippeur(
      ts,
      "bornes",
    );
    const client = await sessionClippeur(email, password, token);
    const { ids } = await clipsPretsAPublier({ creatorId, ts, quoi: "bornes" });
    const projectId = await convex.getProjectId();

    const publier = (at: number) =>
      client.mutation(api.assignments.confirmClipPublication, {
        projectId,
        id: ids[0],
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}9` },
        ],
        publishedAt: at,
      });

    await expect(publier(ts + JOUR)).rejects.toThrow(/futur/i);
    // createdAt est antidaté de 25 jours par le seeder : 40 le précède.
    await expect(publier(ts - 40 * JOUR)).rejects.toThrow(
      /précéder la création/i,
    );
  });

  test("LA PHASE AUSSI est évaluée à la date déclarée, pas à aujourd'hui", async () => {
    test.setTimeout(90_000);
    const ts = Date.now() + 5;
    const { creatorId, token, email, password } = await inviterClippeur(
      ts,
      "phase",
    );
    const client = await sessionClippeur(email, password, token);
    // Ancre à J3 aujourd'hui → le compte est en CHAUFFE depuis-hier-et-encore.
    // Un post daté d'hier retombe en J2 : chauffe, quota 0.
    const { ids } = await clipsPretsAPublier({
      creatorId,
      ts,
      quoi: "phase",
      ancreJours: 2,
    });
    const projectId = await convex.getProjectId();
    const hier = ts - JOUR;

    // Le refus nomme la PHASE d'hier ET la date d'hier : c'est ce qui rend le
    // message compréhensible pour un clippeur qui antidate sans y penser.
    await expect(
      client.mutation(api.assignments.confirmClipPublication, {
        projectId,
        id: ids[0],
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}8` },
        ],
        publishedAt: hier,
      }),
    ).rejects.toThrow(
      new RegExp(
        `phase de chauffe le ${formatUtcDayFr(hier)}`.replace(/\s+/g, "\\s+"),
        "i",
      ),
    );
  });

  test("un clippeur ne peut pas publier le clip d'un autre", async () => {
    test.setTimeout(90_000);
    const ts = Date.now() + 4;
    const a = await inviterClippeur(ts, "isoa");
    const b = await inviterClippeur(ts, "isob");
    await sessionClippeur(a.email, a.password, a.token);
    const clientB = await sessionClippeur(b.email, b.password, b.token);
    const { ids } = await clipsPretsAPublier({
      creatorId: a.creatorId,
      ts,
      quoi: "isoa",
    });
    const projectId = await convex.getProjectId();

    // « Introuvable », pas « pas à toi » : on ne confirme pas l'existence du clip
    // d'un autre.
    await expect(
      clientB.mutation(api.assignments.confirmClipPublication, {
        projectId,
        id: ids[0],
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}7` },
        ],
      }),
    ).rejects.toThrow(/introuvable/i);
  });
});
