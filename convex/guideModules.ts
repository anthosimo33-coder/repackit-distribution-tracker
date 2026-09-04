import {
  adminViewAsQuery,
  creatorQuery,
  e2eMutation,
  permissionMutation,
  permissionQuery,
} from "./functions";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./locales";
import { moduleLocale, selectModulesForLocale } from "./guideModuleLocale";

/**
 * « Comment ça marche » v2 — système de MODULES markdown par projet (remplace le
 * guide mono-bloc projectGuide, désormais simple fallback). Liste plate de
 * modules : titre + contenu markdown + order + status (published|draft).
 *
 * Scoping STRICT (cf functions.ts) : adminQuery/adminMutation exigent le rôle
 * admin du projet ; chaque mutation re-vérifie `module.projectId === ctx.projectId`
 * (un moduleId d'un autre projet est introuvable → rejet, aucune fuite). Le
 * créateur (creatorQuery) ne voit que les modules `published`. La variante
 * view-as (adminViewAsQuery) sert EXACTEMENT le même contenu que le créateur.
 *
 * BILINGUE — un JEU DE MODULES PAR LANGUE (champ `locale`), sélectionné à la
 * lecture avec repli sur le français (cf convex/guideModuleLocale.ts). Les deux
 * jeux ont chacun leur ORDRE : création et réordonnancement se font entre pairs
 * de MÊME langue, sinon la flèche « monter » d'un module anglais irait échanger
 * son rang avec un module français que le lecteur ne verra jamais à côté.
 */

/**
 * Le seul `slot` livré : le module que le bouton de l'écran comptes ouvre.
 *
 * UN SEUL module par (projet, langue) peut le porter, et c'est garanti par
 * TRANSFERT : l'attribuer à un module le retire de celui qui l'avait. Sans
 * cette garantie, deux modules pourraient le porter et le serveur servirait le
 * premier par `order` — une bascule silencieuse, sans erreur ni test rouge, le
 * jour où quelqu'un réordonne le guide.
 */
export const WARMUP_SLOT = "warmup";

const TITLE_MAX = 120;
const CONTENT_MAX = 50_000;

/** Tri stable : par order croissant, puis createdAt (départage les ex æquo). */
function byOrder<T extends { order: number; createdAt: number }>(a: T, b: T) {
  return a.order - b.order || a.createdAt - b.createdAt;
}

/**
 * Modules `published` d'un projet dans la langue du LECTEUR, triés — shape
 * PARTAGÉE créateur ↔ view-as.
 *
 * `requestedLocale` est rendu À CÔTÉ de `servedLocale` : l'écran n'a pas à
 * re-deviner ce qu'il a demandé pour savoir s'il lit un repli, et la comparaison
 * se fait sur des valeurs NORMALISÉES des deux côtés.
 */
async function readPublishedModules(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  requestedLocale: Locale,
) {
  const modules = await ctx.db
    .query("guideModules")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const published = modules.filter((m) => m.status === "published");
  const { modules: selected, servedLocale } = selectModulesForLocale(
    published,
    requestedLocale,
  );
  return {
    requestedLocale,
    servedLocale,
    modules: selected.sort(byOrder).map((m) => ({
      _id: m._id,
      title: m.title,
      contentMarkdown: m.contentMarkdown,
      order: m.order,
    })),
  };
}

/**
 * Langue demandée par le lecteur. Absente ou inconnue ⇒ le défaut du produit :
 * la langue d'affichage ne doit jamais pouvoir faire échouer une lecture de
 * contenu (même principe que la chaîne de résolution de i18n/request.ts).
 */
function readerLocale(raw: string | undefined): Locale {
  return normalizeLocale(raw) ?? DEFAULT_LOCALE;
}

// ─── Lecture admin ──────────────────────────────────────────────────────────

/** Tous les modules du projet (published + draft), triés par order (édition). */
export const listModulesForAdmin = permissionQuery("guide.manage")({
  args: {},
  handler: async (ctx) => {
    const modules = await ctx.db
      .query("guideModules")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return modules.sort(byOrder);
  },
});

// ─── Lecture créateur + view-as ───────────────────────────────────────────────

/**
 * Modules `published` du projet du créateur courant, dans SA langue (lecture
 * seule, triés).
 *
 * POURQUOI LA LANGUE VIENT DE L'APPELANT, et non d'une lecture serveur de
 * `users.locale`. La langue affichée est résolue en CINQ maillons (compte →
 * fiche → cookie NEXT_LOCALE → Accept-Language → « fr », cf i18n/request.ts) et
 * les trois derniers n'existent que côté Next : le serveur Convex n'en connaît
 * que deux. Servir le guide sur une résolution PLUS COURTE que celle qui a
 * choisi tous les autres mots de la page produirait l'incohérence exacte qu'on
 * veut éviter — un écran anglais avec un guide français « parce que le compte
 * n'a pas de préférence ». L'écran passe donc la langue qu'il rend réellement.
 *
 * Ce n'est pas un contrôle d'accès : le jeu de chaque langue est du contenu
 * `published` du MÊME projet, déjà lisible par ce créateur. Choisir sa langue
 * n'ouvre rien.
 */
export const listMyModules = creatorQuery({
  args: { locale: v.optional(v.string()) },
  handler: async (ctx, args) =>
    readPublishedModules(ctx, ctx.projectId, readerLocale(args.locale)),
});

/**
 * Variante « voir l'espace d'un créateur » — MÊME contenu que listMyModules
 * (modules published du projet). Le guide est per-projet : creatorId est
 * seulement utilisé par le wrapper pour gater l'accès (creator ∈ projet).
 *
 * La langue passée est celle de la personne OBSERVÉE (provider next-intl
 * imbriqué de la preview), pas celle de l'admin : sinon la preview cesserait de
 * montrer ce qu'elle prétend montrer — le défaut corrigé en §11.5.
 */
export const listModulesAsAdmin = adminViewAsQuery({
  args: { locale: v.optional(v.string()) },
  handler: async (ctx, args) =>
    readPublishedModules(ctx, ctx.projectId, readerLocale(args.locale)),
});

// ─── Mutations admin (CRUD + reorder), scopées projet ─────────────────────────

function normalizeTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ConvexError("Titre du module requis.");
  }
  if (trimmed.length > TITLE_MAX) {
    throw new ConvexError(`Titre trop long (max ${TITLE_MAX} caractères).`);
  }
  return trimmed;
}

function checkContent(content: string): string {
  if (content.length > CONTENT_MAX) {
    throw new ConvexError(`Contenu trop long (max ${CONTENT_MAX} caractères).`);
  }
  return content;
}

/**
 * Langue d'ÉCRITURE d'un module. À l'inverse de la lecture — qui tolère tout et
 * retombe sur le défaut — une valeur inconnue est REFUSÉE ici : un module rangé
 * dans une langue qui n'existe pas serait invisible pour tout le monde, sans
 * rien à l'écran pour le dire. Absente ⇒ français, et écrite EXPLICITEMENT :
 * une ligne créée après ce champ n'est jamais ambiguë.
 */
function normalizeModuleLocale(raw: string | undefined): Locale {
  if (raw === undefined) return DEFAULT_LOCALE;
  const loc = normalizeLocale(raw);
  if (loc === null) throw new ConvexError(`Langue inconnue : ${raw}.`);
  return loc;
}

/**
 * Crée un module en fin de liste DE SA LANGUE (order = max du jeu + 1).
 *
 * L'ordre est par jeu : deux jeux numérotés indépendamment se lisent chacun dans
 * l'ordre voulu, et créer un module anglais ne décale rien côté français.
 */
export const createModule = permissionMutation("guide.manage")({
  args: {
    title: v.string(),
    contentMarkdown: v.string(),
    status: v.union(v.literal("published"), v.literal("draft")),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const title = normalizeTitle(args.title);
    const contentMarkdown = checkContent(args.contentMarkdown);
    const locale = normalizeModuleLocale(args.locale);
    const existing = (
      await ctx.db
        .query("guideModules")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter((m) => moduleLocale(m) === locale);
    const nextOrder =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((m) => m.order)) + 1;
    const now = Date.now();
    return await ctx.db.insert("guideModules", {
      projectId: ctx.projectId,
      title,
      contentMarkdown,
      order: nextOrder,
      status: args.status,
      locale,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch partiel (titre / contenu / statut / langue). Scope projet vérifié.
 *
 * CHANGER DE LANGUE, c'est CHANGER DE JEU : le module est reposé EN FIN du jeu
 * d'arrivée, exactement comme s'il y avait été créé. Conserver son `order`
 * l'insérerait à un rang arbitraire au milieu d'un guide qu'il ne connaît pas,
 * voire à égalité avec un module existant.
 */
export const updateModule = permissionMutation("guide.manage")({
  args: {
    id: v.id("guideModules"),
    title: v.optional(v.string()),
    contentMarkdown: v.optional(v.string()),
    status: v.optional(v.union(v.literal("published"), v.literal("draft"))),
    locale: v.optional(v.string()),
    /** `true` désigne CE module comme le guide warmup ; `false` le libère. */
    isWarmupGuide: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("Module introuvable.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = normalizeTitle(args.title);
    if (args.contentMarkdown !== undefined) {
      patch.contentMarkdown = checkContent(args.contentMarkdown);
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.locale !== undefined) {
      const locale = normalizeModuleLocale(args.locale);
      if (locale !== moduleLocale(existing)) {
        const target = (
          await ctx.db
            .query("guideModules")
            .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
            .collect()
        ).filter((m) => moduleLocale(m) === locale);
        patch.locale = locale;
        patch.order =
          target.length === 0
            ? 0
            : Math.max(...target.map((m) => m.order)) + 1;
      }
    }
    if (args.isWarmupGuide !== undefined) {
      if (args.isWarmupGuide) {
        // TRANSFERT, pas simple attribution : on retire le slot à tout autre
        // module de la MÊME langue dans ce projet. C'est ce qui rend deux
        // porteurs impossibles — pas une convention, une écriture.
        const cible = (patch.locale as Locale | undefined) ?? moduleLocale(existing);
        const freres = await ctx.db
          .query("guideModules")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect();
        for (const m of freres) {
          if (m._id === args.id) continue;
          if (m.slot !== WARMUP_SLOT) continue;
          if (moduleLocale(m) !== cible) continue;
          await ctx.db.patch(m._id, { slot: undefined, updatedAt: Date.now() });
        }
        patch.slot = WARMUP_SLOT;
      } else {
        patch.slot = undefined;
      }
    }
    await ctx.db.patch(args.id, patch);
  },
});

/**
 * CONTRÔLE BRUYANT — combien de modules portent le slot warmup, par projet et
 * par langue. Doit valoir 0 ou 1 partout.
 *
 * Le transfert rend l'invariant vrai à l'écriture ; ceci le vérifie sur les
 * données, y compris celles écrites avant qu'il existe. Rendu par une query
 * INTERNE, pas par un écran : c'est un audit d'exploitation.
 *   ./scripts/convex-prod.sh run migrations:auditWarmupSlot '{}'
 */

/** Suppression (scope projet vérifié). */
export const deleteModule = permissionMutation("guide.manage")({
  args: { id: v.id("guideModules") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new ConvexError("Module introuvable.");
    }
    await ctx.db.delete(args.id);
  },
});

/**
 * Réordonne par échange d'`order` avec le voisin (haut/bas) dans la liste triée
 * du projet, DANS SA LANGUE. Aux bornes (déjà en tête/fin) : no-op. Robuste et
 * simple (pas de drag-and-drop) — suffisant pour qq dizaines de modules.
 *
 * Le voisinage est celui du JEU, pas du projet : sans ce filtre, « monter » un
 * module anglais irait échanger son rang avec un module français — un clic sans
 * effet visible dans la liste de gauche, et un guide français réordonné dans le
 * dos de l'admin.
 */
export const moveModule = permissionMutation("guide.manage")({
  args: {
    id: v.id("guideModules"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.id);
    if (!current || current.projectId !== ctx.projectId) {
      throw new ConvexError("Module introuvable.");
    }
    const locale = moduleLocale(current);
    const siblings = (
      await ctx.db
        .query("guideModules")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    )
      .filter((m) => moduleLocale(m) === locale)
      .sort(byOrder);
    const idx = siblings.findIndex((m) => m._id === args.id);
    const neighborIdx = args.direction === "up" ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= siblings.length) return; // borne
    const neighbor = siblings[neighborIdx];
    const now = Date.now();
    // Échange des order (départage identique garanti car order distincts).
    await ctx.db.patch(current._id, { order: neighbor.order, updatedAt: now });
    await ctx.db.patch(neighbor._id, { order: current.order, updatedAt: now });
  },
});

// ─── Cleanup e2e (par marqueur [E2E_TEST] dans le titre) ──────────────────────

export const cleanupTestGuideModules = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("guideModules").collect();
    let deleted = 0;
    for (const m of all) {
      if (m.title.startsWith("[E2E_TEST]")) {
        await ctx.db.delete(m._id);
        deleted++;
      }
    }
    return { deleted };
  },
});


// ─── Le module warm-up, adressé par son SLOT ─────────────────────────────────

/**
 * Module marqué `slot: "warmup"`, dans la langue du lecteur (repli FR comme le
 * reste du guide). Sert le bouton « Guide warmup » de l'écran comptes : le
 * protocole se lit sans quitter le tracker, et il n'existe plus qu'en un seul
 * exemplaire — c'est toute la fusion.
 *
 * Adressé par SLOT et non par titre : le titre appartient à l'admin, qui peut
 * le renommer sans savoir qu'un écran en dépend.
 */
async function warmupModuleFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  requestedLocale: Locale,
) {
  const modules = await ctx.db
    .query("guideModules")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const published = modules.filter(
    (m) => m.status === "published" && m.slot === "warmup",
  );
  const { modules: selected, servedLocale } = selectModulesForLocale(
    published,
    requestedLocale,
  );
  const m = selected.sort(byOrder)[0];
  return {
    requestedLocale,
    servedLocale,
    module: m
      ? { _id: m._id, title: m.title, contentMarkdown: m.contentMarkdown }
      : null,
  };
}

/** Lecture créateur (portail). */
export const getMyWarmupModule = creatorQuery({
  args: { locale: v.optional(v.string()) },
  handler: async (ctx, args) =>
    warmupModuleFor(ctx, ctx.projectId, readerLocale(args.locale)),
});

/** Lecture ADMIN — même contenu, depuis l'écran comptes interne. */
export const getWarmupModuleForAdmin = permissionQuery("guide.manage")({
  args: { locale: v.optional(v.string()) },
  handler: async (ctx, args) =>
    warmupModuleFor(ctx, ctx.projectId, readerLocale(args.locale)),
});

/**
 * e2e — marque un module comme étant CELUI du warmup. En production c'est la
 * migration `fuseWarmupGuide` qui pose le slot ; l'éditeur admin ne l'expose
 * pas encore (un seul module par projet doit le porter, et rien ne l'impose
 * côté écran aujourd'hui — cf « À arbitrer »).
 */
export const e2eSetModuleSlot = e2eMutation({
  args: { id: v.id("guideModules"), slot: v.string() },
  handler: async (ctx, { id, slot }) => {
    await ctx.db.patch(id, { slot, updatedAt: Date.now() });
    return { slot };
  },
});
