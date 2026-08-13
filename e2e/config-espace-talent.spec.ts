import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * CONFIGURATION DE L'ESPACE TALENT — par le chemin admin RÉEL.
 *
 * C'est le seul segment que le chantier n'avait jamais exercé : toutes les specs
 * précédentes posaient ces réglages par mutation directe, en les considérant
 * comme un décor. Ici, ils sont l'objet du test — création du brief comprise,
 * puisque `createFormat` n'avait plus aucun appelant dans l'app depuis le retrait
 * de la page Formats.
 *
 * Ce qui est prouvé : les quatre réglages qu'un admin doit poser pour qu'un
 * binôme tourne le sont par les MÊMES fonctions que l'écran appelle, et ce qui en
 * découle arrive jusqu'au talent (son brief) et jusqu'à la paie (le tarif figé
 * sur le clip).
 */

const JOUR = 86_400_000;
const TARIF_CLIP = 12.5;
const FORFAIT = 337.5;

async function inscrire(kind: "talent" | "clipper", ts: number) {
  const email = `e2e-creator-${kind}-config-${ts}@repackit.test`;
  const password = `config-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} config ${ts}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  client.setAuth(res.tokens!.token);
  return { creatorId, client };
}

test.describe("Configuration de l'espace talent — chemin admin réel", () => {
  test("les quatre réglages, posés comme l'écran les pose, mettent le binôme en service", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();

    // ── État de départ : rien n'est réglé ────────────────────────────────────
    await admin.mutation(api.projects.setTalentSettings, {
      fileDropEnabled: false,
      talentBriefFormatId: null,
    });
    const avant = await admin.query(api.projects.getTalentSettings, {});
    expect(avant.fileDropEnabled).toBe(false);
    expect(avant.talentBriefFormatId).toBeNull();

    const talent = await inscrire("talent", ts);
    const clipper = await inscrire("clipper", ts + 1);

    // ── 1. Le talent ne peut RIEN déposer tant que le dépôt est fermé ────────
    await expect(
      talent.client.mutation(api.rushes.confirmDeposit, {
        projectId,
        driveFileId: `drive-config-ko-${ts}`,
        fileName: "refuse.mov",
        mimeType: "video/quicktime",
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/indisponible/i);

    // ── 2. ÉCRIRE LE BRIEF — le geste que plus rien dans l'app ne faisait ────
    const formatId = (await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Brief config ${ts}`,
      type: "custom",
      brief: `## Comment filmer\n\n- Lumière naturelle\n- Repère ${ts}`,
      exampleVideos: [
        {
          kind: "url",
          url: "https://www.tiktok.com/@exemple/video/123",
          platform: "tiktok",
          title: "Exemple",
        },
      ],
    })) as Id<"formats">;

    // ── 3. Le désigner + ouvrir le dépôt (ce que fait la carte de réglages) ──
    await admin.mutation(api.projects.setTalentSettings, {
      talentBriefFormatId: formatId,
      fileDropEnabled: true,
    });
    const apres = await admin.query(api.projects.getTalentSettings, {});
    expect(apres.fileDropEnabled).toBe(true);
    expect(apres.talentBriefFormatId).toBe(formatId);

    // ── 4. Les deux tarifs, posés depuis la fiche de chaque personne ─────────
    await admin.mutation(api.creators.updateCreator, {
      id: clipper.creatorId,
      clipRate: TARIF_CLIP,
    });
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      clipperId: clipper.creatorId,
      cycleRetainer: FORFAIT,
      status: "active",
    });

    // ── Ce que le TALENT lit maintenant : son brief, et rien du reste ────────
    const brief = await talent.client.query(api.formats.getMyTalentBrief, {
      projectId,
    });
    expect(brief).not.toBeNull();
    expect(brief!.brief).toContain(`Repère ${ts}`);
    expect(brief!.exampleVideos).toHaveLength(1);
    expect(Object.keys(brief!).sort()).toEqual(["brief", "exampleVideos"]);

    // ── Et il peut déposer ───────────────────────────────────────────────────
    const { rushId } = await talent.client.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-config-${ts}`,
      fileName: "prise-config.mov",
      mimeType: "video/quicktime",
      sizeBytes: 31_457_280,
    });

    // ── Le tarif posé à l'écran arrive FIGÉ sur le clip ──────────────────────
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Config ${ts}`,
    });
    for (const [kind, mode] of [
      ["hook", "afficher"],
      ["flux", "afficher"],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label: `${kind} config ${ts}`,
        content: `${kind} affiché config ${ts}`,
        mode,
      });
    }
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "cta",
      label: `cta config ${ts}`,
      content: `CTA config ${ts}`,
    });
    const cible = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2econfig${ts}`,
      validatedAt: ts - 20 * JOUR,
    });
    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      { rushId, campaignId, targets: [cible], dueDate: ts + 3 * JOUR },
    );
    const a = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x._id === assignmentId,
    )!;
    expect(a.clipRateSnapshot).toBe(TARIF_CLIP);
    expect(a.pricingSnapshot).toBeUndefined();

    // ── Et le forfait du talent est dû dès son premier cycle ─────────────────
    const cycles = (await admin.query(api.payments.listPayments, {})).filter(
      (r) => r.creatorId === talent.creatorId,
    );
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(cycles[0].totalDue).toBe(FORFAIT);
    expect(cycles[0].rushCount).toBe(1);
  });

  test("réécrire un brief en CRÉE un nouveau — l'ancien reste intact", async () => {
    // La décision de conception de cet écran : pas d'édition en place. Un brief
    // modifié réécrirait rétroactivement ce que la personne a lu, et le jour où
    // un rush est refusé pour non-respect du brief, c'est la version qu'elle
    // avait sous les yeux qui fait foi.
    const ts = Date.now();
    const premier = (await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Brief v1 ${ts}`,
      type: "custom",
      brief: `Version UN ${ts}`,
    })) as Id<"formats">;
    await admin.mutation(api.projects.setTalentSettings, {
      talentBriefFormatId: premier,
    });

    const second = (await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Brief v2 ${ts}`,
      type: "custom",
      brief: `Version DEUX ${ts}`,
    })) as Id<"formats">;
    await admin.mutation(api.projects.setTalentSettings, {
      talentBriefFormatId: second,
    });

    const reglages = await admin.query(api.projects.getTalentSettings, {});
    expect(reglages.talentBriefFormatId).toBe(second);

    // L'ANCIEN existe toujours, avec son texte d'origine — c'est lui qui fait foi
    // pour un rush tourné avant le changement.
    const v1 = await admin.query(api.formats.getFormat, { id: premier });
    expect(v1).not.toBeNull();
    expect(v1!.brief).toBe(`Version UN ${ts}`);
  });
});
