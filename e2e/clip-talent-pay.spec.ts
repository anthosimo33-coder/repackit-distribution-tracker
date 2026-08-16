import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * PAIE DES CLIPS ET DES TALENTS — le module où une régression se traduit en
 * euros versés à la mauvaise personne.
 *
 * LE JEU DE DONNÉES EST CHOISI AVANT LES ASSERTIONS, et il est laid exprès :
 * tarif de clip à 12,50 (décimales), forfait à 337,50 (ni rond ni divisible par
 * un nombre de rushes), un partenaire au modèle LEGACY à 7,30 publiant dans la
 * même fenêtre, une ancre de talent 18 jours avant son premier rush, un clip
 * au-delà du plafond de 150, et un cycle SANS aucun rush. Des nombres propres
 * auraient laissé passer une somme fausse en la faisant tomber juste.
 *
 * Trois invariants d'argent sont vérifiés PAR MUTATION DU CODE (cf le corps de
 * la PR) : Guard D, l'unicité de la ligne par clip, et le gel par markCyclePaid.
 */

const JOUR = 86_400_000;
const CYCLE = 30 * JOUR;

const TARIF_CLIP = 12.5;
const FORFAIT = 337.5;
const BASE_LEGACY = 7.3;

async function fiche(
  kind: "talent" | "clipper" | "partner",
  ts: number,
  suffix = "",
): Promise<{ creatorId: Id<"creators">; email: string; password: string }> {
  const email = `e2e-creator-${kind}-pay${suffix}-${ts}@repackit.test`;
  const password = `pay-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} pay${suffix} ${ts}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  expect(res.tokens?.token).toBeTruthy();
  return { creatorId, email, password };
}

async function sessionFor(email: string, password: string) {
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signIn" },
  });
  client.setAuth(res.tokens!.token);
  return client;
}

async function campagneAffichable(ts: number, label = "") {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Pay ${label} ${ts}`,
  });
  for (const [kind, mode] of [
    ["hook", "afficher"],
    ["flux", "afficher"],
  ] as const) {
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label: `${kind} ${label}${ts}`,
      content: `${kind} affiché ${label}${ts}`,
      mode,
    });
  }
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "cta",
    label: `cta ${label}${ts}`,
    content: `CTA ${label}${ts}`,
  });
  return campaignId;
}

/** Talent apparié + clippeur tarifé + rush déposé, prêt à être monté. */
async function decorClip(ts: number, suffix = "", tarif = TARIF_CLIP) {
  const projectId = await admin.getProjectId();
  await admin.mutation(api.projects.setTalentSettings, {
    fileDropEnabled: true,
  });
  const talent = await fiche("talent", ts, suffix);
  const clipper = await fiche("clipper", ts + 1, suffix);
  await admin.mutation(api.creators.updateCreator, {
    id: talent.creatorId,
    clipperId: clipper.creatorId,
  });
  await admin.mutation(api.creators.updateCreator, {
    id: clipper.creatorId,
    clipRate: tarif,
  });
  const talentClient = await sessionFor(talent.email, talent.password);
  const { rushId } = await talentClient.mutation(api.rushes.confirmDeposit, {
    projectId,
    driveFileId: `drive-pay-${suffix}${ts}`,
    fileName: `prise-pay-${suffix}${ts}.mov`,
    mimeType: "video/quicktime",
    sizeBytes: 31_457_280,
  });
  return { projectId, talent, clipper, rushId, talentClient };
}

/** Lignes de paie d'un créateur, tous cycles confondus. */
async function lignesDe(creatorId: Id<"creators">) {
  const rows = await admin.query(api.payments.listPayments, {});
  return rows
    .filter((r) => r.creatorId === creatorId)
    .flatMap((r) => r.lineItems.map((li) => ({ ...li, cycleKey: r.key })));
}

test.describe("Paie — clips et forfaits de talent", () => {
  test("un clip publié paie UNE ligne `clip`, et AUCUNE base legacy (Guard D)", async () => {
    const ts = Date.now();
    const { rushId, clipper } = await decorClip(ts);
    const campaignId = await campagneAffichable(ts);
    const cible = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2epay${ts}`,
      validatedAt: ts - 20 * JOUR,
    });

    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      { rushId, campaignId, targets: [cible], dueDate: ts + 3 * JOUR },
    );
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}1` }],
    });

    const lignes = await lignesDe(clipper.creatorId);
    const clips = lignes.filter((li) => li.kind === "clip");
    expect(clips).toHaveLength(1);
    expect(clips[0].amount).toBe(TARIF_CLIP);
    // Guard D : aucune base legacy à 0 € à côté, qui se lirait « ce clip vaut zéro ».
    expect(lignes.filter((li) => li.kind === "base")).toHaveLength(0);
    // Et surtout : rien du moteur v2.
    expect(lignes.filter((li) => li.kind === "fixed" || li.kind === "cpm")).toHaveLength(0);
  });

  test("NON-RÉGRESSION partenaire : la base legacy est inchangée AU CENTIME", async () => {
    const ts = Date.now();
    const partner = await fiche("partner", ts, "reg");
    const cible = await availableTarget({
      e2eClient: admin,
      creatorId: partner.creatorId,
      platform: "TikTok",
      handle: `@e2epayreg${ts}`,
    });
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format legacy ${ts}`,
      type: "short",
      // Modèle LEGACY : rateSnapshot, pas de pricingId → accrueBaseLineItem.
      rateModel: { basePerPost: BASE_LEGACY },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: partner.creatorId,
      targets: [cible],
      postsPerCreator: 1,
      dueDate: ts + 3 * JOUR,
    });
    const a = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId,
    )!;
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: a._id,
      urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}2` }],
    });

    const lignes = await lignesDe(partner.creatorId);
    const bases = lignes.filter((li) => li.kind === "base");
    expect(bases).toHaveLength(1);
    // 7,30 € et pas 7,3000000001 : Guard D n'a rien intercepté sur ce chemin.
    expect(bases[0].amount).toBe(BASE_LEGACY);
    expect(lignes.filter((li) => li.kind === "clip")).toHaveLength(0);

    // ── NON-RÉGRESSION du chemin PARTAGÉ ────────────────────────────────────
    // Ce chantier a changé l'ANCRE de cycle : `payAnchorOf` ne lit plus
    // `payStartAt`, seulement `firstPostAt`. Pour un partenaire l'expression
    // dégénère en la valeur historique — mais c'est précisément ce qu'il faut
    // PROUVER, parce qu'une erreur ici ferait disparaître ses cycles, ou pire,
    // les recalerait tous, y compris ceux déjà payés.
    //
    // ⚠️ Ne PAS asserter ici l'absence de ligne `retainer` : `retainerLineFor`
    // est gaté sur `kind === "talent"`, donc un partenaire ne peut pas en
    // recevoir, quoi qu'on casse. Vérifié sur mutant — l'assertion restait
    // verte en réintroduisant le forfait dans les cycles. Elle ne gardait rien.
    const cycles = (await admin.query(api.payments.listPayments, {})).filter(
      (r) => r.creatorId === partner.creatorId,
    );
    expect(cycles.length).toBeGreaterThan(0);
    // Son cycle 0 démarre à SON premier post, pas ailleurs.
    const cycle0 = cycles.find((c) => c.cycleIndex === 0)!;
    expect(cycle0).toBeTruthy();
    expect(
      cycle0.lineItems.filter((li: { kind: string }) => li.kind === "base"),
    ).toHaveLength(1);

    // Et un partenaire n'entre PAS dans le chemin de paie des talents.
    const talents = await admin.query(api.talentPay.listTalentPay, {});
    expect(talents.find((t) => t.creatorId === partner.creatorId)).toBeUndefined();
  });

  test("UNE ligne par clip, pas par cible : 2 plateformes → 2 publications, 1 ligne", async () => {
    const ts = Date.now();
    const { rushId, clipper } = await decorClip(ts, "duo");
    const campaignId = await campagneAffichable(ts, "duo");
    const tk = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2epayduotk${ts}`,
      validatedAt: ts - 20 * JOUR,
    });
    const ig = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "Instagram",
      handle: `@e2epayduoig${ts}`,
      validatedAt: ts - 20 * JOUR,
    });

    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      { rushId, campaignId, targets: [tk, ig], dueDate: ts + 3 * JOUR },
    );
    const res = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}3` },
        { platform: "Instagram", url: `https://www.instagram.com/reel/Ce2ePay${ts}/` },
      ],
    });
    expect(res.publicationIds).toHaveLength(2);

    const clips = (await lignesDe(clipper.creatorId)).filter(
      (li) => li.kind === "clip",
    );
    expect(clips).toHaveLength(1);
    expect(clips[0].amount).toBe(TARIF_CLIP);
  });

  test("le plafond de 150 ne s'applique PAS au tarif d'un clip", async () => {
    const ts = Date.now();
    const { rushId, clipper } = await decorClip(ts, "cap", 175.4);
    const campaignId = await campagneAffichable(ts, "cap");
    const cible = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2epaycap${ts}`,
      validatedAt: ts - 20 * JOUR,
    });
    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      { rushId, campaignId, targets: [cible], dueDate: ts + 3 * JOUR },
    );
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}4` }],
    });

    const clips = (await lignesDe(clipper.creatorId)).filter(
      (li) => li.kind === "clip",
    );
    // 175,40 versé EN ENTIER : le plafond protège d'une dérive du CPM, pas d'un
    // tarif unitaire que l'admin a réglé exprès.
    expect(clips[0].amount).toBe(175.4);
  });

  test("markCyclePaid GÈLE la ligne de clip (invariant 3)", async () => {
    const ts = Date.now();
    const { rushId, clipper } = await decorClip(ts, "gel");
    const campaignId = await campagneAffichable(ts, "gel");
    const cible = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2epaygel${ts}`,
      validatedAt: ts - 20 * JOUR,
    });
    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      { rushId, campaignId, targets: [cible], dueDate: ts + 3 * JOUR },
    );
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}5` }],
    });

    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: clipper.creatorId,
      cycleIndex: 0,
    });

    const rows = (await admin.query(api.payments.listPayments, {})).filter(
      (r) => r.creatorId === clipper.creatorId,
    );
    const payee = rows.find((r) => r.status === "paid")!;
    expect(payee).toBeTruthy();
    const clips = payee.lineItems.filter((li) => li.kind === "clip");
    expect(clips).toHaveLength(1);
    expect(clips[0].amount).toBe(TARIF_CLIP);
    expect(payee.totalDue).toBe(TARIF_CLIP);
  });

  test("un talent a des cycles, un forfait, et markCyclePaid ne jette pas", async () => {
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await admin.mutation(api.projects.setTalentSettings, {
      fileDropEnabled: true,
    });
    const talent = await fiche("talent", ts, "cyc");
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      monthlyRetainer: FORFAIT,
      status: "active",
    });
    // Ancre antidatée d'un cycle + 18 jours → deux cycles, dont un révolu.
    const ancre = ts - CYCLE - 18 * JOUR;
    await admin.mutation(api.creators.e2eSetPayAnchor, {
      secret: E2E_SECRET,
      creatorId: talent.creatorId,
      payStartAt: ancre,
    });
    // Un rush déposé — il compte pour l'AFFICHAGE, jamais pour le montant.
    const talentClient = await sessionFor(talent.email, talent.password);
    await talentClient.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-cyc-${ts}`,
      fileName: "prise-cycle.mov",
      mimeType: "video/quicktime",
      sizeBytes: 1,
    });

    // ── Le talent n'a AUCUN cycle J+30 ──────────────────────────────────────
    // Son forfait est au MOIS CALENDAIRE (B3) : 30 jours fixes produiraient
    // 12,17 échéances par an, soit un mois offert chaque année. Il sort donc
    // entièrement du chemin des cycles.
    const cycles = (await admin.query(api.payments.listPayments, {})).filter(
      (r) => r.creatorId === talent.creatorId,
    );
    expect(cycles).toHaveLength(0);

    // ── …et il est PRÉSENT dans le chemin de paie des talents ───────────────
    // L'absence ci-dessus n'a de sens qu'à côté de cette présence : sans elle,
    // une lecture qui ne renverrait jamais rien passerait le test.
    const recaps = await admin.query(api.talentPay.listTalentPay, {});
    const mien = recaps.find((r) => r.creatorId === talent.creatorId)!;
    expect(mien).toBeTruthy();
    expect(mien.monthlyRetainer).toBe(FORFAIT);
    // Ancre à un mois + 18 jours : le mois d'entrée et le mois courant au moins.
    expect(mien.months.length).toBeGreaterThanOrEqual(2);
    for (const m of mien.months) {
      expect(m.amount).toBe(FORFAIT);
      expect(m.status).toBe("due");
    }
    expect(mien.totalDue).toBe(FORFAIT * mien.months.length);

    // ── Le geste de paie : scopé au talent ET au mois ────────────────────────
    const premier = mien.months[0].period;
    await admin.mutation(api.payments.markTalentMonthPaid, {
      creatorId: talent.creatorId,
      period: premier,
    });
    const apres = (await admin.query(api.talentPay.listTalentPay, {})).find(
      (r) => r.creatorId === talent.creatorId,
    )!;
    const moisPaye = apres.months.find((m) => m.period === premier)!;
    expect(moisPaye.status).toBe("paid");
    expect(moisPaye.amount).toBe(FORFAIT);
    // Le total DÛ a baissé d'un mois ; le total GLOBAL n'a pas bougé.
    expect(apres.totalDue).toBe(FORFAIT * (apres.months.length - 1));
    expect(apres.totalAll).toBe(FORFAIT * apres.months.length);

    // Idempotente : re-payer le même mois ne verse pas une seconde fois.
    const rejoue = await admin.mutation(api.payments.markTalentMonthPaid, {
      creatorId: talent.creatorId,
      period: premier,
    });
    expect(rejoue.alreadyPaid).toBe(true);

    // ── LE GEL ───────────────────────────────────────────────────────────────
    // Augmenter le forfait ne réécrit PAS un mois déjà payé, et s'applique aux
    // mois encore dus. Même principe que pricingSnapshot.
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      monthlyRetainer: FORFAIT * 2,
    });
    const apresHausse = (
      await admin.query(api.talentPay.listTalentPay, {})
    ).find((r) => r.creatorId === talent.creatorId)!;
    expect(
      apresHausse.months.find((m) => m.period === premier)!.amount,
    ).toBe(FORFAIT);
    for (const m of apresHausse.months.filter((x) => x.status === "due")) {
      expect(m.amount).toBe(FORFAIT * 2);
    }
  });

  test("le talent n'a JAMAIS de firstPostAt, le partenaire JAMAIS de payStartAt", async () => {
    const ts = Date.now();
    const talent = await fiche("talent", ts, "anc");
    const partner = await fiche("partner", ts + 1, "anc");

    // Activation des DEUX : c'est le geste qui pose l'ancre.
    for (const id of [talent.creatorId, partner.creatorId]) {
      await admin.mutation(api.creators.updateCreator, { id, status: "active" });
    }

    const t = await admin.query(api.creators.getCreator, { id: talent.creatorId });
    const p = await admin.query(api.creators.getCreator, { id: partner.creatorId });

    // Le talent est ancré et ne publie jamais (la spec du chantier rushes reste
    // vraie : firstPostAt est un champ DISTINCT).
    expect(t!.payStartAt).toBeTruthy();
    expect(t!.firstPostAt).toBeUndefined();

    // ⚠️ LA LIGNE LA PLUS DANGEREUSE DE CETTE PR. Une ancre posée sur un
    // partenaire serait antérieure à son premier post et recalerait TOUS ses
    // cycles, y compris ceux déjà payés.
    expect(p!.payStartAt).toBeUndefined();
  });

  test("l'ancre d'un talent est FIGÉE : une seconde activation ne la déplace pas", async () => {
    const ts = Date.now();
    const talent = await fiche("talent", ts, "fig");
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      status: "active",
    });
    const premiere = (await admin.query(api.creators.getCreator, {
      id: talent.creatorId,
    }))!.payStartAt;
    expect(premiere).toBeTruthy();

    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      status: "paused",
    });
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      status: "active",
    });
    const seconde = (await admin.query(api.creators.getCreator, {
      id: talent.creatorId,
    }))!.payStartAt;
    // Réécrire l'ancre décalerait tous ses cycles — y compris ceux déjà payés.
    expect(seconde).toBe(premiere);
  });
});
