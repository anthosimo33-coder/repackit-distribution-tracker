import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Quadrant « Vues × Intent » — preuves SERVEUR.
 *
 * Ce que la spec vérifie, et que l'unitaire ne peut pas : que le classement est
 * bien ÉCRIT par le recalcul (absent avant, présent après), qu'il est servi par
 * `listTrackerPosts` avec les saves, et que la médiane de référence est celle du
 * COMPTE — pas un agrégat de la base e2e partagée.
 *
 * La base est partagée et sérielle : aucune assertion sur un nombre absolu de
 * lignes, tout se lit sur l'APPARTENANCE de nos posts, sur des comptes dont le
 * handle est suffixé par l'horodatage du run.
 */
test.describe("Quadrant Vues × Intent", () => {
  test("le relevé écrit le classement, et la carte le lit avec ses saves", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    // Horloge du recalcul : figée sur le run, comme la nuit fige la sienne.
    const now = ts;
    const compteTikTok = `@e2e_quad_${ts}`;
    const compteInsta = `@e2e_quad_ig_${ts}`;

    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Quadrant ${ts}`,
    })) as Id<"icps">;

    async function publier(opts: {
      suffix: string;
      compte: string;
      plateforme: "TikTok" | "Instagram";
      ageMs: number;
      vues: number;
      /** Omis = saves JAMAIS relevées (le cas TikTok d'avant la collecte). */
      saves?: number;
    }): Promise<Id<"publications">> {
      const datePubli = ts - opts.ageMs;
      const carouselId = await admin.query(
        api.publications.getNextCarouselId,
        {},
      );
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Quadrant ${opts.suffix} ${ts}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script e2e",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: [opts.plateforme],
        compte: opts.compte,
        datePubli,
        notes: "[E2E_TEST] tracker-quadrant",
      });
      const pubId = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, {
        id: pubId,
        postUrl:
          opts.plateforme === "TikTok"
            ? `https://www.tiktok.com/@e2e/video/7${opts.suffix}${ts}`
            : `https://www.instagram.com/reel/E2E${opts.suffix}${ts}/`,
      });
      // Relevé APRÈS la publication (invariant metricSnapshots) et avant `now`.
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: pubId,
        vues: opts.vues,
        ...(opts.saves !== undefined ? { saves: opts.saves } : {}),
        capturedAt: datePubli + HOUR,
        source: opts.plateforme === "TikTok" ? "tiktok" : "instagram",
      });
      return pubId;
    }

    // ── Un compte TikTok avec un historique réaliste ────────────────────────
    // Vues non rondes et saves rares : sur des nombres ronds, « ≥ 3× » et
    // « > 2,9× » passeraient tous les deux.
    const p1 = await publier({ suffix: "a", compte: compteTikTok, plateforme: "TikTok", ageMs: 9 * DAY, vues: 3_207, saves: 4 });
    const p2 = await publier({ suffix: "b", compte: compteTikTok, plateforme: "TikTok", ageMs: 7 * DAY, vues: 4_312, saves: 9 });
    const p3 = await publier({ suffix: "c", compte: compteTikTok, plateforme: "TikTok", ageMs: 5 * DAY, vues: 5_961, saves: 21 });
    // Saves JAMAIS relevées : la collecte est postérieure à ce post.
    const pSansSaves = await publier({ suffix: "d", compte: compteTikTok, plateforme: "TikTok", ageMs: 6 * DAY, vues: 7_413 });
    // Le post qui sort : 6,2× la médiane du compte et un save rate au-dessus.
    const pStar = await publier({ suffix: "e", compte: compteTikTok, plateforme: "TikTok", ageMs: 4 * DAY, vues: 41_207, saves: 338 });
    // Publié 24 h APRÈS pStar → dans sa fenêtre de breakout.
    const pSuiveur = await publier({ suffix: "f", compte: compteTikTok, plateforme: "TikTok", ageMs: 3 * DAY, vues: 9_004, saves: 18 });
    // Moins de 48 h → « en attente », quels que soient ses chiffres.
    const pFrais = await publier({ suffix: "g", compte: compteTikTok, plateforme: "TikTok", ageMs: 6 * HOUR, vues: 12_004, saves: 61 });

    // ── Un compte Instagram : la plateforme n'expose pas les saves ──────────
    const ig1 = await publier({ suffix: "h", compte: compteInsta, plateforme: "Instagram", ageMs: 5 * DAY, vues: 604 });
    await publier({ suffix: "i", compte: compteInsta, plateforme: "Instagram", ageMs: 7 * DAY, vues: 812 });
    await publier({ suffix: "j", compte: compteInsta, plateforme: "Instagram", ageMs: 9 * DAY, vues: 977 });

    // QUALIFICATION tri-état : un post de chauffe, un promo DÉCIDÉ, et les
    // autres jamais qualifiés. Le warmup ne change PAS la médiane du compte
    // (réglage `baselineIncludesWarmup`), les attendus ci-dessous tiennent.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: p1,
      isWarmup: true,
    });
    // Aller-retour VOLONTAIRE pour p2. `setPublicationWarmup(false)` sur un post
    // jamais qualifié est un NO-OP (la garde lit `pub.isWarmup === true`, donc
    // « absent » y vaut déjà false) : il faut être passé par `true` pour que
    // `false` soit réellement STOCKÉ. C'est aussi le seul chemin applicatif vers
    // cet état — en prod il vient de la matérialisation d'une assignation
    // `contentType: "promo"`. Sans cet aller-retour, p2 resterait « autre » et
    // l'assertion « promo » ci-dessous ne prouverait rien.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: p2,
      isWarmup: true,
    });
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: p2,
      isWarmup: false,
    });

    const mesIds = new Set<string>([p1, p2, p3, pSansSaves, pStar, pSuiveur, pFrais, ig1]);
    type Row = FunctionReturnType<
      typeof api.trackerData.listTrackerPosts
    >[number];
    const lire = async (): Promise<Map<string, Row>> => {
      const rows = await admin.query(api.trackerData.listTrackerPosts, {
        warmup: "all",
      });
      return new Map(
        rows.filter((r) => mesIds.has(r._id as string)).map((r) => [r._id as string, r]),
      );
    };

    // ── AVANT le recalcul : aucun classement ────────────────────────────────
    const avant = await lire();
    // Présence appariée : les posts SONT bien servis (sinon l'absence de
    // quadrant serait vraie sur une liste vide et ne prouverait rien).
    expect(avant.size).toBe(mesIds.size);
    expect(avant.get(pStar)?.vues).toBe(41_207);
    for (const [, row] of avant) expect(row.quadrant).toBeNull();

    // ── Le recalcul (le MÊME code que le relevé nocturne) ───────────────────
    const projectId = await admin.getProjectId();
    await admin.mutation(api.quadrantSync.e2eRecomputeQuadrant, {
      secret: E2E_SECRET,
      projectId,
      now,
    });

    const apres = await lire();

    // ── La médiane est celle du COMPTE ──────────────────────────────────────
    // 6 posts TikTok matures et mesurés : 3 207 / 4 312 / 5 961 / 7 413 /
    // 9 004 / 41 207 → médiane (5 961 + 7 413) / 2. Le post de moins de 48 h
    // n'y est pas, ni aucun post d'un autre compte de la base e2e.
    const star = apres.get(pStar);
    expect(star?.quadrant?.baselineSample).toBe(6);
    expect(star?.quadrant?.baselineViews).toBe(6_687);

    // ── Le post qui sort tombe dans « scale » ───────────────────────────────
    expect(star?.quadrant?.status).toBe("classified");
    expect(star?.quadrant?.key).toBe("scale");
    expect(star?.quadrant?.scoreDistribution).toBeCloseTo(41_207 / 6_687, 6);
    expect(star?.quadrant?.scoreIntent).toBeCloseTo(338 / 41_207, 8);
    // Les saves remontent telles quelles dans la row de la carte.
    expect(star?.saves).toBe(338);
    expect(star?.savesAvailability).toBe("measured");

    // ── Les posts ordinaires du compte tombent en bas à gauche ─────────────
    expect(apres.get(p1)?.quadrant?.key).toBe("archiver");
    expect(apres.get(p2)?.quadrant?.key).toBe("archiver");
    expect(apres.get(p3)?.quadrant?.key).toBe("archiver");

    // ── Moins de 48 h : en attente, mais les deux scores sont là ───────────
    const frais = apres.get(pFrais);
    expect(frais?.quadrant?.status).toBe("pending");
    expect(frais?.quadrant?.key).toBeUndefined();
    expect(frais?.quadrant?.scoreDistribution).toBeCloseTo(12_004 / 6_687, 6);
    expect(frais?.quadrant?.scoreIntent).toBeCloseTo(61 / 12_004, 8);

    // ── Saves jamais relevées sur TikTok : collecte en cours ───────────────
    const sansSaves = apres.get(pSansSaves);
    expect(sansSaves?.quadrant?.status).toBe("no_intent");
    expect(sansSaves?.quadrant?.reason).toBe("saves_collecting");
    // Jamais 0 : une absence de mesure n'est pas un save rate nul.
    expect(sansSaves?.saves).toBeNull();
    expect(sansSaves?.savesAvailability).toBe("collecting");
    // Présence appariée : l'axe X, lui, est bien calculé.
    expect(sansSaves?.quadrant?.scoreDistribution).toBeCloseTo(7_413 / 6_687, 6);

    // ── Instagram : la plateforme n'exposera jamais les saves ──────────────
    const insta = apres.get(ig1);
    expect(insta?.quadrant?.status).toBe("no_intent");
    expect(insta?.quadrant?.reason).toBe("saves_unavailable");
    expect(insta?.savesAvailability).toBe("unavailable");
    // Sa médiane est celle de SON compte (604 / 812 / 977), pas celle du TikTok.
    expect(insta?.quadrant?.baselineViews).toBe(812);
    expect(insta?.quadrant?.scoreDistribution).toBeCloseTo(604 / 812, 6);

    // ── La qualification remonte en TRI-ÉTAT ───────────────────────────────
    // `isWarmup` est un booléen dans la row : il confond « promo décidé » et
    // « jamais qualifié ». La carte colore sur ce champ-ci, sinon un défaut de
    // saisie prendrait la couleur d'une décision.
    expect(apres.get(p1)?.qualification).toBe("warmup");
    expect(apres.get(p2)?.qualification).toBe("promo");
    expect(apres.get(p3)?.qualification).toBe("autre");
    // Paire d'opposition : les deux derniers ont le MÊME `isWarmup` booléen,
    // et pourtant deux qualifications différentes.
    expect(apres.get(p2)?.isWarmup).toBe(false);
    expect(apres.get(p3)?.isWarmup).toBe(false);

    // ── Fenêtre de breakout ────────────────────────────────────────────────
    // Publié 24 h après un post à 41 207 vues du même compte.
    expect(apres.get(pSuiveur)?.quadrant?.breakoutWindow).toBe(true);
    // Paire d'opposition : le gros post n'ouvre pas sa propre fenêtre, et le
    // post de la veille (à 3,75 j de lui) est hors des 48 h.
    expect(star?.quadrant?.breakoutWindow).toBe(false);
    expect(frais?.quadrant?.breakoutWindow).toBe(false);
  });
});
