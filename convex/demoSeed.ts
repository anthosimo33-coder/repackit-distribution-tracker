import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { REPACKIT_SLUG } from "./projects";
import { accrueBaseLineItem, upsertBonusLineItem, periodOf } from "./payments";
import { defaultTargetDays, warmupTargetDaysOf } from "./warmup";
import {
  deleteStorageBestEffort,
  purgePublicationImage,
} from "./storageCleanup";

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
 * Portail créateur — DEUX cas :
 *  - Aucun login démo existant → fiche "invited" + invitation. Le résultat
 *    imprime /join/<token> ; Serge l'ouvre, choisit un mot de passe (email
 *    pré-rempli DEMO_CREATOR_EMAIL) → son login est créé et lié (auth.ts exige
 *    status "invited" pour consommer le token ; passe à "onboarding" à l'accept).
 *  - Un login démo existe déjà (orphelin laissé par un essai précédent) → la
 *    fiche est RELIÉE dessus (status "onboarding", linkedToLogin true) :
 *    connexion DIRECTE avec l'email démo + le mot de passe existant, sans /join.
 *
 * cleanupDemoData efface AUSSI ce login (cascade Convex Auth) → cleanup → seed
 * repart toujours d'un état vierge.
 *
 * ⚠️ TS7022 — seedDemoCreator appelle ctx.runMutation(internal.*) : type de
 * retour ANNOTÉ.
 */

const DAY = 86_400_000;
const DEMO_MARKER = "[DEMO]";
type Plateforme = "TikTok" | "Instagram" | "YouTube";
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

// ─── Login démo : détection / cascade Convex Auth ────────────────────────────

/** Le login démo (users par email démo), s'il existe (orphelin ou lié). */
async function findDemoLoginUser(
  ctx: MutationCtx,
): Promise<Id<"users"> | null> {
  const u = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", DEMO_CREATOR_EMAIL))
    .first();
  return u?._id ?? null;
}

/** Garantit un membership "creator" (userId, repackit) — idempotent. */
async function ensureCreatorMembership(
  ctx: MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<void> {
  const existing = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (!existing) {
    await ctx.db.insert("memberships", { userId, projectId, role: "creator" });
  }
}

/**
 * Efface COMPLÈTEMENT un login démo (cascade Convex Auth) : memberships,
 * authSessions (+ authRefreshTokens enfants), authAccounts (+
 * authVerificationCodes enfants), puis la row users. Appelé UNIQUEMENT pour le
 * login démo (creator.userId du démo OU users d'email DEMO_CREATOR_EMAIL) →
 * strictement scopé démo, zéro risque sur un vrai compte. Idempotent.
 */
async function deleteDemoLogin(
  ctx: MutationCtx,
  userId: Id<"users">,
  counts: Record<string, number>,
): Promise<void> {
  for (const m of await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) {
    await ctx.db.delete(m._id);
    counts.memberships += 1;
  }
  for (const s of await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect()) {
    for (const rt of await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
      .collect()) {
      await ctx.db.delete(rt._id);
      counts.authRefreshTokens += 1;
    }
    await ctx.db.delete(s._id);
    counts.authSessions += 1;
  }
  for (const acc of await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect()) {
    for (const code of await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", acc._id))
      .collect()) {
      await ctx.db.delete(code._id);
      counts.authVerificationCodes += 1;
    }
    await ctx.db.delete(acc._id);
    counts.authAccounts += 1;
  }
  const user = await ctx.db.get(userId);
  if (user) {
    await ctx.db.delete(userId);
    counts.users += 1;
  }
}

/** Diagnostic : combien de logins démo (orphelins ou non) restent. Pour vérifier
 *  qu'un cycle cleanup→seed repart bien d'un état vierge. Lecture seule. */
export const inspectDemoLogin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", DEMO_CREATOR_EMAIL))
      .collect();
    let authAccounts = 0;
    let authSessions = 0;
    for (const u of users) {
      authAccounts += (
        await ctx.db
          .query("authAccounts")
          .withIndex("userIdAndProvider", (q) => q.eq("userId", u._id))
          .collect()
      ).length;
      authSessions += (
        await ctx.db
          .query("authSessions")
          .withIndex("userId", (q) => q.eq("userId", u._id))
          .collect()
      ).length;
    }
    return {
      demoEmail: DEMO_CREATOR_EMAIL,
      users: users.length,
      authAccounts,
      authSessions,
    };
  },
});

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
    // Barème DU PROJET : un seed démo figé sur un défaut global mentirait sur
    // le produit qu'il illustre.
    const demoDays = warmupTargetDaysOf(project);
    const now = Date.now();

    // ── Idempotence : un seul créateur démo (clé = email). ───────────────────
    const existing = (
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).find((c) => c.email === DEMO_CREATOR_EMAIL);
    if (existing) {
      // ROBUSTESSE : fiche non reliée + login orphelin d'email démo → on les
      // relie (Serge se connecte directement avec son mot de passe existant).
      if (existing.userId === undefined) {
        const orphanId = await findDemoLoginUser(ctx);
        if (orphanId) {
          await ctx.db.patch(existing._id, {
            userId: orphanId,
            status: "onboarding",
          });
          await ensureCreatorMembership(ctx, orphanId, projectId);
          return {
            ok: true,
            skipped: true,
            message:
              "Démo déjà présente : fiche reliée au login existant — connecte-toi directement avec l'email démo + ton mot de passe.",
            creatorId: existing._id,
            demoEmail: DEMO_CREATOR_EMAIL,
            joinPath: null,
            joinToken: null,
            linkedToLogin: true,
          };
        }
      }
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

    // ── 1. Créateur. Si un login orphelin d'email démo existe, on RELIE la fiche
    //   dessus (status "onboarding") → connexion DIRECTE, pas de /join. Sinon
    //   fiche "invited" + invitation (Serge ouvre /join pour créer son login). ─
    const orphanLoginId = await findDemoLoginUser(ctx);
    const creatorId = await ctx.db.insert("creators", {
      projectId,
      name: DEMO_CREATOR_NAME,
      email: DEMO_CREATOR_EMAIL,
      status: orphanLoginId ? "onboarding" : "invited",
      paymentMethod: "paypal",
      paymentDetails: "antho.test@paypal.me (démo)",
      adminNotes: `${DEMO_MARKER} Créateur de démonstration — effaçable via cleanupDemoData.`,
      createdAt: now,
      ...(orphanLoginId ? { userId: orphanLoginId } : {}),
    });

    let token: string | null = null;
    if (orphanLoginId) {
      await ensureCreatorMembership(ctx, orphanLoginId, projectId);
    } else {
      token = crypto.randomUUID();
      await ctx.db.insert("invitations", {
        token,
        creatorId,
        projectId,
        email: DEMO_CREATOR_EMAIL,
        expiresAt: now + 365 * DAY, // long, c'est de la démo
      });
    }

    // ── 2. Comptes (variété de plateformes/statuts + ÉTATS DE WARMUP variés
    //   pour voir la notif « à faire aujourd'hui » et le rattrapage) :
    //   - TikTok @antho_test_tt : warmup TERMINÉ (3/3 checks) → badge « À valider ».
    //   - YouTube @antho_test_yt : warmup À JOUR, coché AUJOURD'HUI (1/3).
    //   - Instagram @antho.test : warmup EN RETARD à rattraper (2/14, dernier
    //     check il y a 3 j, RIEN aujourd'hui) → compte « à faire aujourd'hui ».
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
        targetDays: defaultTargetDays("TikTok", demoDays),
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
    // YouTube en WARMUP (distinct du compte YouTube actif ci-dessus, qui porte
    // les publications) — expose le décompte /3 du barème côté YouTube dans la
    // démo. Pas d'assignment dessus (un compte en warmup n'est pas publiable).
    await ctx.db.insert("comptes", {
      projectId,
      handle: "@antho_test_yt",
      plateforme: "YouTube",
      notes: `${DEMO_MARKER} compte démo`,
      status: "warmup",
      warmupStartedAt: now - 1 * DAY,
      actif: false,
      creatorId,
      url: "https://www.youtube.com/@antho_test_yt",
      warmupProtocol: {
        keywords: ["repackit", "shorts", "faceless"],
        instructions: `${DEMO_MARKER} Regarde 10 Shorts, like 5, commente 2 par jour.`,
        targetDays: defaultTargetDays("YouTube", demoDays),
        dailyChecks: [ymd(now)],
        updatedAt: now,
      },
    });
    await ctx.db.insert("comptes", {
      projectId,
      handle: "@antho.test",
      plateforme: "Instagram",
      notes: `${DEMO_MARKER} compte démo`,
      status: "warmup",
      // EN RETARD : démarré il y a 4 j, mais seulement 2 checks (J-4, J-3), puis
      // 2 jours sautés et RIEN aujourd'hui → 2/14, « à faire aujourd'hui » +
      // 2 jours manqués côté admin. Le compteur n'a pas avancé sur les jours ratés.
      warmupStartedAt: now - 4 * DAY,
      actif: false,
      creatorId,
      url: "https://www.instagram.com/antho.test",
      warmupProtocol: {
        keywords: ["repack", "ugc", "growth"],
        instructions: `${DEMO_MARKER} Engage 15 min/jour sur la niche.`,
        targetDays: defaultTargetDays("Instagram", demoDays),
        dailyChecks: [ymd(now - 4 * DAY), ymd(now - 3 * DAY)],
        updatedAt: now,
      },
    });
    // Instagram ACTIF (disponible) — sert de CIBLE multi-plateforme. Distinct du
    // @antho.test ci-dessus (en warmup → jamais une cible). Permet un assignment
    // 3-cibles (TikTok + YouTube + Instagram) côté démo.
    const igAvailId = await ctx.db.insert("comptes", {
      projectId,
      handle: "@antho.repackit",
      plateforme: "Instagram",
      notes: `${DEMO_MARKER} compte démo`,
      status: "actif",
      actif: true,
      creatorId,
      url: "https://www.instagram.com/antho.repackit",
    });
    // Compte ARCHIVÉ (action admin) — visualise l'état « archivé » : grisé côté
    // admin, EXCLU des cibles d'assignment (isAccountAvailable), warmup gelé
    // (plus de notif créateur). Vierge → suppressible ; sert aussi à montrer le
    // badge « Archivé ».
    await ctx.db.insert("comptes", {
      projectId,
      handle: "@antho.archived",
      plateforme: "Instagram",
      notes: `${DEMO_MARKER} compte démo (archivé)`,
      status: "archived",
      actif: false,
      creatorId,
      url: "https://www.instagram.com/antho.archived",
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

    // ── 3. Assignments MULTI-CIBLES (1 vidéo → N posts), statuts variés ───────
    // Cibles UNIQUEMENT sur des comptes DISPONIBLES (ttId warmup terminé, ytId
    // actif, igAvailId actif). Les comptes en warmup (@antho_test_yt, @antho.test)
    // ne sont JAMAIS des cibles (contrainte de disponibilité du modèle).
    const counts: Record<string, number> = {
      comptes: 6,
      assignments: 0,
      publications: 0,
      snapshots: 0,
    };

    const handleOf = (id: Id<"comptes">): string =>
      id === ttId ? "@antho_test_tt" : id === ytId ? "@anthotest" : "@antho.repackit";

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

    // 1 cible — todo (à temps).
    await insertAssignment({
      formatId,
      targets: [{ platform: "YouTube", accountId: ytId }],
      dueDate: now + 5 * DAY,
      status: "todo",
    });
    // 1 cible — todo (EN RETARD — dueDate passée).
    await insertAssignment({
      formatId,
      targets: [{ platform: "TikTok", accountId: ttId }],
      dueDate: now - 2 * DAY,
      status: "todo",
    });
    // 2 cibles — in_progress.
    await insertAssignment({
      formatId,
      targets: [
        { platform: "TikTok", accountId: ttId },
        { platform: "Instagram", accountId: igAvailId },
      ],
      dueDate: now + 3 * DAY,
      status: "in_progress",
    });
    // 1 cible — video_submitted (file de revue admin). NB : un seed ne peut pas
    // uploader d'octets → pas de submittedVideoStorageId ici ; le rendu du MP4
    // dans la file se teste manuellement.
    await insertAssignment({
      formatId,
      targets: [{ platform: "YouTube", accountId: ytId }],
      dueDate: now - 1 * DAY,
      status: "video_submitted",
    });
    // 1 cible — video_rejected (feedback admin visible créateur → re-upload).
    await insertAssignment({
      formatId,
      targets: [{ platform: "TikTok", accountId: ttId }],
      dueDate: now + 1 * DAY,
      status: "video_rejected",
      videoReviewFeedback: `${DEMO_MARKER} Hook trop long — coupe les 2 premières secondes et resoumets.`,
    });
    // 2 cibles — to_publish (montre 2 champs d'URL côté créateur + notif « à publier »).
    await insertAssignment({
      formatId,
      targets: [
        { platform: "TikTok", accountId: ttId },
        { platform: "YouTube", accountId: ytId },
      ],
      dueDate: now + 2 * DAY,
      status: "to_publish",
    });

    // Matérialise UNE publication [DEMO] + snapshots de vues, renvoie l'id.
    const materializePub = async (args: {
      plateforme: Plateforme;
      compte: string;
      datePubli: number;
      postUrl: string;
      views: [number, number, number]; // J+1, J+3, J+7
      scriptCombo?: {
        campaignId: Id<"scriptCampaigns">;
        hookBrickId: Id<"scriptBricks">;
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
      counts.publications += 1;
      const ages = [1, 3, 7] as const;
      for (let i = 0; i < ages.length; i++) {
        await ctx.db.insert("metricSnapshots", {
          projectId,
          publicationId: pubId,
          capturedAt: args.datePubli + ages[i] * DAY,
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

    // published #1 — FORMAT, 3 CIBLES (TikTok + YouTube + Instagram) → 3 pubs +
    // 3 lineItems BASE (paiement PAR POST = 3 × base). Le showcase « 1 vidéo → 3 posts ».
    const datePubli1 = now - 7 * DAY;
    const pub1 = [
      {
        platform: "TikTok" as const,
        accountId: ttId,
        postUrl: "https://www.tiktok.com/@antho_test_tt/video/7300000000000010",
        views: [3000, 12000, 41000] as [number, number, number],
      },
      {
        platform: "YouTube" as const,
        accountId: ytId,
        postUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
        views: [1200, 5400, 18900] as [number, number, number],
      },
      {
        platform: "Instagram" as const,
        accountId: igAvailId,
        postUrl: "https://www.instagram.com/reel/Cabc123demo/",
        views: [800, 3200, 9700] as [number, number, number],
      },
    ];
    const builtTargets1: NonNullable<Doc<"assignments">["targets"]> = [];
    for (const t of pub1) {
      const pubId = await materializePub({
        plateforme: t.platform,
        compte: handleOf(t.accountId),
        datePubli: datePubli1,
        postUrl: t.postUrl,
        views: t.views,
      });
      builtTargets1.push({
        platform: t.platform,
        accountId: t.accountId,
        publishedUrl: t.postUrl,
        publishedAt: datePubli1,
        publicationId: pubId,
      });
    }
    const aVal1 = await insertAssignment({
      formatId,
      targets: builtTargets1,
      dueDate: now - 5 * DAY,
      status: "published",
    });
    for (const t of pub1) {
      await accrueBaseLineItem(ctx, {
        projectId,
        creatorId,
        assignmentId: aVal1,
        label: `${DEMO_MARKER} Base — ${t.platform}`,
        amount: DEMO_RATE.basePerPost,
        now,
        platform: t.platform,
      });
    }

    // published #2 — SCRIPT combo (1 cible TikTok) → pub + base + BONUS de vues.
    const combo = await pickDemoCombo(ctx, projectId);
    const datePubli2 = now - 6 * DAY;
    const pub2Url =
      "https://www.tiktok.com/@antho_test_tt/video/7300000000000001";
    const pub2Id = await materializePub({
      plateforme: "TikTok",
      compte: "@antho_test_tt",
      datePubli: datePubli2,
      postUrl: pub2Url,
      views: [3000, 12000, 41000],
      scriptCombo: combo?.publicationCombo,
    });
    const aVal2 = await insertAssignment({
      formatId: combo ? undefined : formatId,
      scriptCombo: combo?.assignmentCombo,
      comboKey: combo?.comboKey,
      targets: [
        {
          platform: "TikTok",
          accountId: ttId,
          publishedUrl: pub2Url,
          publishedAt: datePubli2,
          publicationId: pub2Id,
        },
      ],
      dueDate: now - 4 * DAY,
      status: "published",
    });
    await accrueBaseLineItem(ctx, {
      projectId,
      creatorId,
      assignmentId: aVal2,
      label: `${DEMO_MARKER} Base — TikTok`,
      amount: DEMO_RATE.basePerPost,
      now,
      platform: "TikTok",
    });
    // Bonus de vues : 41k vues × 1 $/1k ≈ 41 $ (somme sur les cibles — ici 1).
    await upsertBonusLineItem(ctx, {
      projectId,
      creatorId,
      assignmentId: aVal2,
      label: `${DEMO_MARKER} Bonus vues (41k)`,
      amount: 41,
      now,
    });

    // paid — FORMAT, 1 cible YouTube → pub + base + paiement PAYÉ (mois -1).
    const paidMonthNow = now - 32 * DAY;
    const datePubli3 = paidMonthNow;
    const paidUrl = "https://www.youtube.com/watch?v=9bZkp7q19f0";
    const pub3Id = await materializePub({
      plateforme: "YouTube",
      compte: "@anthotest",
      datePubli: datePubli3,
      postUrl: paidUrl,
      views: [4000, 15000, 52000],
    });
    const aPaid = await insertAssignment({
      formatId,
      targets: [
        {
          platform: "YouTube",
          accountId: ytId,
          publishedUrl: paidUrl,
          publishedAt: datePubli3,
          publicationId: pub3Id,
        },
      ],
      dueDate: paidMonthNow - 2 * DAY,
      status: "paid",
    });
    await accrueBaseLineItem(ctx, {
      projectId,
      creatorId,
      assignmentId: aPaid,
      label: `${DEMO_MARKER} Base — YouTube`,
      amount: DEMO_RATE.basePerPost,
      now: paidMonthNow,
      platform: "YouTube",
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
      message: token
        ? "Démo créée. Ouvre le lien d'invitation pour accéder au portail créateur."
        : "Démo créée et reliée au login existant — connecte-toi directement avec l'email démo + ton mot de passe.",
      creatorId,
      demoEmail: DEMO_CREATOR_EMAIL,
      joinPath: token ? `/join/${token}` : null,
      joinToken: token,
      linkedToLogin: token === null,
      counts,
    };
  },
});

export interface CleanupResult {
  ok: boolean;
  counts: Record<string, number>;
}

/**
 * Efface TOUT le démo (et RIEN d'autre) : cible le marqueur [DEMO] / l'email démo,
 * puis cascade — Y COMPRIS le LOGIN démo (users + authAccounts + authSessions +
 * authRefreshTokens + authVerificationCodes + memberships), pour qu'un cycle
 * cleanup → seed reparte TOUJOURS d'un état vierge (sans login orphelin que le
 * re-seed ne pourrait ni réutiliser ni relier). Strictement scopé au démo
 * (email DEMO_CREATOR_EMAIL), zéro risque sur un vrai compte. Idempotent.
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
      users: 0,
      authAccounts: 0,
      authSessions: 0,
      authRefreshTokens: 0,
      authVerificationCodes: 0,
    };
    // Logins démo à purger : ceux liés aux fiches démo + tout login orphelin
    // d'email démo (laissé par un ancien cleanup buggé).
    const demoUserIds = new Set<Id<"users">>();

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
        // TD-011 — le seed n'uploade pas de vidéo, mais une soumission réelle
        // faite depuis le portail sur une mission démo en laisserait une.
        await deleteStorageBestEffort(ctx, a.submittedVideoStorageId);
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

      if (creator.userId) demoUserIds.add(creator.userId);

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
        await purgePublicationImage(ctx, pub);
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

    // PURGE des logins démo : ceux liés aux fiches + tout login orphelin
    // d'email démo. Cascade Convex Auth → aucun login orphelin ne survit.
    for (const u of await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", DEMO_CREATOR_EMAIL))
      .collect()) {
      demoUserIds.add(u._id);
    }
    for (const userId of demoUserIds) {
      await deleteDemoLogin(ctx, userId, counts);
    }

    return { ok: true, counts };
  },
});

/**
 * Cherche une campagne de scripts avec au moins une brick active de chaque kind
 * (hook/flux/cta) et en compose un combo pour l'assignment + la publication démo
 * (raccord analytics S3/S4). `null` si aucune campagne exploitable → l'appelant
 * retombe sur un assignment de FORMAT.
 *
 * Refonte 3 briques : combo hook/flux/cta, comboKey 3 segments, aucun socle démo.
 */
async function pickDemoCombo(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<{
  comboKey: string;
  assignmentCombo: {
    campaignId: Id<"scriptCampaigns">;
    hookBrickId: Id<"scriptBricks">;
    fluxBrickId: Id<"scriptBricks">;
    ctaBrickId: Id<"scriptBricks">;
    assembledScript: string;
  };
  publicationCombo: {
    campaignId: Id<"scriptCampaigns">;
    hookBrickId: Id<"scriptBricks">;
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
    const flux = pick("flux");
    const cta = pick("cta");
    if (!hook || !flux || !cta) continue;
    const comboKey = `${hook._id}:${flux._id}:${cta._id}`;
    const ids = {
      campaignId: campaign._id,
      hookBrickId: hook._id,
      fluxBrickId: flux._id,
      ctaBrickId: cta._id,
    };
    const assembledScript = [hook.content, flux.content, cta.content].join(
      "\n\n",
    );
    return {
      comboKey,
      assignmentCombo: { ...ids, assembledScript },
      publicationCombo: { ...ids, comboKey },
    };
  }
  return null;
}
