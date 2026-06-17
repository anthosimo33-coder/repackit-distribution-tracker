import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { REPACKIT_SLUG } from "./projects";
import { accrueBaseLineItem, upsertBonusLineItem, periodOf } from "./payments";

/**
 * Seed de DÉMO RÉVERSIBLE — peuple le projet repackit d'un créateur de test
 * « Antho Test » (= Serge lui-même) pour cliquer dans toute l'app (admin ET
 * portail créateur) avant l'arrivée des vrais créateurs.
 *
 * TOUT est marqué [DEMO] (nom/notes/email reconnaissables) → `cleanupDemoData`
 * cible ce marqueur et n'efface QUE le démo, jamais du réel.
 *
 * Lancement (Serge) :
 *   npx convex run demoSeed:seedDemoCreator --prod      # peupler
 *   npx convex run demoSeed:cleanupDemoData --prod      # tout effacer
 *
 * Portail créateur : le seed crée le créateur en statut "invited" + une
 * invitation. Le résultat de la commande imprime le lien /join/<token> ; Serge
 * l'ouvre, choisit un mot de passe (l'email est pré-rempli, DEMO_CREATOR_EMAIL)
 * → son login créateur est créé et lié à la fiche. Il voit alors SA vue portail.
 * (auth.ts exige status "invited" pour consommer le token — d'où ce statut ;
 * passe à "onboarding" à l'acceptation, ajustable en "active" côté admin.)
 *
 * ⚠️ TS7022 — seedDemoCreator appelle ctx.runMutation(internal.*) : type de
 * retour ANNOTÉ.
 */

const DAY = 86_400_000;
const DEMO_MARKER = "[DEMO]";
const DEMO_CREATOR_EMAIL = "antho.test.demo@repackit.io";
const DEMO_CREATOR_NAME = "Antho Test [DEMO]";

/** Grille de rému démo, copiée en rateSnapshot sur chaque assignment. */
const DEMO_RATE = {
  basePerPost: 5,
  viewBonusPer1k: 1,
  bounties: [{ thresholdViews: 50_000, amount: 20 }],
};

/** "YYYY-MM-DD" UTC pour les dailyChecks de warmup. */
function ymd(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

export interface SeedResult {
  ok: boolean;
  skipped: boolean;
  message: string;
  creatorId: Id<"creators"> | null;
  demoEmail: string;
  /** Lien d'invitation à ouvrir pour le login portail (null si déjà consommé). */
  joinPath: string | null;
  joinToken: string | null;
  linkedToLogin: boolean;
  counts?: Record<string, number>;
}

export const seedDemoCreator = internalMutation({
  args: {},
  handler: async (ctx): Promise<SeedResult> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", REPACKIT_SLUG))
      .first();
    if (!project) {
      throw new ConvexError(
        `Projet "${REPACKIT_SLUG}" introuvable — lance d'abord migrations:setupRepackitProject.`,
      );
    }
    const projectId = project._id;
    const now = Date.now();

    // ── Idempotence : un seul créateur démo (clé = email). ───────────────────
    const existing = (
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).find((c) => c.email === DEMO_CREATOR_EMAIL);
    if (existing) {
      const inv = (
        await ctx.db
          .query("invitations")
          .withIndex("by_creator", (q) => q.eq("creatorId", existing._id))
          .collect()
      ).find((i) => i.usedAt === undefined);
      return {
        ok: true,
        skipped: true,
        message:
          "Démo déjà présente — rien créé. Pour rafraîchir : cleanupDemoData puis seedDemoCreator.",
        creatorId: existing._id,
        demoEmail: DEMO_CREATOR_EMAIL,
        joinPath: inv ? `/join/${inv.token}` : null,
        joinToken: inv?.token ?? null,
        linkedToLogin: existing.userId !== undefined,
      };
    }

    // ── 1. Créateur (status "invited" pour permettre le login portail) ───────
    const creatorId = await ctx.db.insert("creators", {
      projectId,
      name: DEMO_CREATOR_NAME,
      email: DEMO_CREATOR_EMAIL,
      status: "invited",
      paymentMethod: "paypal",
      paymentDetails: "antho.test@paypal.me (démo)",
      adminNotes: `${DEMO_MARKER} Créateur de démonstration — effaçable via cleanupDemoData.`,
      createdAt: now,
    });

    const token = crypto.randomUUID();
    await ctx.db.insert("invitations", {
      token,
      creatorId,
      projectId,
      email: DEMO_CREATOR_EMAIL,
      expiresAt: now + 365 * DAY, // long, c'est de la démo
    });

    // ── 2. Comptes (variété de plateformes/statuts) ──────────────────────────
    const ttId = await ctx.db.insert("comptes", {
      projectId,
      handle: "@antho_test_tt",
      plateforme: "TikTok",
      notes: `${DEMO_MARKER} compte démo`,
      status: "warmup",
      warmupStartedAt: now - 3 * DAY,
      actif: false,
      creatorId,
      url: "https://www.tiktok.com/@antho_test_tt",
      warmupProtocol: {
        keywords: ["repackit", "carrousel", "faceless"],
        instructions: `${DEMO_MARKER} Like 10 vidéos, commente 3, 15 min de scroll par jour.`,
        targetDays: 14,
        dailyChecks: [ymd(now - 2 * DAY), ymd(now - 1 * DAY), ymd(now)],
        updatedAt: now,
      },
    });
    const ytId = await ctx.db.insert("comptes", {
      projectId,
      handle: "@anthotest",
      plateforme: "YouTube",
      notes: `${DEMO_MARKER} compte démo`,
      status: "actif",
      actif: true,
      creatorId,
      url: "https://www.youtube.com/@anthotest",
    });
    const igId = await ctx.db.insert("comptes", {
      projectId,
      handle: "@antho.test",
      plateforme: "Instagram",
      notes: `${DEMO_MARKER} compte démo`,
      status: "warmup",
      warmupStartedAt: now - 1 * DAY,
      actif: false,
      creatorId,
      url: "https://www.instagram.com/antho.test",
      warmupProtocol: {
        keywords: ["repack", "ugc", "growth"],
        instructions: `${DEMO_MARKER} Engage 15 min/jour sur la niche.`,
        targetDays: 21,
        dailyChecks: [ymd(now)],
        updatedAt: now,
      },
    });

    // ── Format démo (brief consommé par les assignments format) ──────────────
    const formatId = await ctx.db.insert("formats", {
      projectId,
      name: `${DEMO_MARKER} Format vidéo test`,
      type: "short",
      brief: `${DEMO_MARKER} Refais la vidéo source en voix-off, hook < 2s, sous-titres.`,
      hooks: [
        "Tu fais ça mal depuis des années",
        "Personne te l'a dit, mais…",
      ],
      guidelines: {
        do: ["Sous-titres lisibles", "Hook dans les 2 premières secondes"],
        dont: ["Watermark d'une autre app", "Musique sous copyright"],
      },
      // Exemples vidéo LISIBLES in-app côté créateur (section « Vidéos exemples »
      // du brief). Liens (kind "url") plutôt qu'un MP4 : un seed ne peut pas
      // uploader d'octets dans le storage. Pour tester le rendu d'un FICHIER
      // (MP4/MOV), l'admin en attache un à la main au format.
      exampleVideos: [
        {
          kind: "url",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          platform: "youtube",
          title: `${DEMO_MARKER} Exemple YouTube`,
        },
        {
          kind: "url",
          url: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
          platform: "tiktok",
          title: `${DEMO_MARKER} Exemple TikTok`,
        },
      ],
      rateModel: DEMO_RATE,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    // ── 3. Assignments (statuts variés) ──────────────────────────────────────
    const counts: Record<string, number> = {
      comptes: 3,
      assignments: 0,
      publications: 0,
      snapshots: 0,
    };

    type AssignmentFields = Omit<
      Partial<WithoutSystemFields<Doc<"assignments">>>,
      "projectId" | "creatorId" | "rateSnapshot" | "createdAt"
    > & { status: Doc<"assignments">["status"]; dueDate: number };
    const insertAssignment = async (
      fields: AssignmentFields,
    ): Promise<Id<"assignments">> => {
      counts.assignments += 1;
      return ctx.db.insert("assignments", {
        projectId,
        creatorId,
        rateSnapshot: DEMO_RATE,
        createdAt: now,
        ...fields,
      });
    };

    // todo (à temps)
    await insertAssignment({
      formatId,
      accountId: ytId,
      dueDate: now + 5 * DAY,
      status: "todo",
    });
    // todo (EN RETARD — dueDate passée)
    await insertAssignment({
      formatId,
      accountId: ttId,
      dueDate: now - 2 * DAY,
      status: "todo",
    });
    // in_progress
    await insertAssignment({
      formatId,
      accountId: igId,
      dueDate: now + 3 * DAY,
      status: "in_progress",
    });
    // video_submitted (en attente de revue admin). NB : un seed ne peut pas
    // uploader d'octets → pas de submittedVideoStorageId ici ; le rendu du MP4
    // dans la file de revue se teste manuellement (un créateur uploade pour de
    // vrai). Ce statut couvre néanmoins le badge + la file côté admin.
    await insertAssignment({
      formatId,
      accountId: ytId,
      dueDate: now - 1 * DAY,
      status: "video_submitted",
    });
    // video_rejected (feedback admin visible créateur → re-upload).
    await insertAssignment({
      formatId,
      accountId: ttId,
      dueDate: now + 1 * DAY,
      status: "video_rejected",
      videoReviewFeedback: `${DEMO_MARKER} Hook trop long — coupe les 2 premières secondes et resoumets.`,
    });
    // to_publish (vidéo validée → déclenche la notif « à publier » côté créateur).
    await insertAssignment({
      formatId,
      accountId: igId,
      dueDate: now + 2 * DAY,
      status: "to_publish",
    });

    // Matérialise une publication [DEMO] + quelques snapshots de vues.
    const materialize = async (args: {
      assignmentId: Id<"assignments">;
      plateforme: "TikTok" | "Instagram" | "YouTube";
      compte: string;
      datePubli: number;
      postUrl: string;
      views: [number, number, number]; // J+1, J+3, J+7
      scriptCombo?: {
        campaignId: Id<"scriptCampaigns">;
        hookBrickId: Id<"scriptBricks">;
        corpsBrickId: Id<"scriptBricks">;
        fluxBrickId: Id<"scriptBricks">;
        ctaBrickId: Id<"scriptBricks">;
        comboKey: string;
      };
    }): Promise<Id<"publications">> => {
      const pubId = await ctx.runMutation(
        internal.publications.createFromAssignment,
        {
          projectId,
          mediaType: "short",
          plateforme: args.plateforme,
          compte: args.compte,
          datePubli: args.datePubli,
          postUrl: args.postUrl,
          scriptCombo: args.scriptCombo,
        },
      );
      await ctx.db.patch(pubId, {
        notes: `${DEMO_MARKER} publication de démonstration`,
      });
      await ctx.db.patch(args.assignmentId, { publicationId: pubId });
      counts.publications += 1;

      const ages = [1, 3, 7] as const;
      for (let i = 0; i < ages.length; i++) {
        const capturedAt = args.datePubli + ages[i] * DAY;
        await ctx.db.insert("metricSnapshots", {
          projectId,
          publicationId: pubId,
          capturedAt,
          daysSincePublication: ages[i],
          vues: args.views[i],
          likes: Math.round(args.views[i] * 0.06),
          createdAt: now,
          source: "manual",
        });
        counts.snapshots += 1;
      }
      return pubId;
    };

    // published #1 (FORMAT, YouTube) → publication + snapshots + base
    const datePubli1 = now - 7 * DAY;
    const aVal1 = await insertAssignment({
      formatId,
      accountId: ytId,
      dueDate: now - 5 * DAY,
      status: "published",
      publishedUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
      publishedAt: datePubli1,
      submittedPlatform: "YouTube",
    });
    await materialize({
      assignmentId: aVal1,
      plateforme: "YouTube",
      compte: "@anthotest",
      datePubli: datePubli1,
      postUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
      views: [1200, 5400, 18900],
    });
    await accrueBaseLineItem(ctx, {
      projectId,
      creatorId,
      assignmentId: aVal1,
      label: `${DEMO_MARKER} Base — vidéo YouTube`,
      amount: DEMO_RATE.basePerPost,
      now,
    });

    // validated #2 (SCRIPT combo si une campagne existe, sinon FORMAT) →
    // publication + snapshots + base + BONUS de vues.
    const combo = await pickDemoCombo(ctx, projectId);
    const datePubli2 = now - 6 * DAY;
    const aVal2 = await insertAssignment({
      formatId: combo ? undefined : formatId,
      scriptCombo: combo?.assignmentCombo,
      comboKey: combo?.comboKey,
      accountId: ttId,
      dueDate: now - 4 * DAY,
      status: "published",
      publishedUrl: "https://www.tiktok.com/@antho_test_tt/video/7300000000000001",
      publishedAt: datePubli2,
      submittedPlatform: "TikTok",
    });
    await materialize({
      assignmentId: aVal2,
      plateforme: "TikTok",
      compte: "@antho_test_tt",
      datePubli: datePubli2,
      postUrl: "https://www.tiktok.com/@antho_test_tt/video/7300000000000001",
      views: [3000, 12000, 41000],
      scriptCombo: combo?.publicationCombo,
    });
    await accrueBaseLineItem(ctx, {
      projectId,
      creatorId,
      assignmentId: aVal2,
      label: `${DEMO_MARKER} Base — vidéo TikTok`,
      amount: DEMO_RATE.basePerPost,
      now,
    });
    // Bonus de vues : 41k vues × 1 €/1k ≈ 41 €.
    await upsertBonusLineItem(ctx, {
      projectId,
      creatorId,
      assignmentId: aVal2,
      label: `${DEMO_MARKER} Bonus vues (41k)`,
      amount: 41,
      now,
    });

    // paid (FORMAT, YouTube) → publication + snapshots + paiement PAYÉ (mois -1)
    const paidMonthNow = now - 32 * DAY;
    const datePubli3 = paidMonthNow;
    const aPaid = await insertAssignment({
      formatId,
      accountId: ytId,
      dueDate: paidMonthNow - 2 * DAY,
      status: "paid",
      publishedUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      publishedAt: datePubli3,
      submittedPlatform: "YouTube",
    });
    await materialize({
      assignmentId: aPaid,
      plateforme: "YouTube",
      compte: "@anthotest",
      datePubli: datePubli3,
      postUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      views: [4000, 15000, 52000],
    });
    await accrueBaseLineItem(ctx, {
      projectId,
      creatorId,
      assignmentId: aPaid,
      label: `${DEMO_MARKER} Base — vidéo YouTube`,
      amount: DEMO_RATE.basePerPost,
      now: paidMonthNow,
    });
    // Marque le paiement de la période passée comme PAYÉ.
    const pastPeriod = periodOf(paidMonthNow);
    const pastPayment = (
      await ctx.db
        .query("payments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).find((p) => p.period === pastPeriod);
    if (pastPayment) {
      await ctx.db.patch(pastPayment._id, {
        status: "paid",
        scheduledDate: paidMonthNow + 3 * DAY,
        paidAt: paidMonthNow + 5 * DAY,
      });
    }

    return {
      ok: true,
      skipped: false,
      message:
        "Démo créée. Ouvre le lien d'invitation pour accéder au portail créateur.",
      creatorId,
      demoEmail: DEMO_CREATOR_EMAIL,
      joinPath: `/join/${token}`,
      joinToken: token,
      linkedToLogin: false,
      counts,
    };
  },
});

export interface CleanupResult {
  ok: boolean;
  counts: Record<string, number>;
}

/**
 * Efface TOUT le démo (et RIEN d'autre) : cible le marqueur [DEMO] et la fiche
 * créateur démo (par email), puis cascade. Idempotent (relançable). NE touche
 * pas aux tables Convex Auth (users/authAccounts) : le membership "creator" du
 * login démo est retiré (plus d'accès projet) ; le compte de login lui-même
 * reste inerte côté auth (suppression hors scope, sans risque).
 */
export const cleanupDemoData = internalMutation({
  args: {},
  handler: async (ctx): Promise<CleanupResult> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", REPACKIT_SLUG))
      .first();
    if (!project) {
      throw new ConvexError(`Projet "${REPACKIT_SLUG}" introuvable.`);
    }
    const projectId = project._id;
    const counts: Record<string, number> = {
      creators: 0,
      comptes: 0,
      assignments: 0,
      publications: 0,
      snapshots: 0,
      payments: 0,
      invitations: 0,
      formats: 0,
      memberships: 0,
    };

    const demoCreators = (
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).filter(
      (c) =>
        c.email === DEMO_CREATOR_EMAIL ||
        c.name.includes(DEMO_MARKER) ||
        (c.adminNotes?.startsWith(DEMO_MARKER) ?? false),
    );

    const pubIds = new Set<Id<"publications">>();

    for (const creator of demoCreators) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .collect();
      for (const a of assignments) {
        if (a.publicationId) pubIds.add(a.publicationId);
        await ctx.db.delete(a._id);
        counts.assignments += 1;
      }

      const comptes = await ctx.db
        .query("comptes")
        .withIndex("by_project_creator", (q) =>
          q.eq("projectId", projectId).eq("creatorId", creator._id),
        )
        .collect();
      for (const c of comptes) {
        await ctx.db.delete(c._id);
        counts.comptes += 1;
      }

      const payments = await ctx.db
        .query("payments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .collect();
      for (const p of payments) {
        await ctx.db.delete(p._id);
        counts.payments += 1;
      }

      const invitations = await ctx.db
        .query("invitations")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .collect();
      for (const inv of invitations) {
        await ctx.db.delete(inv._id);
        counts.invitations += 1;
      }

      const uid = creator.userId;
      if (uid) {
        const memberships = await ctx.db
          .query("memberships")
          .withIndex("by_user_project", (q) =>
            q.eq("userId", uid).eq("projectId", projectId),
          )
          .collect();
        for (const m of memberships) {
          if (m.role === "creator") {
            await ctx.db.delete(m._id);
            counts.memberships += 1;
          }
        }
      }

      await ctx.db.delete(creator._id);
      counts.creators += 1;
    }

    // Filet de sécurité : publications marquées [DEMO] non rattachées à un
    // assignment démo (matérialisation orpheline).
    const demoPubs = (
      await ctx.db
        .query("publications")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).filter((p) => p.notes.startsWith(DEMO_MARKER));
    for (const p of demoPubs) pubIds.add(p._id);

    for (const pubId of pubIds) {
      const snaps = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication", (q) => q.eq("publicationId", pubId))
        .collect();
      for (const s of snaps) {
        await ctx.db.delete(s._id);
        counts.snapshots += 1;
      }
      const pub = await ctx.db.get(pubId);
      if (pub) {
        await ctx.db.delete(pub._id);
        counts.publications += 1;
      }
    }

    const demoFormats = (
      await ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).filter((f) => f.name.includes(DEMO_MARKER));
    for (const f of demoFormats) {
      await ctx.db.delete(f._id);
      counts.formats += 1;
    }

    return { ok: true, counts };
  },
});

/**
 * Cherche une campagne de scripts avec au moins une brick active de chaque kind
 * et en compose un combo pour l'assignment + la publication démo (raccord
 * analytics S3/S4). `null` si aucune campagne exploitable → l'appelant retombe
 * sur un assignment de FORMAT.
 */
async function pickDemoCombo(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<{
  comboKey: string;
  assignmentCombo: {
    campaignId: Id<"scriptCampaigns">;
    hookBrickId: Id<"scriptBricks">;
    corpsBrickId: Id<"scriptBricks">;
    fluxBrickId: Id<"scriptBricks">;
    ctaBrickId: Id<"scriptBricks">;
    assembledScript: string;
  };
  publicationCombo: {
    campaignId: Id<"scriptCampaigns">;
    hookBrickId: Id<"scriptBricks">;
    corpsBrickId: Id<"scriptBricks">;
    fluxBrickId: Id<"scriptBricks">;
    ctaBrickId: Id<"scriptBricks">;
    comboKey: string;
  };
} | null> {
  const campaigns = await ctx.db
    .query("scriptCampaigns")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const campaign of campaigns) {
    const bricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();
    const pick = (kind: string) => bricks.find((b) => b.active && b.kind === kind);
    const hook = pick("hook");
    const corps = pick("corps");
    const flux = pick("flux");
    const cta = pick("cta");
    if (!hook || !corps || !flux || !cta) continue;
    const comboKey = `${hook._id}:${corps._id}:${flux._id}:${cta._id}`;
    const ids = {
      campaignId: campaign._id,
      hookBrickId: hook._id,
      corpsBrickId: corps._id,
      fluxBrickId: flux._id,
      ctaBrickId: cta._id,
    };
    const assembledScript = [
      hook.content,
      corps.content,
      flux.content,
      cta.content,
      campaign.demoBlock,
    ].join("\n\n");
    return {
      comboKey,
      assignmentCombo: { ...ids, assembledScript },
      publicationCombo: { ...ids, comboKey },
    };
  }
  return null;
}
