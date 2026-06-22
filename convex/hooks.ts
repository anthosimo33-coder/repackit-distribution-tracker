import { e2eMutation, adminQuery } from "./functions";
import { v } from "convex/values";
import { coerceSnapshotAge } from "./snapshotMatching";
import { resolveDisplayMetrics } from "./metricsDisplay";

export const countHooks = adminQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("hooks")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return all.length;
  },
});

// P2 — seed/clear e2e-gated PAR PROJET (projectId explicite : pas de session,
// donc pas de membership ; le caller — run-seed.ts / e2e — fournit l'id).
export const seedHooks = e2eMutation({
  args: {
    projectId: v.id("projects"),
    hooks: v.array(
      v.object({
        text: v.string(),
        mecanique: v.union(
          v.literal("Erreur"),
          v.literal("Volume"),
          v.literal("Comparaison"),
          v.literal("Contradiction"),
          v.literal("Universalité"),
          v.literal("Question"),
        ),
        niveau: v.union(
          v.literal("Broad-A"),
          v.literal("Broad-B"),
          v.literal("Niché"),
        ),
        langue: v.union(v.literal("FR"), v.literal("EN")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hooks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (existing.length > 0) {
      // Idempotent : déjà seedé pour ce projet → no-op (setup e2e relançable).
      return { inserted: 0, alreadySeeded: true };
    }

    let count = 0;
    for (const hook of args.hooks) {
      await ctx.db.insert("hooks", { projectId: args.projectId, ...hook });
      count++;
    }
    return { inserted: count };
  },
});

export const clearHooks = e2eMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("hooks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const h of all) {
      await ctx.db.delete(h._id);
    }
    return { deleted: all.length };
  },
});

export const listHooks = adminQuery({
  args: {
    langue: v.optional(v.union(v.literal("FR"), v.literal("EN"))),
    mecanique: v.optional(
      v.union(
        v.literal("Erreur"),
        v.literal("Volume"),
        v.literal("Comparaison"),
        v.literal("Contradiction"),
        v.literal("Universalité"),
        v.literal("Question"),
      ),
    ),
    niveau: v.optional(
      v.union(
        v.literal("Broad-A"),
        v.literal("Broad-B"),
        v.literal("Niché"),
      ),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db
      .query("hooks")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    if (args.langue) results = results.filter((h) => h.langue === args.langue);
    if (args.mecanique)
      results = results.filter((h) => h.mecanique === args.mecanique);
    if (args.niveau)
      results = results.filter((h) => h.niveau === args.niveau);
    if (args.search && args.search.length > 0) {
      const q = args.search.toLowerCase();
      results = results.filter((h) => h.text.toLowerCase().includes(q));
    }

    // Alphabetical sort, case-insensitive, locale-aware
    results.sort((a, b) =>
      a.text.localeCompare(b.text, "fr", { sensitivity: "base" }),
    );

    return results;
  },
});

/**
 * Liste les hooks avec leur historique d'usage agrégé par hookId.
 *
 * Stratégie : 1 collect publications + groupBy en mémoire. Plus simple et
 * plus rapide qu'un withIndex(by_hookId).eq(...) par hook (490 round-trips
 * Convex). L'index by_hookId existe quand même pour les futurs lookups
 * directs « toutes les pubs d'un hook donné » (cf TECH_DEBT TD-005).
 *
 * isPublished côté serveur : un draft a postUrl undefined ou string vide.
 * Cohérent avec lib/publication-status.ts (source unique de vérité côté
 * client). Dupliqué ici parce qu'on ne peut pas importer de lib/ depuis
 * un module Convex (chaque côté a son tsconfig).
 *
 * Batch 3 Modif 6 — refonte : compteurs split par mediaType. Les anciens
 * publishedCount / draftCount / variantsCount disparaissent du return
 * (refonte complète, pas de backward compat — seul callsite est HookCard).
 * accountsUsed et lastPublishedAt restent agrégés tous formats (status quo).
 *
 * NOTE TD-005 (aggravation) : la map carouselsByParentAncreByFormat double
 * la surface mémoire serveur (une map par mediaType au lieu d'une). Au
 * volume actuel (~10 pubs prod) impact négligeable. À 5000+ pubs, à
 * surveiller.
 */
// Refinement SR — MediaTypeServer retiré du module (n'était utilisé que
// dans listHooksWithUsage qui scope désormais aux 2 formats carousel|short).
// getHookVariants utilise le validator inline (cf args plus bas).

export const listHooksWithUsage = adminQuery({
  args: {
    langue: v.optional(v.union(v.literal("FR"), v.literal("EN"))),
    // Multi-select v2 : mecanique et niveau passent en array. undefined ou
    // array vide = "tous" (pas de filtre). cf app/hooks/page.tsx qui envoie
    // undefined si la Set est vide.
    mecanique: v.optional(
      v.array(
        v.union(
          v.literal("Erreur"),
          v.literal("Volume"),
          v.literal("Comparaison"),
          v.literal("Contradiction"),
          v.literal("Universalité"),
          v.literal("Question"),
        ),
      ),
    ),
    niveau: v.optional(
      v.array(
        v.union(
          v.literal("Broad-A"),
          v.literal("Broad-B"),
          v.literal("Niché"),
        ),
      ),
    ),
    search: v.optional(v.string()),
    hideUsed: v.optional(v.boolean()),
    hideDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const hooks = await ctx.db
      .query("hooks")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    // Refinement Shorts — les Shorts ne sont plus comptés dans la biblio
    // hooks (cohérent avec le retrait SR précédent). Le concept "hook" pour
    // un Short se réduit à texte + langue (mécanique/niveau sont des
    // sentinelles inertes). La biblio hooks devient donc EXCLUSIVEMENT
    // carrousel. Les Shorts/SR pré-existants gardent un hookId orphelin en
    // DB (rétrocompat lecture seule) mais ne contribuent plus aux compteurs
    // publishedShortsCount / draftShortsCount / variantsCountShort — ces
    // champs sont retirés du return shape.
    type Usage = {
      publishedCarouselsCount: number;
      draftCarouselsCount: number;
      accountsUsed: Set<string>;
      lastPublishedAt: number | null;
      // Groupement parent ancré pour le comptage des variantes carrousel.
      // Plus de split par mediaType : seuls les carrousels sont comptés.
      carouselsByParentAncre: Map<string, Set<string>>;
    };
    const usageByHookId = new Map<string, Usage>();

    for (const pub of publications) {
      if (pub.hookId === null) continue;
      // Refinement Shorts — seuls les carrousels comptent désormais. Shorts
      // et ScreenRecorders sont exclus (leur hookId orphelin éventuel ne
      // contribue pas aux compteurs de la biblio hooks).
      const pubMediaType = pub.mediaType ?? "carousel";
      if (pubMediaType !== "carousel") continue;
      const key = pub.hookId as unknown as string;
      const u =
        usageByHookId.get(key) ??
        ({
          publishedCarouselsCount: 0,
          draftCarouselsCount: 0,
          accountsUsed: new Set<string>(),
          lastPublishedAt: null,
          carouselsByParentAncre: new Map<string, Set<string>>(),
        } satisfies Usage);

      const isPub =
        typeof pub.postUrl === "string" && pub.postUrl.length > 0;
      if (isPub) {
        u.publishedCarouselsCount += 1;
        u.accountsUsed.add(pub.compte);
        if (
          u.lastPublishedAt === null ||
          pub.datePubli > u.lastPublishedAt
        ) {
          u.lastPublishedAt = pub.datePubli;
        }
      } else {
        u.draftCarouselsCount += 1;
      }

      // Agrégation variantsCount carrousel : tous les duplicats d'une même
      // lignée pointent vers le carouselId original (cf duplicateCarousel)
      // → ils tombent dans le même bucket [parentAncre].
      const parentAncre = pub.parentCarouselId ?? pub.carouselId;
      let bucket = u.carouselsByParentAncre.get(parentAncre);
      if (!bucket) {
        bucket = new Set<string>();
        u.carouselsByParentAncre.set(parentAncre, bucket);
      }
      bucket.add(pub.carouselId);

      usageByHookId.set(key, u);
    }

    function variantsCountCarouselFor(u: Usage | undefined): number {
      if (!u) return 0;
      let count = 0;
      for (const distinctIds of u.carouselsByParentAncre.values()) {
        if (distinctIds.size >= 2) count += distinctIds.size;
      }
      return count;
    }

    // Refinement Shorts — return shape sans les champs *Shorts*
    // (publishedShortsCount / draftShortsCount / variantsCountShort). Le
    // seul callsite (HookCard dans app/biblio-hooks/page.tsx) est adapté
    // dans le même commit.
    let results = hooks.map((h) => {
      const u = usageByHookId.get(h._id as unknown as string);
      return {
        ...h,
        publishedCarouselsCount: u?.publishedCarouselsCount ?? 0,
        draftCarouselsCount: u?.draftCarouselsCount ?? 0,
        variantsCountCarousel: variantsCountCarouselFor(u),
        accountsUsed: u ? Array.from(u.accountsUsed).sort() : [],
        lastPublishedAt: u?.lastPublishedAt ?? null,
      };
    });

    if (args.langue) results = results.filter((h) => h.langue === args.langue);
    if (args.mecanique && args.mecanique.length > 0) {
      const set = new Set(args.mecanique);
      results = results.filter((h) => set.has(h.mecanique));
    }
    if (args.niveau && args.niveau.length > 0) {
      const set = new Set(args.niveau);
      results = results.filter((h) => set.has(h.niveau));
    }
    if (args.search && args.search.length > 0) {
      const q = args.search.toLowerCase();
      results = results.filter((h) => h.text.toLowerCase().includes(q));
    }
    // hideUsed / hideDraft : carrousel uniquement désormais (un hook est
    // "used" s'il a au moins 1 carrousel publié, idem "draft").
    if (args.hideUsed) {
      results = results.filter((h) => h.publishedCarouselsCount === 0);
    }
    if (args.hideDraft) {
      results = results.filter((h) => h.draftCarouselsCount === 0);
    }

    results.sort((a, b) =>
      a.text.localeCompare(b.text, "fr", { sensitivity: "base" }),
    );

    return results;
  },
});

/**
 * Modif 5 — Liste les variantes d'un hook (rows des groupes de duplicats).
 *
 * "Variante" ici = ROW d'un carrousel appartenant à un groupe de >= 2
 * carouselIds distincts (parent ancré + descendants). Diffère de
 * variantsCount qui compte les carouselIds distincts : ici on retourne CHAQUE
 * row (1 par plateforme/compte) pour permettre la comparaison côte à côte.
 *
 * Tri : saveRate desc (null en bas), datePubli desc en tie-break.
 *
 * Helpers calculateSaveRate/calculateVerdict ré-implémentés inline (pas
 * d'import cross-tsconfig depuis lib/verdict.ts). Logique identique.
 */
export const getHookVariants = adminQuery({
  args: {
    hookId: v.id("hooks"),
    // Batch 3 Modif 6 — filtre optional par mediaType. Si défini, ne garde
    // que les pubs du format demandé avant d'agréger en groupes variantes.
    // Permet à HookVariantsPopover de scoper ses 2 boutons (carousel /
    // short) sur le format approprié. Si undefined : behavior antérieur
    // (tous formats), conservé pour compat des callsites existants.
    mediaType: v.optional(
      v.union(
        v.literal("carousel"),
        v.literal("short"),
        v.literal("screenrecorder"),
      ),
    ),
    // Refactor multi-snapshots — saveRate/verdict des variantes calculés sur
    // le snapshot correspondant à la période globale (cohérence biblio-hooks
    // ↔ tracker). Optional → "latest".
    snapshotAge: v.optional(v.string()),
    customDay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const age = coerceSnapshotAge(args.snapshotAge);
    const allPubs = await ctx.db
      .query("publications")
      .withIndex("by_project_hookId", (q) =>
        q.eq("projectId", ctx.projectId).eq("hookId", args.hookId),
      )
      .collect();

    // Filtre mediaType en amont. Coercion inline (pas d'import lib/).
    const pubs =
      args.mediaType === undefined
        ? allPubs
        : allPubs.filter(
            (p) => (p.mediaType ?? "carousel") === args.mediaType,
          );

    // 1. Identifie les "groupes variantes" : parent ancré → Set des carouselIds
    //    distincts. Garde uniquement les groupes de taille >= 2.
    const carouselsByParentAncre = new Map<string, Set<string>>();
    for (const p of pubs) {
      const parentAncre = p.parentCarouselId ?? p.carouselId;
      let bucket = carouselsByParentAncre.get(parentAncre);
      if (!bucket) {
        bucket = new Set<string>();
        carouselsByParentAncre.set(parentAncre, bucket);
      }
      bucket.add(p.carouselId);
    }
    const variantParentAncres = new Set<string>();
    for (const [parentAncre, distinctIds] of carouselsByParentAncre) {
      if (distinctIds.size >= 2) variantParentAncres.add(parentAncre);
    }

    // 2. Collecte les ROWS dans ces groupes (1 entrée par plateforme/compte
    //    pour permettre la comparaison côte à côte).
    const variants = await Promise.all(
      pubs
        .filter((p) =>
          variantParentAncres.has(p.parentCarouselId ?? p.carouselId),
        )
        .map(async (p) => {
          const isPublished =
            typeof p.postUrl === "string" && p.postUrl.length > 0;
          // Vue "latest" → dénormalisé (0 lecture) ; âgé → range-scan borné de
          // cette publication (cf resolveDisplayMetrics).
          const dm = await resolveDisplayMetrics(ctx, p, age, args.customDay);
          const saveRate =
            dm.saves === null || dm.vues === null || dm.vues === 0
              ? null
              : dm.saves / dm.vues;
          let verdict: "WINNER" | "MOYEN" | "FOLD" | null = null;
          if (isPublished && saveRate !== null) {
            if (saveRate >= 0.03) verdict = "WINNER";
            else if (saveRate >= 0.01) verdict = "MOYEN";
            else verdict = "FOLD";
          }
          return {
            carouselId: p.carouselId,
            compte: p.compte,
            plateforme: p.plateforme,
            isPublished,
            verdict,
            saveRate,
            datePubli: p.datePubli,
          };
        }),
    );

    // 3. Tri saveRate desc (null = -Infinity → en bas), datePubli desc
    //    en tie-break. Aligné avec la convention "null < tout nombre".
    variants.sort((a, b) => {
      const ra = a.saveRate ?? -Infinity;
      const rb = b.saveRate ?? -Infinity;
      if (ra !== rb) return rb - ra;
      return b.datePubli - a.datePubli;
    });

    return variants;
  },
});
