import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * LA CHAÎNE ENTIÈRE — la seule spec qui regarde le chantier plutôt que ses parties.
 *
 * Sept PRs, sept segments, chacun avec ses specs vertes. Le mode d'échec propre à
 * un chantier découpé n'est pas dans les segments : il est AUX JOINTURES, là où
 * la sortie de l'un devient l'entrée du suivant et où personne ne regarde parce
 * que les deux côtés sont couverts.
 *
 * ⚠️ NE PAS SUPPRIMER CETTE SPEC COMME REDONDANTE. Chacune de ses étapes est
 * couverte ailleurs — c'est exactement pour ça qu'elle a l'air redondante, et
 * exactement pourquoi elle ne l'est pas. Elle est le SEUL test du dépôt qui
 * regarde le chantier au lieu de ses parties.
 *
 * CE QU'ELLE A TROUVÉ LE JOUR OÙ ELLE A ÉTÉ ÉCRITE : rien ne faisait jamais
 * passer un rush à `published`. L'état existait dans `convex/rushStatus.ts`, il
 * existait dans les libellés servis au talent (« Publié »), et aucun code ne
 * l'écrivait — un talent dont le clip était sorti aurait lu « Validé » à vie.
 *
 * AUCUNE SPEC DE SEGMENT NE POUVAIT LE VOIR. Le dépôt était vert, la revue était
 * verte, l'assignation était verte, la publication était verte, la paie était
 * verte. Le trou était ENTRE la publication et le dépôt : les deux côtés de la
 * jointure passaient, et personne ne regardait le passage. C'est le mode d'échec
 * propre à un chantier découpé en N morceaux, et il ne se voit qu'en traversant.
 *
 * Si un jour elle casse, la réponse n'est jamais « la supprimer parce que les
 * segments sont verts » : c'est précisément ce qu'ils seront.
 *
 * PARCOURS, avec les vraies mutations de chaque population :
 *   invitation talent + clippeur → appariement → déclaration de compte par le
 *   clippeur → validation admin → dépôt de rush par le talent → revue admin →
 *   assignation d'un script → production et publication par le clippeur →
 *   ligne de paie → gel du cycle.
 *
 * DEUX ANTIDATAGES, et rien d'autre de simulé : la validation du compte (sinon
 * il faudrait attendre 14 jours de phase avant de pouvoir publier) et le passage
 * en revue vidéo (`e2eSetAssignmentStatus`, dont le segment a ses propres specs
 * — mp4-workflow, validation-accrual — et que ce chantier n'a pas modifié).
 */

const JOUR = 86_400_000;
const TARIF_CLIP = 12.5;
const FORFAIT = 337.5;

async function inscrire(
  kind: "talent" | "clipper",
  ts: number,
): Promise<{
  creatorId: Id<"creators">;
  client: ConvexHttpClient;
}> {
  const email = `e2e-creator-${kind}-chaine-${ts}@repackit.test`;
  const password = `chaine-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} chaîne ${ts}`,
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

test.describe("Chantier talent/clippeur — la chaîne entière", () => {
  test("d'une invitation à une ligne de paie gelée, sans sauter une jointure", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await admin.mutation(api.projects.setTalentSettings, {
      fileDropEnabled: true,
    });

    // ── 1. Les deux populations entrent par le flux d'invitation réel ────────
    const talent = await inscrire("talent", ts);
    const clipper = await inscrire("clipper", ts + 1);

    // ── 2. Appariement + tarifs + activation du talent (pose son ancre) ──────
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      clipperId: clipper.creatorId,
      cycleRetainer: FORFAIT,
      status: "active",
    });
    await admin.mutation(api.creators.updateCreator, {
      id: clipper.creatorId,
      clipRate: TARIF_CLIP,
    });

    // ── 3. Le CLIPPEUR déclare son compte — il arrive en attente de validation ─
    const compteId = await clipper.client.mutation(
      api.comptes.declareClipperCompte,
      {
        projectId,
        plateforme: "TikTok",
        handle: `@e2echaine${ts}`,
      },
    );
    const enAttente = await admin.query(api.comptes.listComptes, {});
    expect(enAttente.find((c) => c._id === compteId)?.status).toBe("warmup");

    // ── 4. L'ADMIN valide le compte → l'ancre de phase est posée ─────────────
    await admin.mutation(api.comptes.updateCompte, {
      id: compteId,
      status: "actif",
    });
    const valide = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === compteId,
    )!;
    expect(valide.validatedAt).toBeTruthy();
    // Antidatage : un compte validé à l'instant est en CHAUFFE (quota 0).
    await admin.mutation(api.rushes.e2eBackdateCompteValidation, {
      secret: E2E_SECRET,
      compteId,
      validatedAt: ts - 20 * JOUR,
    });

    // ── 5. Le TALENT dépose un rush ─────────────────────────────────────────
    const { rushId } = await talent.client.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-chaine-${ts}`,
      fileName: "prise-chaine.mov",
      mimeType: "video/quicktime",
      sizeBytes: 31_457_280,
    });

    // ── 6. Le rush arrive dans la file de revue, avec SON clippeur apparié ───
    const file = await admin.query(api.rushes.listRushesForReview, {});
    const ligne = file.find((r) => r.id === rushId)!;
    expect(ligne.status).toBe("deposited");
    expect(ligne.clipperId).toBe(clipper.creatorId);

    // ── 7. L'admin monte un script dessus (garde D7 : tout en « afficher ») ──
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Chaîne ${ts}`,
    });
    for (const [kind, mode] of [
      ["hook", "afficher"],
      ["flux", "afficher"],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label: `${kind} chaîne ${ts}`,
        content: `${kind} affiché chaîne ${ts}`,
        mode,
      });
    }
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "cta",
      label: `cta chaîne ${ts}`,
      content: `CTA chaîne ${ts}`,
    });

    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      {
        rushId,
        campaignId,
        targets: [{ platform: "TikTok" as const, accountId: compteId }],
        dueDate: ts + 3 * JOUR,
      },
    );

    // Le talent voit sa prise retenue — et rien du flux clip.
    const vuTalent = (
      await talent.client.query(api.rushes.listMyRushes, { projectId })
    ).find((r) => r._id === rushId)!;
    expect(vuTalent.status).toBe("assigned");
    expect(JSON.stringify(vuTalent)).not.toContain(assignmentId);

    // ── 8. Le CLIPPEUR voit son clip et le produit ───────────────────────────
    const mesClips = await clipper.client.query(api.assignments.listMyClips, {
      projectId,
    });
    expect(mesClips.some((c) => c._id === assignmentId)).toBe(true);
    // Segment de revue vidéo : couvert ailleurs (mp4-workflow), non modifié par
    // ce chantier → on le franchit sans le rejouer.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });

    // ── 9. Le CLIPPEUR publie, en déclarant la date de sortie ────────────────
    const sortie = ts - 2 * JOUR;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
      createdAt: ts - 5 * JOUR,
    });
    const publie = await clipper.client.mutation(
      api.assignments.confirmClipPublication,
      {
        projectId,
        id: assignmentId,
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}9` },
        ],
        publishedAt: sortie,
      },
    );
    expect(publie.publicationIds).toHaveLength(1);

    // ── 10. LA JOINTURE QUI MANQUAIT : le rush suit son clip ─────────────────
    const apresPubli = (
      await talent.client.query(api.rushes.listMyRushes, { projectId })
    ).find((r) => r._id === rushId)!;
    expect(apresPubli.status).toBe("published");
    expect(apresPubli.publishedAt).toBe(sortie);

    // ── 11. La paie : une ligne de clip pour le clippeur, un forfait pour le
    //        talent — et rien du moteur v2 nulle part ──────────────────────────
    const paie = await admin.query(api.payments.listPayments, {});
    const duClippeur = paie
      .filter((r) => r.creatorId === clipper.creatorId)
      .flatMap((r) => r.lineItems);
    const clips = duClippeur.filter((li) => li.kind === "clip");
    expect(clips).toHaveLength(1);
    expect(clips[0].amount).toBe(TARIF_CLIP);
    expect(duClippeur.filter((li) => li.kind === "base")).toHaveLength(0);
    expect(
      duClippeur.filter((li) => li.kind === "fixed" || li.kind === "cpm"),
    ).toHaveLength(0);

    const cyclesTalent = paie.filter((r) => r.creatorId === talent.creatorId);
    expect(cyclesTalent.length).toBeGreaterThanOrEqual(1);
    expect(cyclesTalent[0].totalDue).toBe(FORFAIT);
    // Le rush déposé compte pour l'AFFICHAGE, jamais pour le montant.
    expect(cyclesTalent[0].rushCount).toBe(1);

    // ── 12. Le gel clôt la chaîne ────────────────────────────────────────────
    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: clipper.creatorId,
      cycleIndex: 0,
    });
    const gele = (await admin.query(api.payments.listPayments, {})).find(
      (r) => r.creatorId === clipper.creatorId && r.status === "paid",
    )!;
    expect(gele.lineItems.filter((li) => li.kind === "clip")).toHaveLength(1);
    expect(gele.totalDue).toBe(TARIF_CLIP);
  });
});
