import {
  adminMutation,
  adminQuery,
  authedQuery,
  e2eMutation,
  publicQuery,
  requireProjectAccess,
  superadminMutation,
} from "./functions";
import { internalMutation } from "./_generated/server";
import { isPortalRole } from "./roles";
import {
  PERMISSION_ID_LITERALS,
  grantedPermissions,
  type PermissionId,
} from "./permissions";
import { normalizeRef } from "./conversionAttribution";
import { warmupTargetDaysOf } from "./warmup";
import {
  COMBO_COOLDOWN_DAYS_FALLBACK,
  assertValidComboCooldownDays,
  comboCooldownDaysOf,
} from "./comboCooldown";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { convexErrorText } from "./errorCodes";

/**
 * P2 Multi-tenant — résolution du projet courant.
 *
 * Le slug du projet historique (cible du backfill). Réutilisé comme fallback
 * pour un superadmin qui n'aurait aucun membership explicite.
 */
export const REPACKIT_SLUG = "repackit";

/**
 * Slug du projet Snytch — la SEULE app concernée par le dépôt de fichiers
 * créateur (Google Drive, cf convex/snytchDrive.ts). Réplique A6 de
 * lib/snytch-drive.SNYTCH_SLUG (convex/ ne peut pas importer lib/).
 */
export const SNYTCH_SLUG = "snytch";

export async function getProjectBySlug(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<"projects"> | null> {
  return await ctx.db
    .query("projects")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

/**
 * Le projet d'id `projectId` est-il Snytch ? Sert à SCOPER un comportement au
 * seul projet Snytch sans toucher les autres (RepackIt & co.). Typé QueryCtx
 * (comme getProjectBySlug) → utilisable depuis query ET mutation. Un projet
 * introuvable → false (jamais Snytch par défaut).
 *
 * Utilisé par le GATE STRICT « actif » : isAccountAvailable(compte, { strict })
 * n'est passé en strict que pour Snytch (cf convex/assignments.validateTargets,
 * confirmPublication, convex/comptes.listCreatorAvailableComptes).
 */
export async function isSnytchProject(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<boolean> {
  const project = await ctx.db.get(projectId);
  return project?.slug === SNYTCH_SLUG;
}

/**
 * Projet « courant » pour l'utilisateur connecté — consommé par le front pour
 * obtenir le projectId à passer à toutes les autres queries/mutations.
 *
 * ⚠️ TODO(P3) : provisoire en attendant le sélecteur de projet. Tant qu'un
 * user n'a qu'un seul projet, cette résolution suffit. Règle :
 *   - membership le plus récent (dernier _creationTime) si l'user en a — gère
 *     le cas e2e (user superadmin rattaché en plus à un projet e2e dédié créé
 *     après la migration : ce membership récent l'emporte) ;
 *   - sinon (superadmin sans membership) : fallback projet "repackit" ;
 *   - sinon : null (l'AppShell affiche un état vide).
 */
export const getCurrentProject = authedQuery({
  args: {},
  handler: async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();

    if (memberships.length > 0) {
      const latest = memberships.reduce((a, b) =>
        b._creationTime > a._creationTime ? b : a,
      );
      const project = await ctx.db.get(latest.projectId);
      if (project) return project;
    }

    return await getProjectBySlug(ctx, REPACKIT_SLUG);
  },
});

/**
 * P3 — slugs réservés à l'arborescence de routes (`/admin/[slug]/…`, segment
 * `/app` futur portail créateur, `/login`, `/p`). Empêche de créer un projet
 * dont le slug entrerait en collision avec un segment top-level.
 */
const RESERVED_SLUGS = new Set([
  "admin",
  "app",
  "login",
  "api",
  "p",
  "_next",
  "dashboard",
  // Portails talent / clippeur (segments top-level, cf lib/portal-path.ts).
  "talent",
  "clip",
]);

/**
 * PROJECTION du document projet servie au CLIENT (app interne).
 *
 * `getProjectForCurrentUser` renvoyait le document COMPLET à tout membre — donc
 * aussi à un rôle de portail, qui a bien un membership. Le doc porte la
 * configuration interne du projet : `whop.companyId`, `notify.chatId`,
 * `posthog.posthogProjectId`, `fxRateToRevenue`, `defaultBonusPricingId`. Aucun
 * secret (les clés vivent en env, jamais en base — cf schema) mais aucune raison
 * de l'envoyer sur le téléphone d'un talent ou d'un clippeur externe.
 *
 * On aligne donc sur ce que fait DÉJÀ `creators.getMyCreatorProjects` : une liste
 * de champs EXPLICITE. Ces 8 champs sont exactement ceux que l'UI consomme via
 * `useProject()` ; en ajouter un est une décision consciente, et tsc casse si un
 * écran lit un champ non projeté.
 */
export function projectForClient(p: Doc<"projects">) {
  return {
    _id: p._id,
    _creationTime: p._creationTime,
    slug: p.slug,
    name: p.name,
    accentColor: p.accentColor,
    logoUrl: p.logoUrl ?? null,
    payoutDay: p.payoutDay,
    payCurrency: p.payCurrency ?? null,
    sidebarLinks: p.sidebarLinks ?? null,
    status: p.status,
  };
}

/**
 * P3 — résolution du projet par slug d'URL pour l'utilisateur courant. L'URL est
 * la source de vérité : le ProjectProvider lit `[projectSlug]` et appelle cette
 * query. Retour discriminé pour distinguer 404 (slug inexistant) et 403 (slug
 * existant mais pas d'accès) côté UI.
 */
export const getProjectForCurrentUser = authedQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const project = await getProjectBySlug(ctx, slug);
    if (project === null) return { status: "not_found" as const };
    const user = await ctx.db.get(ctx.userId);
    if (user?.role === "superadmin") {
      // P1 — superadmin n'est jamais un rôle de portail (accès admin implicite).
      return {
        status: "ok" as const,
        project: projectForClient(project),
        portalRole: null,
      };
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", ctx.userId).eq("projectId", project._id),
      )
      .first();
    if (membership === null) return { status: "forbidden" as const };
    // Un rôle de PORTAIL (creator partenaire / talent / clippeur) a accès au projet
    // (membership) mais PAS à l'app interne : le ProjectProvider le renvoie vers SON
    // portail (lib/portal-path). On renvoie le rôle plutôt qu'un booléen — avec trois
    // portails, un `isCreator` ne dit plus où rediriger. La vraie barrière reste
    // serveur (adminQuery/adminMutation), ce champ n'est que du confort de routage.
    return {
      status: "ok" as const,
      project: projectForClient(project),
      portalRole: isPortalRole(membership.role) ? membership.role : null,
    };
  },
});

/**
 * PUBLIC (pré-session) — branding minimal d'UN SEUL projet, désigné par son
 * slug, pour la page de login brandée `/[slug]/login`. Le visiteur connaît
 * déjà ce slug (c'est le lien qu'on lui a donné) ; on ne lui révèle que le NOM
 * et l'ACCENT du projet pour l'habillage.
 *
 * ⚠️ ANTI-FUITE : ne renvoie JAMAIS la liste des projets ni aucune donnée
 * sensible — uniquement { name, accentColor } du projet du slug, ou null si le
 * slug est inconnu. Il n'existe aucun endpoint public listant les projets.
 */
export const getProjectBrandingBySlug = publicQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const project = await getProjectBySlug(ctx, slug);
    if (project === null) return null;
    return { name: project.name, accentColor: project.accentColor };
  },
});

/**
 * Renommage one-shot d'un projet par slug (interne, via `convex run`). Sert au
 * rebranding « RepackIt » → « RepackIt Creator » sans toucher au slug ni au
 * routing. Idempotent. Lancement prod :
 *   npx convex run projects:renameProjectBySlug '{"slug":"repackit","name":"RepackIt Creator"}' --prod
 */
export const renameProjectBySlug = internalMutation({
  args: { slug: v.string(), name: v.string() },
  handler: async (
    ctx,
    { slug, name },
  ): Promise<{ updated: boolean }> => {
    const project = await getProjectBySlug(ctx, slug);
    if (project === null) return { updated: false };
    await ctx.db.patch(project._id, { name });
    return { updated: true };
  },
});

/**
 * Configure les DEVISES d'un projet (interne, via `convex run`). Le produit en a
 * DEUX : la PAIE créatrices (`payCurrency`, ex. "usd") et le REVENU Whop (devise
 * de whopPayments, non réglée ici). `fxRateToRevenue` convertit la paie vers la
 * devise du revenu POUR LA SEULE marge (1 payCurrency = fxRateToRevenue revenu).
 * Patch partiel : champ omis → inchangé ; payCurrency:"" → retire (montants de
 * paie sans symbole) ; fxRateToRevenue:0 → retire (marge combinée non calculée).
 *   npx convex run projects:setProjectCurrencyBySlug '{"slug":"snytch","payCurrency":"usd","fxRateToRevenue":0.92}' --prod
 */
/**
 * Déclare les refs d'INFLUENCEUSES d'un projet, DEPUIS LE CLI.
 *
 * Ces personnes n'ont pas de fiche `creators` — et ne doivent pas en avoir :
 * une fiche les ferait entrer dans le moteur de paie, les cycles et le portail
 * créateur pour une seule ligne d'attribution. Ce champ leur donne un NOM dans
 * le bloc « Ce que ça a rapporté » sans rien d'autre.
 *
 * REMPLACE la liste entière (pas d'ajout incrémental) : c'est ce qui rend
 * l'appel idempotent et relisible d'un coup d'œil. Une liste vide efface.
 *
 * REFUSE une ref déjà portée par une créatrice du projet : une ref est une clé
 * d'attribution, deux porteurs et les deux lignes affichent les mêmes chiffres
 * sans que le total le montre.
 *
 *   npx convex run projects:setInfluencerRefsBySlug '{"slug":"snytch","refs":[{"ref":"gio","name":"Gio"}]}'
 */
export const setInfluencerRefsBySlug = internalMutation({
  args: {
    slug: v.string(),
    refs: v.array(v.object({ ref: v.string(), name: v.string() })),
  },
  handler: async (ctx, { slug, refs }) => {
    const project = (await ctx.db.query("projects").collect()).find(
      (p) => p.slug === slug,
    );
    if (!project) throw new ConvexError(`Projet « ${slug} » introuvable.`);

    const cleaned: { ref: string; name: string }[] = [];
    for (const r of refs) {
      const ref = normalizeRef(r.ref);
      const name = r.name.trim();
      if (ref === null) throw new ConvexError(`Ref vide pour « ${r.name} ».`);
      if (name === "") throw new ConvexError(`Nom manquant pour la ref « ${ref} ».`);
      if (cleaned.some((c) => c.ref === ref)) {
        throw new ConvexError(`Ref « ${ref} » présente deux fois dans la liste.`);
      }
      cleaned.push({ ref, name });
    }

    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    for (const c of cleaned) {
      const taken = creators.find(
        (cr) => normalizeRef(cr.refSlug ?? null) === c.ref,
      );
      if (taken) {
        throw new ConvexError(
          `La ref « ${c.ref} » est déjà celle de la créatrice ${taken.name}. Une ref ne peut appartenir qu'à une seule personne.`,
        );
      }
    }

    const before = project.influencerRefs ?? [];
    await ctx.db.patch(project._id, {
      influencerRefs: cleaned.length > 0 ? cleaned : undefined,
    });
    return {
      slug,
      before: before.map((r) => `${r.ref} (${r.name})`),
      after: cleaned.map((r) => `${r.ref} (${r.name})`),
    };
  },
});

export const setProjectCurrencyBySlug = internalMutation({
  args: {
    slug: v.string(),
    payCurrency: v.optional(v.string()),
    fxRateToRevenue: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { slug, payCurrency, fxRateToRevenue },
  ): Promise<{ updated: boolean }> => {
    const project = await getProjectBySlug(ctx, slug);
    if (project === null) return { updated: false };
    const patch: { payCurrency?: string; fxRateToRevenue?: number } = {};
    if (payCurrency !== undefined) {
      patch.payCurrency =
        payCurrency.trim() === "" ? undefined : payCurrency.trim().toLowerCase();
    }
    if (fxRateToRevenue !== undefined) {
      patch.fxRateToRevenue = fxRateToRevenue > 0 ? fxRateToRevenue : undefined;
    }
    await ctx.db.patch(project._id, patch);
    return { updated: true };
  },
});

/**
 * Réglages de l'espace TALENT d'un projet : quel format sert de brief permanent,
 * et le dépôt de fichiers est-il ouvert.
 *
 * `adminMutation` et non `internalMutation` : ce n'est pas de l'exploitation
 * ponctuelle comme les devises ou le mapping Whop, c'est un réglage qu'un admin
 * de projet ajuste (changer le brief = changer la consigne de tournage). L'écran
 * qui l'appellera arrive avec la revue des rushes ; le passer par un wrapper
 * admin dès maintenant évite d'inventer une surface réservée aux tests.
 *
 * Patch PARTIEL : un champ omis reste inchangé. `talentBriefFormatId: null`
 * retire le brief (l'espace talent affiche alors un état honnête, pas un cadre
 * vide). Le format désigné est vérifié comme appartenant AU PROJET — un id d'un
 * autre projet est refusé plutôt que stocké et filtré à la lecture.
 *
 * ⚠️ `fileDropEnabled` ne commande QUE le dépôt Drive. Le régime strict de
 * disponibilité des comptes reste sur le slug (cf convex/fileDrop.ts).
 */
/**
 * Réglages de l'espace talent — LECTURE ADMIN.
 *
 * Query dédiée plutôt qu'un élargissement de `projectForClient` : cette
 * projection est servie à TOUT membre, y compris un talent ou un clippeur. Deux
 * champs de configuration de plus y seraient sans danger réel, mais la liste
 * blanche n'a de valeur que si on ne l'élargit pas par commodité.
 */
export const getTalentSettings = adminQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    fileDropEnabled: boolean;
    talentBriefFormatId: Id<"formats"> | null;
  }> => {
    const project = await ctx.db.get(ctx.projectId);
    return {
      fileDropEnabled: project?.fileDropEnabled ?? false,
      talentBriefFormatId: project?.talentBriefFormatId ?? null,
    };
  },
});

export const setTalentSettings = adminMutation({
  args: {
    talentBriefFormatId: v.optional(v.union(v.id("formats"), v.null())),
    fileDropEnabled: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { talentBriefFormatId, fileDropEnabled },
  ): Promise<{ updated: true }> => {
    const patch: {
      talentBriefFormatId?: Id<"formats"> | undefined;
      fileDropEnabled?: boolean;
    } = {};
    if (talentBriefFormatId !== undefined) {
      if (talentBriefFormatId === null) {
        patch.talentBriefFormatId = undefined;
      } else {
        const format = await ctx.db.get(talentBriefFormatId);
        if (!format || format.projectId !== ctx.projectId) {
          throw new ConvexError("Format introuvable dans ce projet.");
        }
        patch.talentBriefFormatId = talentBriefFormatId;
      }
    }
    if (fileDropEnabled !== undefined) patch.fileDropEnabled = fileDropEnabled;
    await ctx.db.patch(ctx.projectId, patch);
    return { updated: true };
  },
});

/**
 * Backfill (interne, `convex run`) : pose `payCurrency: "usd"` sur TOUT projet qui
 * n'en a pas — durcissement devise, pour qu'aucun montant de paie ne s'affiche sans
 * symbole. Idempotent (les projets déjà réglés sont ignorés). À lancer une fois :
 *   npx convex run projects:backfillPayCurrency '{}' --prod
 */
export const backfillPayCurrency = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ patched: number }> => {
    const projects = await ctx.db.query("projects").collect();
    let patched = 0;
    for (const p of projects) {
      if (p.payCurrency === undefined || p.payCurrency === "") {
        await ctx.db.patch(p._id, { payCurrency: "usd" });
        patched += 1;
      }
    }
    return { patched };
  },
});

/**
 * Validateur partagé du shape `sidebarLinks` (aligné sur schema.ts). icon =
 * nom lucide optionnel résolu côté UI (lib/sidebar-link-icon.ts).
 */
const sidebarLinksValidator = v.array(
  v.object({
    label: v.string(),
    url: v.string(),
    icon: v.optional(v.string()),
  }),
);

/**
 * Configuration du BRANDING d'un projet (interne, via `convex run`) :
 * logo affiché dans le switcher + liens externes de sidebar. CONFIGURABLE PAR
 * PROJET (désigné par slug) — aucun hardcode. Patch partiel :
 *   - champ omis        → inchangé ;
 *   - logoUrl: ""       → retire le logo (fallback initiale + accent) ;
 *   - sidebarLinks: []  → retire tous les liens (la section "Outils" disparaît).
 *
 * Exemple — configurer le projet "snytch" (logo œil + lien Carrousel Studio) :
 *   npx convex run projects:setProjectBranding '{"slug":"snytch","logoUrl":"/brand/snytch-logo.jpeg","sidebarLinks":[{"label":"Carrousel Studio","url":"https://carrouselstudio.vercel.app/","icon":"carousel"}]}' --prod
 */
export const setProjectBranding = internalMutation({
  args: {
    slug: v.string(),
    logoUrl: v.optional(v.string()),
    sidebarLinks: v.optional(sidebarLinksValidator),
  },
  handler: async (
    ctx,
    { slug, logoUrl, sidebarLinks },
  ): Promise<{ updated: boolean }> => {
    const project = await getProjectBySlug(ctx, slug);
    if (project === null) return { updated: false };
    const patch: Partial<Doc<"projects">> = {};
    if (logoUrl !== undefined) {
      patch.logoUrl = logoUrl === "" ? undefined : logoUrl;
    }
    if (sidebarLinks !== undefined) {
      patch.sidebarLinks = sidebarLinks.length === 0 ? undefined : sidebarLinks;
    }
    await ctx.db.patch(project._id, patch);
    return { updated: true };
  },
});

/**
 * P3 — projets accessibles par l'utilisateur courant (switcher de projet).
 * superadmin → tous les projets ; sinon → ceux liés par un membership. Triés
 * par nom pour un ordre stable dans le menu.
 */
export const listMyProjects = authedQuery({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.get(ctx.userId);
    let projects: Doc<"projects">[];
    if (user?.role === "superadmin") {
      projects = await ctx.db.query("projects").collect();
    } else {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
        .collect();
      projects = [];
      for (const m of memberships) {
        const p = await ctx.db.get(m.projectId);
        if (p) projects.push(p);
      }
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * P3 — identité de l'utilisateur courant (email pour le footer sidebar, rôle
 * pour gater « Créer un projet »). undefined role traité comme non-superadmin.
 */
export const getMe = authedQuery({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.get(ctx.userId);
    return {
      email: user?.email ?? null,
      isSuperadmin: user?.role === "superadmin",
    };
  },
});

/**
 * P3 — création d'un projet vierge (superadmin uniquement). Slug normalisé
 * (minuscules / chiffres / tirets), unique, non réservé. accentColor défaut
 * #FF5200, payoutDay défaut 5 (borné 1–28). Aucun membership créé : le
 * superadmin a l'accès implicite ; le workspace reste 100 % vide.
 */
/**
 * MES DROITS sur un projet — ce que l'ÉCRAN a le droit de demander.
 *
 * Pourquoi cette query existe. Depuis le découpage financier, certains écrans
 * appellent des fonctions gardées par un bloc que l'appelant ne porte pas
 * forcément (la fiche créatrice et ses conditions de rémunération). Sans un
 * moyen de SAVOIR, le client n'a que deux options : appeler et se prendre une
 * erreur — un écran cassé pour un droit manquant — ou ne jamais appeler, et
 * l'écran serait amputé pour tout le monde. Il lui faut la liste.
 *
 * ⚠️ Elle ne renvoie que les droits EFFECTIFS : les valeurs stockées hors
 * catalogue sont écartées, exactement comme au contrôle d'accès
 * (`grantedPermissions`). Un écran qui verrait « challenges.manage » — bloc
 * retiré depuis — croirait pouvoir afficher quelque chose que le serveur
 * refuserait ensuite. La liste que lit le client doit être la MÊME que celle qui
 * décide, sans quoi elle ment poliment.
 *
 * ⚠️ Et ce n'est PAS une barrière : masquer un bouton n'a jamais protégé une
 * donnée. La barrière reste `requirePermission`, à chaque requête. Ceci ne sert
 * qu'à ne pas afficher un écran cassé.
 *
 * `admin` et `superadmin` reçoivent TOUT le catalogue : ils peuvent tout, et
 * l'écran doit se comporter pour eux exactement comme avant.
 */
export const getMyPermissions = authedQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await ctx.db.get(ctx.userId);
    if (user?.role === "superadmin") {
      return { role: "superadmin" as const, permissions: [...PERMISSION_ID_LITERALS] };
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", ctx.userId).eq("projectId", projectId),
      )
      .first();
    if (membership === null) {
      return { role: null, permissions: [] as PermissionId[] };
    }
    if (membership.role === "admin") {
      return { role: "admin" as const, permissions: [...PERMISSION_ID_LITERALS] };
    }
    if (membership.role !== "manager") {
      // Rôle de portail : aucun droit d'administration, et c'est structurel.
      return { role: membership.role, permissions: [] as PermissionId[] };
    }
    return {
      role: "manager" as const,
      permissions: [...grantedPermissions(membership.permissions)],
    };
  },
});

export const createProject = superadminMutation({
  args: {
    name: v.string(),
    slug: v.string(),
    accentColor: v.optional(v.string()),
    payoutDay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) {
      throw new ConvexError("Le nom du projet est requis.");
    }
    const slug = args.slug.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      throw new ConvexError(
        "Slug invalide : minuscules, chiffres et tirets uniquement.",
      );
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new ConvexError(`Slug réservé : « ${slug} ».`);
    }
    const existing = await getProjectBySlug(ctx, slug);
    if (existing !== null) {
      throw new ConvexError(`Un projet « ${slug} » existe déjà.`);
    }
    const accentColor = args.accentColor?.trim() || "#FF5200";
    const payoutDay = args.payoutDay ?? 5;
    if (!Number.isInteger(payoutDay) || payoutDay < 1 || payoutDay > 28) {
      throw new ConvexError("Le jour de paie doit être un entier entre 1 et 28.");
    }
    const projectId = await ctx.db.insert("projects", {
      name,
      slug,
      accentColor,
      payoutDay,
      // La paie créatrices est en DOLLARS par défaut (durcissement devise) : un
      // projet sans devise afficherait sinon ses montants de paie sans symbole.
      // Réglable ensuite par projects:setProjectCurrencyBySlug (autre devise/taux).
      payCurrency: "usd",
      status: "active",
      createdAt: Date.now(),
    });
    return { projectId, slug };
  },
});

// ─── Helpers e2e (gated E2E_SECRET) ────────────────────────────────────────

/**
 * Crée (ou réutilise) un projet par slug et attache l'utilisateur identifié
 * par email (membership idempotent). Le global-setup Playwright l'appelle pour
 * créer le projet e2e dédié + rattacher le user e2e — getCurrentProject
 * (membership le plus récent) renverra alors ce projet.
 */
export const e2eEnsureProjectForEmail = e2eMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("creator"))),
    accentColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (project === null) {
      const id = await ctx.db.insert("projects", {
        name: args.name,
        slug: args.slug,
        accentColor: args.accentColor ?? "#FF5200",
        payoutDay: 5,
        status: "active",
        createdAt: Date.now(),
      });
      project = await ctx.db.get(id);
    }
    const projectId = project!._id;

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) {
      throw new ConvexError(`User e2e introuvable: ${args.email}`);
    }
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", user._id).eq("projectId", projectId),
      )
      .first();
    if (existing === null) {
      await ctx.db.insert("memberships", {
        userId: user._id,
        projectId,
        role: args.role ?? "admin",
      });
    }
    return { projectId };
  },
});

/**
 * Crée un user NON-superadmin (role "member") + un membership dans un projet —
 * sert UNIQUEMENT au test d'isolation inter-projets (le user e2e standard est
 * superadmin et contourne le membership). Idempotent par email.
 */
export const e2eEnsureMemberUser = e2eMutation({
  args: {
    email: v.string(),
    projectId: v.id("projects"),
    role: v.optional(v.union(v.literal("admin"), v.literal("creator"))),
  },
  handler: async (ctx, args) => {
    let user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) {
      const id = await ctx.db.insert("users", {
        email: args.email,
        role: "member",
      });
      user = await ctx.db.get(id);
    }
    const userId = user!._id;
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", args.projectId),
      )
      .first();
    if (existing === null) {
      await ctx.db.insert("memberships", {
        userId,
        projectId: args.projectId,
        role: args.role ?? "creator",
      });
    }
    return { userId };
  },
});

/**
 * Exécute requireProjectAccess pour le user (par email) sur projectId et
 * retourne { allowed, error? }. Sert au test d'isolation : un user member du
 * projet A doit être REFUSÉ sur le projet B. Ne passe pas par une session
 * (le user de test n'a pas de mot de passe) mais exerce la VRAIE logique de
 * garde requireProjectAccess.
 */
export const e2eAssertAccess = e2eMutation({
  args: { email: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) {
      return { allowed: false, error: "user introuvable" };
    }
    try {
      await requireProjectAccess(ctx, user._id, args.projectId);
      return { allowed: true };
    } catch (e) {
      return {
        allowed: false,
        error: convexErrorText(e),
      };
    }
  },
});

/**
 * Pose le branding (logoUrl + sidebarLinks) d'un projet par slug — exerce la
 * VRAIE logique de setProjectBranding pour la spec e2e branding. Gated E2E.
 */
export const e2eSetProjectBranding = e2eMutation({
  args: {
    slug: v.string(),
    logoUrl: v.optional(v.string()),
    sidebarLinks: v.optional(sidebarLinksValidator),
  },
  handler: async (ctx, { slug, logoUrl, sidebarLinks }) => {
    const project = await getProjectBySlug(ctx, slug);
    if (project === null) return { updated: false };
    const patch: Partial<Doc<"projects">> = {};
    if (logoUrl !== undefined) {
      patch.logoUrl = logoUrl === "" ? undefined : logoUrl;
    }
    if (sidebarLinks !== undefined) {
      patch.sidebarLinks = sidebarLinks.length === 0 ? undefined : sidebarLinks;
    }
    await ctx.db.patch(project._id, patch);
    return { updated: true };
  },
});

/** Récupère l'id d'un projet par slug (e2e setup/teardown). */
export const e2eGetProjectIdBySlug = e2eMutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const project = await getProjectBySlug(ctx, args.slug);
    return { projectId: project?._id ?? null };
  },
});

/**
 * Crée (idempotent) un projet par slug SANS aucun membership — pour les tests
 * d'isolation / compteur d'IDs qui ne doivent PAS rattacher le user e2e (sinon
 * getCurrentProject renverrait ce projet vide). L'accès se fait via le bypass
 * superadmin du user e2e.
 */
export const e2eEnsureProjectBySlug = e2eMutation({
  args: { slug: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    let project = await getProjectBySlug(ctx, args.slug);
    if (project === null) {
      const id = await ctx.db.insert("projects", {
        name: args.name,
        slug: args.slug,
        accentColor: "#FF5200",
        payoutDay: 5,
        status: "active",
        createdAt: Date.now(),
      });
      project = await ctx.db.get(id);
    }
    return { projectId: project!._id };
  },
});

/**
 * Élague les memberships du user e2e (par email) pour ne garder QUE celui du
 * projet `keepSlug`. Rend getCurrentProject déterministe pour le user e2e
 * (sinon une spec d'isolation peut le rattacher à un projet vide et casser les
 * specs UI). Appelé au global-setup.
 */
export const e2ePruneMemberships = e2eMutation({
  args: { email: v.string(), keepSlug: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) return { pruned: 0 };
    const keep = await getProjectBySlug(ctx, args.keepSlug);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    let pruned = 0;
    for (const m of memberships) {
      if (keep && m.projectId === keep._id) continue;
      await ctx.db.delete(m._id);
      pruned += 1;
    }
    return { pruned };
  },
});

/**
 * Supprime un projet par slug + ses memberships — teardown du test de création
 * de projet (project-create.spec) pour ne pas polluer le backend partagé entre
 * runs. Refuse de toucher les projets « socles » (repackit / e2e-test).
 */
export const e2eDeleteProject = e2eMutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    if (args.slug === REPACKIT_SLUG || args.slug === "e2e-test") {
      throw new ConvexError(`Suppression interdite du projet socle « ${args.slug} ».`);
    }
    const project = await getProjectBySlug(ctx, args.slug);
    if (project === null) return { deleted: false };
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    await ctx.db.delete(project._id);
    return { deleted: true };
  },
});


/**
 * DURÉE DE WARMUP DU PROJET — lecture et écriture par l'admin.
 *
 * Une plateforme à `null` n'est PAS définie par ce projet : elle retombe sur le
 * dernier recours (`warmupTargetDaysOf`). C'est la différence entre « Snytch
 * chauffe 3 jours sur TikTok » et « Snytch ne fait pas de YouTube » — deux faits
 * distincts, qu'un simple nombre ne saurait pas dire.
 *
 * Le barème NE TOUCHE PAS aux warmups en cours : la durée est figée sur
 * `comptes.warmupProtocol.targetDays` au démarrage. Changer ce réglage n'a
 * d'effet que sur les chauffes à venir — c'est dit à l'écran, pour qu'on ne
 * l'attende pas en vain.
 */
export const getWarmupSettings = adminQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    defined: { tiktok: number | null; instagram: number | null; youtube: number | null };
    effective: { tiktok: number; instagram: number; youtube: number };
  }> => {
    const project = await ctx.db.get(ctx.projectId);
    const d = project?.warmupTargetDays ?? {};
    return {
      defined: {
        tiktok: d.tiktok ?? null,
        instagram: d.instagram ?? null,
        youtube: d.youtube ?? null,
      },
      effective: warmupTargetDaysOf(project ?? {}),
    };
  },
});

const WARMUP_DAYS_MIN = 1;
const WARMUP_DAYS_MAX = 60;

export const setWarmupSettings = adminMutation({
  args: {
    tiktok: v.union(v.number(), v.null()),
    instagram: v.union(v.number(), v.null()),
    youtube: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args): Promise<{ updated: true }> => {
    const clean = (v2: number | null, label: string): number | undefined => {
      if (v2 === null) return undefined;
      if (!Number.isInteger(v2) || v2 < WARMUP_DAYS_MIN || v2 > WARMUP_DAYS_MAX) {
        throw new ConvexError(
          `Durée ${label} invalide : un entier entre ${WARMUP_DAYS_MIN} et ${WARMUP_DAYS_MAX} jours.`,
        );
      }
      return v2;
    };
    const next = {
      tiktok: clean(args.tiktok, "TikTok"),
      instagram: clean(args.instagram, "Instagram"),
      youtube: clean(args.youtube, "YouTube"),
    };
    // Les trois vides ⇒ on retire le champ : le projet cesse de définir un
    // barème, plutôt que d'en stocker un vide qui voudrait dire la même chose
    // avec une ligne de plus en base.
    const aucune =
      next.tiktok === undefined &&
      next.instagram === undefined &&
      next.youtube === undefined;
    await ctx.db.patch(ctx.projectId, {
      warmupTargetDays: aucune ? undefined : next,
    });
    return { updated: true };
  },
});

/**
 * COOLDOWN DE COMBO DU PROJET — lecture et écriture par l'admin.
 *
 * Un champ vide n'est PAS un zéro : vide = « ce projet ne définit rien » et la
 * durée retombe sur le dernier recours ; `0` = « cooldown désactivé », une
 * décision explicite. Même distinction que le barème de warmup, et pour la même
 * raison : un nombre seul ne sait pas dire lequel des deux on veut.
 *
 * NE TOUCHE PAS aux combos déjà attribués — ils sont figés sur leur assignation
 * et ne sont jamais rejugés. Le réglage n'agit que sur les tirages à venir.
 */
export const getComboCooldownSettings = adminQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    /** Valeur posée par le projet. null = aucune (repli sur le défaut). */
    defined: number | null;
    /** Durée réellement appliquée par le tirage. */
    effective: number;
    /** Le défaut, pour l'afficher sous un champ vide. */
    fallback: number;
  }> => {
    const project = await ctx.db.get(ctx.projectId);
    return {
      defined: project?.comboCooldownDays ?? null,
      effective: comboCooldownDaysOf(project ?? {}),
      fallback: COMBO_COOLDOWN_DAYS_FALLBACK,
    };
  },
});

export const setComboCooldownDays = adminMutation({
  args: { days: v.union(v.number(), v.null()) },
  handler: async (ctx, { days }): Promise<{ updated: true }> => {
    // La validation vit dans le module pur (bornes + message), pas ici : c'est
    // elle que les tests vitest exercent.
    let clean: number | undefined;
    try {
      clean = assertValidComboCooldownDays(days);
    } catch (e) {
      throw new ConvexError(
        e instanceof Error ? e.message : "Durée de cooldown invalide.",
      );
    }
    await ctx.db.patch(ctx.projectId, { comboCooldownDays: clean });
    return { updated: true };
  },
});
