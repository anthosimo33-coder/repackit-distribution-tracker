import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { assembledScriptOf } from "./helpers/assignment-script";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Le TEXTE monté d'une mission vit hors de son document (`assignmentScripts`,
 * le 05/10/2026 : 32 % des octets de la table des missions, relus par chaque
 * query qui la parcourt). Ce que ça ne doit PAS changer : chaque écran lit le
 * même texte, aucune écriture ne le perd — y compris sur une mission d'AVANT la
 * migration, dont le texte est encore dans le document —, et la migration le
 * déplace sans rien perdre.
 */
test.describe("Texte des scripts hors du document", () => {
  test("lu pareil partout ; une mission d'avant la migration ne perd rien ; supprimée, son texte part", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Texte ${ts}`,
      email: `e2e-creator-texte-${ts}@repackit.test`,
      password: "texte-12345",
    });
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Texte ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta" | "notif", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu ${ts}`,
      });
    await add("hook", "H1");
    await add("hook", "H2");
    await add("flux", "F1");
    await add("flux", "F2");
    await add("cta", "C");
    const notif = await add("notif", "N");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Texte ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2etexte${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 3,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const [m0, m1, m2] = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.scriptCombo?.campaignId === campaignId,
    );
    const etat = (id: Id<"assignments">) =>
      admin.mutation(api.assignments.e2eEtatDuTexte, { secret: E2E_SECRET, id });
    const fiche = async (id: Id<"assignments">) =>
      (await creator.client.query(api.assignments.getMyAssignment, {
        projectId: creator.projectId,
        id,
      }))!.assembledScript;

    // ── 1. À la création : le texte est dans la table, PAS dans le document,
    //       et l'admin comme la créatrice le lisent.
    const e0 = await etat(m0._id);
    expect(e0.dansLeDocument).toBeNull();
    expect(e0.ligne).toContain(`contenu ${ts}`);
    expect(await assembledScriptOf(admin, m0._id)).toBe(e0.ligne);
    expect(await fiche(m0._id)).toBe(e0.ligne);

    // ── 2. Une mission d'AVANT la migration (texte dans le document, pas de
    //       ligne) se lit pareil…
    const t1 = (await etat(m1._id)).ligne!;
    await admin.mutation(api.assignments.e2eRemettreTexteDansLeDocument, {
      secret: E2E_SECRET,
      id: m1._id,
    });
    expect(await etat(m1._id)).toEqual({ existe: true, dansLeDocument: t1, ligne: null });
    expect(await assembledScriptOf(admin, m1._id)).toBe(t1);
    expect(await fiche(m1._id)).toBe(t1);

    // … et une écriture qui ne touche QUE la notif ne perd pas son texte : il
    //   part dans la table au moment où il quitte le document.
    await admin.mutation(api.scripts.editScriptCombo, {
      id: m1._id,
      slot: "notif",
      newBrickId: notif,
    });
    expect(await etat(m1._id)).toEqual({ existe: true, dansLeDocument: null, ligne: t1 });
    expect(await fiche(m1._id)).toBe(t1);

    // ── 3. La migration (même code que la prod) : copie, retire, idempotente.
    const t2 = (await etat(m2._id)).ligne!;
    await admin.mutation(api.assignments.e2eRemettreTexteDansLeDocument, {
      secret: E2E_SECRET,
      id: m2._id,
    });
    expect(
      await admin.mutation(api.assignments.e2eSortirTextes, {
        secret: E2E_SECRET,
        ids: [m2._id, m0._id],
      }),
    ).toEqual(["deplace", "rien"]);
    expect(await etat(m2._id)).toEqual({ existe: true, dansLeDocument: null, ligne: t2 });
    expect(await assembledScriptOf(admin, m2._id)).toBe(t2);
    expect(
      await admin.mutation(api.assignments.e2eSortirTextes, {
        secret: E2E_SECRET,
        ids: [m2._id],
      }),
    ).toEqual(["rien"]);

    // ── 4. Supprimée, la mission emporte son texte (aucune ligne orpheline).
    await admin.mutation(api.assignments.deleteAssignment, { id: m0._id });
    expect(await etat(m0._id)).toEqual({ existe: false, dansLeDocument: null, ligne: null });
  });
});
