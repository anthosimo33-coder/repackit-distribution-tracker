import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { accrueBaseLineItem, upsertBonusLineItem, periodOf } from "./payments";
import { defaultTargetDays } from "./warmup";

/**
 * Seed de DÉMO MULTI-PROJETS — cible un COMPTE CRÉATEUR EXISTANT (par email,
 * ex. anthosimo33@gmail.com) qui est déjà membre de PLUSIEURS projets, et peuple
 * de la donnée démo RÉALISTE et DIFFÉRENTE sur CHACUN de ses projets, pour
 * tester en vrai le portail créateur (dashboard d'action, switcher, paiements).
 *
 * Tout est marqué `[DEMO-MP]` (distinct du `[DEMO]` de demoSeed.ts → aucune
 * collision avec l'autre seed) :
 *   - comptes.notes / publications.notes / formats.name commencent par [DEMO-MP] ;
 *   - lineItems de paiement labellisés [DEMO-MP] ;
 *   - les assignments démo sont reconnus via leur formatId (= un format [DEMO-MP]).
 *
 * GARDE-FOUS :
 *   - NE crée RIEN pour un autre compte (résolution stricte par email).
 *   - Le cleanup ne supprime QUE le démo [DEMO-MP] de ce compte sur ses projets ;
 *     il NE touche JAMAIS au user/login, aux memberships, ni aux fiches créateur
 *     (données réelles), ni au démo d'un autre créateur.
 *   - Idempotent : le seed nettoie son propre [DEMO-MP] par projet AVANT de
 *     recréer → relancer ne duplique pas.
 *
 * Lancement (prod) :
 *   npx convex run demoMultiProject:seedDemoForMultiProjectCreator '{"email":"anthosimo33@gmail.com"}' --prod
 *   npx convex run demoMultiProject:cleanupDemoForMultiProjectCreator '{"email":"anthosimo33@gmail.com"}' --prod
 *
 * ⚠️ TS7022 — materializePub appelle ctx.runMutation(internal.*) : retour ANNOTÉ.
 */

const DAY = 86_400_000;
const MP = "[DEMO-MP]";
type Plateforme = "TikTok" | "Instagram" | "YouTube";
type Counts = Record<string, number>;

/** "YYYY-MM-DD" UTC pour les dailyChecks de warmup. */
function ymd(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function emptyCounts(): Counts {
  return {
    comptes: 0,
    assignments: 0,
    publications: 0,
    snapshots: 0,
    payments: 0,
    formats: 0,
  };
}

/** Fiches créateur (par projet) du user, indexées par projectId. */
async function creatorFichesByProject(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Map<string, Id<"creators">>> {
  const fiches = await ctx.db
    .query("creators")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const map = new Map<string, Id<"creators">>();
  for (const f of fiches) map.set(f.projectId, f._id);
  return map;
}

/**
 * Supprime le démo [DEMO-MP] d'UN (projet, fiche créateur) : assignments démo
 * (formatId d'un format [DEMO-MP]) + leurs publications/snapshots, comptes démo,
 * publications démo orphelines, formats démo, et les lineItems [DEMO-MP] des
 * paiements (paiement supprimé si plus aucun lineItem). NE touche NI à la fiche
 * NI au membership NI au login.
 */
async function cleanupProjectDemo(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  counts: Counts,
): Promise<void> {
  const demoFormatIds = new Set<string>(
    (
      await ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    )
      .filter((f) => f.name.startsWith(MP))
      .map((f) => f._id),
  );

  const pubIds = new Set<Id<"publications">>();

  // Assignments démo de cette fiche (formatId = un format [DEMO-MP]).
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  for (const a of assignments) {
    if (!a.formatId || !demoFormatIds.has(a.formatId)) continue;
    if (a.publicationId) pubIds.add(a.publicationId);
    for (const t of a.targets ?? []) {
      if (t.publicationId) pubIds.add(t.publicationId);
    }
    await ctx.db.delete(a._id);
    counts.assignments += 1;
  }

  // Comptes démo de cette fiche.
  for (const c of await ctx.db
    .query("comptes")
    .withIndex("by_project_creator", (q) =>
      q.eq("projectId", projectId).eq("creatorId", creatorId),
    )
    .collect()) {
    if (!c.notes.startsWith(MP)) continue;
    await ctx.db.delete(c._id);
    counts.comptes += 1;
  }

  // Filet : publications démo du projet non rattachées (matérialisation orpheline).
  for (const p of await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()) {
    if (p.notes.startsWith(MP)) pubIds.add(p._id);
  }
  for (const pubId of pubIds) {
    for (const s of await ctx.db
      .query("metricSnapshots")
      .withIndex("by_publication", (q) => q.eq("publicationId", pubId))
      .collect()) {
      await ctx.db.delete(s._id);
      counts.snapshots += 1;
    }
    const pub = await ctx.db.get(pubId);
    if (pub) {
      await ctx.db.delete(pubId);
      counts.publications += 1;
    }
  }

  // Paiements : retire UNIQUEMENT les lineItems [DEMO-MP] ; supprime le paiement
  // s'il ne reste rien (sinon recalcule le total). Préserve tout lineItem réel.
  for (const pay of await ctx.db
    .query("payments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect()) {
    const remaining = pay.lineItems.filter((li) => !li.label.startsWith(MP));
    if (remaining.length === pay.lineItems.length) continue;
    if (remaining.length === 0) {
      await ctx.db.delete(pay._id);
      counts.payments += 1;
    } else {
      const totalDue =
        Math.round(remaining.reduce((s, li) => s + li.amount, 0) * 100) / 100;
      await ctx.db.patch(pay._id, { lineItems: remaining, totalDue });
    }
  }

  // Formats démo (en dernier : les assignments qui les référençaient sont partis).
  for (const fid of demoFormatIds) {
    await ctx.db.delete(fid as Id<"formats">);
    counts.formats += 1;
  }
}

/** Variante de données par projet (rang `i`) → tout est DIFFÉRENT par projet. */
function variantFor(i: number) {
  const vk = i + 1;
  return {
    rate: {
      basePerPost: 5 + i * 3, // 5, 8, 11 €…
      viewBonusPer1k: 1,
      bounties: [{ thresholdViews: 50_000, amount: 20 }],
    },
    produceTodos: 1 + i, // 1, 2, 3… vidéos à produire
    tkViews: [3_000 * vk, 12_000 * vk, 41_000 * vk] as [number, number, number],
    ytViews: [1_200 * vk, 5_400 * vk, 18_900 * vk] as [number, number, number],
    paidViews: [4_000 * vk, 15_000 * vk, 52_000 * vk] as [number, number, number],
  };
}

/** Peuple UN projet pour la fiche créateur donnée. Idempotent (pré-nettoie). */
async function seedProject(
  ctx: MutationCtx,
  opts: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    slug: string;
    index: number;
    now: number;
    counts: Counts;
  },
): Promise<void> {
  const { projectId, creatorId, slug, index, now, counts } = opts;
  // Idempotence : efface le démo [DEMO-MP] précédent de ce projet (compteurs jetés).
  await cleanupProjectDemo(ctx, projectId, creatorId, emptyCounts());

  const sfx = (slug.replace(/[^a-z0-9]/gi, "").slice(0, 8) || `p${index}`).toLowerCase();
  const variant = variantFor(index);
  const rate = variant.rate;

  // ── Comptes (états de warmup variés) ──────────────────────────────────────
  // cActif (YouTube, actif) + cDone (TikTok, warmup TERMINÉ) = cibles DISPONIBLES.
  // cProgress (Instagram, coché aujourd'hui) = à jour. cDue (TikTok, EN RETARD) =
  // « à cocher aujourd'hui » → alimente le bloc warmup du dashboard.
  const cActif = await ctx.db.insert("comptes", {
    projectId,
    handle: `@antho_${sfx}_yt`,
    plateforme: "YouTube",
    notes: `${MP} compte démo (actif)`,
    status: "actif",
    actif: true,
    creatorId,
    url: `https://www.youtube.com/@antho_${sfx}_yt`,
  });
  const ttDays = defaultTargetDays("TikTok");
  const cDone = await ctx.db.insert("comptes", {
    projectId,
    handle: `@antho_${sfx}_tt`,
    plateforme: "TikTok",
    notes: `${MP} compte démo (warmup terminé)`,
    status: "warmup",
    warmupStartedAt: now - ttDays * DAY,
    actif: false,
    creatorId,
    url: `https://www.tiktok.com/@antho_${sfx}_tt`,
    warmupProtocol: {
      keywords: ["repackit", "faceless", "ugc"],
      instructions: `${MP} Like 10 vidéos, commente 3, 15 min de scroll/jour.`,
      targetDays: ttDays,
      dailyChecks: Array.from({ length: ttDays }, (_, k) =>
        ymd(now - (ttDays - 1 - k) * DAY),
      ),
      updatedAt: now,
    },
  });
  await ctx.db.insert("comptes", {
    projectId,
    handle: `@antho_${sfx}_ig`,
    plateforme: "Instagram",
    notes: `${MP} compte démo (warmup en cours)`,
    status: "warmup",
    warmupStartedAt: now - 1 * DAY,
    actif: false,
    creatorId,
    url: `https://www.instagram.com/antho_${sfx}_ig`,
    warmupProtocol: {
      keywords: ["repack", "growth", "niche"],
      instructions: `${MP} Engage 15 min/jour sur la niche.`,
      targetDays: defaultTargetDays("Instagram"),
      dailyChecks: [ymd(now)],
      updatedAt: now,
    },
  });
  await ctx.db.insert("comptes", {
    projectId,
    handle: `@antho_${sfx}_due`,
    plateforme: "TikTok",
    notes: `${MP} compte démo (warmup en retard — à cocher)`,
    status: "warmup",
    warmupStartedAt: now - 3 * DAY,
    actif: false,
    creatorId,
    url: `https://www.tiktok.com/@antho_${sfx}_due`,
    warmupProtocol: {
      keywords: ["repackit", "hook", "retention"],
      instructions: `${MP} Regarde 10 vidéos, like 5, commente 2 par jour.`,
      targetDays: ttDays,
      // Checks J-3 et J-2 mais RIEN aujourd'hui → « à cocher aujourd'hui ».
      dailyChecks: [ymd(now - 3 * DAY), ymd(now - 2 * DAY)],
      updatedAt: now,
    },
  });
  counts.comptes += 4;

  // ── Format démo ───────────────────────────────────────────────────────────
  const formatId = await ctx.db.insert("formats", {
    projectId,
    name: `${MP} Format vidéo démo`,
    type: "short",
    brief: `${MP} Refais la vidéo source en voix-off, hook < 2s, sous-titres.`,
    hooks: ["Tu fais ça mal depuis des années", "Personne te l'a dit, mais…"],
    guidelines: {
      do: ["Sous-titres lisibles", "Hook dans les 2 premières secondes"],
      dont: ["Watermark d'une autre app", "Musique sous copyright"],
    },
    exampleVideos: [
      {
        kind: "url",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        platform: "youtube",
        title: `${MP} Exemple YouTube`,
      },
    ],
    rateModel: rate,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  counts.formats += 1;

  const insertAssignment = async (fields: {
    targets: { platform: Plateforme; accountId: Id<"comptes">; publishedUrl?: string; publishedAt?: number; publicationId?: Id<"publications"> }[];
    dueDate: number;
    status:
      | "todo"
      | "in_progress"
      | "video_submitted"
      | "video_rejected"
      | "to_publish"
      | "published"
      | "paid";
    videoReviewFeedback?: string;
  }): Promise<Id<"assignments">> => {
    counts.assignments += 1;
    return ctx.db.insert("assignments", {
      projectId,
      creatorId,
      formatId,
      rateSnapshot: rate,
      createdAt: now,
      ...fields,
    });
  };

  // ── Bloc 1 : à produire (todo × produceTodos + 1 in_progress) ─────────────
  for (let k = 0; k < variant.produceTodos; k++) {
    await insertAssignment({
      targets: [{ platform: "YouTube", accountId: cActif }],
      dueDate: now + (3 + k) * DAY,
      status: "todo",
    });
  }
  await insertAssignment({
    targets: [{ platform: "TikTok", accountId: cDone }],
    dueDate: now + 2 * DAY,
    status: "in_progress",
  });

  // ── Bloc 3 : à publier (to_publish, 2 cibles → 2 champs d'URL) ─────────────
  await insertAssignment({
    targets: [
      { platform: "TikTok", accountId: cDone },
      { platform: "YouTube", accountId: cActif },
    ],
    dueDate: now + 1 * DAY,
    status: "to_publish",
  });

  // ── Bloc 4 : à refaire (video_rejected + feedback) ────────────────────────
  await insertAssignment({
    targets: [{ platform: "TikTok", accountId: cDone }],
    dueDate: now + 1 * DAY,
    status: "video_rejected",
    videoReviewFeedback: `${MP} Hook trop long — coupe les 2 premières secondes et resoumets.`,
  });

  // ── Publication matérialisée (+ snapshots de vues) ────────────────────────
  const materializePub = async (args: {
    plateforme: Plateforme;
    compte: string;
    datePubli: number;
    postUrl: string;
    views: [number, number, number];
  }): Promise<Id<"publications">> => {
    const pubId: Id<"publications"> = await ctx.runMutation(
      internal.publications.createFromAssignment,
      {
        projectId,
        mediaType: "short",
        plateforme: args.plateforme,
        compte: args.compte,
        datePubli: args.datePubli,
        postUrl: args.postUrl,
      },
    );
    await ctx.db.patch(pubId, { notes: `${MP} publication de démonstration` });
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

  // ── Bloc 5 (gains du mois) : 1 publié, 2 cibles → 2 pubs + 2 bases + bonus ─
  const datePubli = now - 6 * DAY;
  const tkUrl = `https://www.tiktok.com/@antho_${sfx}_tt/video/73000000000${index}01`;
  const ytUrl = `https://www.youtube.com/watch?v=DEMOMP${index}a`;
  const tkPub = await materializePub({
    plateforme: "TikTok",
    compte: `@antho_${sfx}_tt`,
    datePubli,
    postUrl: tkUrl,
    views: variant.tkViews,
  });
  const ytPub = await materializePub({
    plateforme: "YouTube",
    compte: `@antho_${sfx}_yt`,
    datePubli,
    postUrl: ytUrl,
    views: variant.ytViews,
  });
  const published = await insertAssignment({
    targets: [
      {
        platform: "TikTok",
        accountId: cDone,
        publishedUrl: tkUrl,
        publishedAt: datePubli,
        publicationId: tkPub,
      },
      {
        platform: "YouTube",
        accountId: cActif,
        publishedUrl: ytUrl,
        publishedAt: datePubli,
        publicationId: ytPub,
      },
    ],
    dueDate: now - 5 * DAY,
    status: "published",
  });
  await accrueBaseLineItem(ctx, {
    projectId,
    creatorId,
    assignmentId: published,
    label: `${MP} Base — TikTok`,
    amount: rate.basePerPost,
    now,
    platform: "TikTok",
  });
  await accrueBaseLineItem(ctx, {
    projectId,
    creatorId,
    assignmentId: published,
    label: `${MP} Base — YouTube`,
    amount: rate.basePerPost,
    now,
    platform: "YouTube",
  });
  // Bonus CPM : Σ (vues J+7 / 1000 × tarif) + prime de palier si une cible dépasse.
  const views7 = [variant.tkViews[2], variant.ytViews[2]];
  const bonus =
    Math.round(
      views7.reduce((s, v7) => s + (v7 / 1000) * rate.viewBonusPer1k, 0),
    ) +
    (views7.some((v7) => v7 >= rate.bounties[0].thresholdViews)
      ? rate.bounties[0].amount
      : 0);
  await upsertBonusLineItem(ctx, {
    projectId,
    creatorId,
    assignmentId: published,
    label: `${MP} Bonus vues`,
    amount: bonus,
    now,
  });

  // ── 1 PAYÉ (mois précédent) — peuple l'historique + « payé le … ». ─────────
  const paidMonth = now - 32 * DAY;
  const paidUrl = `https://www.youtube.com/watch?v=DEMOMP${index}paid`;
  const paidPub = await materializePub({
    plateforme: "YouTube",
    compte: `@antho_${sfx}_yt`,
    datePubli: paidMonth,
    postUrl: paidUrl,
    views: variant.paidViews,
  });
  const paid = await insertAssignment({
    targets: [
      {
        platform: "YouTube",
        accountId: cActif,
        publishedUrl: paidUrl,
        publishedAt: paidMonth,
        publicationId: paidPub,
      },
    ],
    dueDate: paidMonth - 2 * DAY,
    status: "paid",
  });
  await accrueBaseLineItem(ctx, {
    projectId,
    creatorId,
    assignmentId: paid,
    label: `${MP} Base — YouTube`,
    amount: rate.basePerPost,
    now: paidMonth,
    platform: "YouTube",
  });
  const pastPeriod = periodOf(paidMonth);
  const pastPayment = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).find((p) => p.period === pastPeriod);
  if (pastPayment) {
    await ctx.db.patch(pastPayment._id, {
      status: "paid",
      scheduledDate: paidMonth + 3 * DAY,
      paidAt: paidMonth + 5 * DAY,
    });
  }
}

type SeedResult = {
  ok: boolean;
  email: string;
  projects: { projectId: Id<"projects">; slug: string; name: string }[];
  counts: Counts;
  message: string;
};

/**
 * Peuple le démo [DEMO-MP] sur CHAQUE projet où le compte (par email) est
 * créateur, avec des données DIFFÉRENTES par projet. Idempotent.
 */
export const seedDemoForMultiProjectCreator = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<SeedResult> => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) {
      throw new ConvexError(`Aucun compte pour l'email « ${email} ».`);
    }
    const memberships = (
      await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()
    ).filter((m) => m.role === "creator");
    if (memberships.length === 0) {
      throw new ConvexError(
        `« ${email} » n'est créateur d'aucun projet — rien à peupler.`,
      );
    }
    const fiches = await creatorFichesByProject(ctx, user._id);

    const now = Date.now();
    const counts = emptyCounts();
    const projects: SeedResult["projects"] = [];

    // Ordre déterministe (par _creationTime du membership) pour des variantes
    // stables d'un run à l'autre.
    const ordered = [...memberships].sort(
      (a, b) => a._creationTime - b._creationTime,
    );
    let index = 0;
    for (const m of ordered) {
      const project = await ctx.db.get(m.projectId);
      if (!project) continue;
      // Fiche créateur du projet : doit exister (membership creator). Sinon, en
      // créer une minimale (cohérence requireCreator) sans toucher au login.
      let creatorId = fiches.get(project._id);
      if (!creatorId) {
        creatorId = await ctx.db.insert("creators", {
          projectId: project._id,
          userId: user._id,
          name: email.split("@")[0],
          email,
          status: "active",
          createdAt: now,
        });
      }
      await seedProject(ctx, {
        projectId: project._id,
        creatorId,
        slug: project.slug,
        index,
        now,
        counts,
      });
      projects.push({
        projectId: project._id,
        slug: project.slug,
        name: project.name,
      });
      index += 1;
    }

    return {
      ok: true,
      email,
      projects,
      counts,
      message: `Démo [DEMO-MP] créée sur ${projects.length} projet(s). Connecte-toi avec ${email} et switche de projet pour voir des données distinctes.`,
    };
  },
});

type CleanupResult = {
  ok: boolean;
  email: string;
  projectsCleaned: number;
  counts: Counts;
};

/**
 * Efface UNIQUEMENT le démo [DEMO-MP] de ce compte sur ses projets. NE supprime
 * NI le user/login, NI les memberships, NI les fiches créateur, NI le démo d'un
 * autre créateur. Idempotent.
 */
export const cleanupDemoForMultiProjectCreator = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<CleanupResult> => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    const counts = emptyCounts();
    if (!user) {
      return { ok: true, email, projectsCleaned: 0, counts };
    }
    const fiches = await creatorFichesByProject(ctx, user._id);
    let projectsCleaned = 0;
    for (const [projectId, creatorId] of fiches) {
      await cleanupProjectDemo(
        ctx,
        projectId as Id<"projects">,
        creatorId,
        counts,
      );
      projectsCleaned += 1;
    }
    return { ok: true, email, projectsCleaned, counts };
  },
});
