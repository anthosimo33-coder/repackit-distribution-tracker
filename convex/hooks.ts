import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const countHooks = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("hooks").collect();
    return all.length;
  },
});

export const seedHooks = mutation({
  args: {
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
    const existing = await ctx.db.query("hooks").take(1);
    if (existing.length > 0) {
      throw new Error(
        "Table 'hooks' already seeded. Run clearHooks first if you want to re-seed.",
      );
    }

    let count = 0;
    for (const hook of args.hooks) {
      await ctx.db.insert("hooks", hook);
      count++;
    }
    return { inserted: count };
  },
});

export const clearHooks = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("hooks").collect();
    for (const h of all) {
      await ctx.db.delete(h._id);
    }
    return { deleted: all.length };
  },
});

export const listHooks = query({
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
    let results = await ctx.db.query("hooks").collect();

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
type MediaTypeServer = "carousel" | "short";

export const listHooksWithUsage = query({
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
    const hooks = await ctx.db.query("hooks").collect();
    const publications = await ctx.db.query("publications").collect();

    type Usage = {
      publishedCarouselsCount: number;
      publishedShortsCount: number;
      draftCarouselsCount: number;
      draftShortsCount: number;
      accountsUsed: Set<string>;
      lastPublishedAt: number | null;
      // Batch 3 Modif 6 : groupement parent ancré séparé par mediaType.
      // Une lignée de duplicats partage UN seul mediaType (cf duplicate
      // Carousel qui propage source.mediaType). Donc un parentAncre ne
      // figure que dans UNE des 2 sous-maps.
      carouselsByParentAncreByFormat: Map<
        MediaTypeServer,
        Map<string, Set<string>>
      >;
    };
    const usageByHookId = new Map<string, Usage>();

    for (const pub of publications) {
      if (pub.hookId === null) continue;
      const key = pub.hookId as unknown as string;
      const u =
        usageByHookId.get(key) ??
        ({
          publishedCarouselsCount: 0,
          publishedShortsCount: 0,
          draftCarouselsCount: 0,
          draftShortsCount: 0,
          accountsUsed: new Set<string>(),
          lastPublishedAt: null,
          carouselsByParentAncreByFormat: new Map<
            MediaTypeServer,
            Map<string, Set<string>>
          >(),
        } satisfies Usage);

      // Coercion mediaType côté serveur (pas d'import lib/media-type.ts
      // possible, cf cross-tsconfig). Logique alignée avec getMediaType().
      const mediaType: MediaTypeServer = pub.mediaType ?? "carousel";
      const isPub =
        typeof pub.postUrl === "string" && pub.postUrl.length > 0;
      if (isPub) {
        if (mediaType === "carousel") u.publishedCarouselsCount += 1;
        else u.publishedShortsCount += 1;
        u.accountsUsed.add(pub.compte);
        if (
          u.lastPublishedAt === null ||
          pub.datePubli > u.lastPublishedAt
        ) {
          u.lastPublishedAt = pub.datePubli;
        }
      } else {
        if (mediaType === "carousel") u.draftCarouselsCount += 1;
        else u.draftShortsCount += 1;
      }

      // Agrégation variantsCount intra-format : 2 sous-maps par mediaType.
      // Tous les duplicats d'une même lignée pointent vers le carouselId
      // original (cf duplicateCarousel) ET partagent le mediaType source
      // (la duplication ne change jamais de format) → ils tombent dans le
      // même bucket sous-map[mediaType][parentAncre].
      let formatMap = u.carouselsByParentAncreByFormat.get(mediaType);
      if (!formatMap) {
        formatMap = new Map<string, Set<string>>();
        u.carouselsByParentAncreByFormat.set(mediaType, formatMap);
      }
      const parentAncre = pub.parentCarouselId ?? pub.carouselId;
      let bucket = formatMap.get(parentAncre);
      if (!bucket) {
        bucket = new Set<string>();
        formatMap.set(parentAncre, bucket);
      }
      bucket.add(pub.carouselId);

      usageByHookId.set(key, u);
    }

    function variantsCountFor(
      u: Usage | undefined,
      mediaType: MediaTypeServer,
    ): number {
      if (!u) return 0;
      const formatMap = u.carouselsByParentAncreByFormat.get(mediaType);
      if (!formatMap) return 0;
      let count = 0;
      for (const distinctIds of formatMap.values()) {
        if (distinctIds.size >= 2) count += distinctIds.size;
      }
      return count;
    }

    let results = hooks.map((h) => {
      const u = usageByHookId.get(h._id as unknown as string);
      return {
        ...h,
        publishedCarouselsCount: u?.publishedCarouselsCount ?? 0,
        publishedShortsCount: u?.publishedShortsCount ?? 0,
        draftCarouselsCount: u?.draftCarouselsCount ?? 0,
        draftShortsCount: u?.draftShortsCount ?? 0,
        variantsCountCarousel: variantsCountFor(u, "carousel"),
        variantsCountShort: variantsCountFor(u, "short"),
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
    // hideUsed / hideDraft : agrégés tous formats (un hook est "used" s'il
    // a au moins 1 pub publiée tous formats confondus, idem "draft").
    if (args.hideUsed) {
      results = results.filter(
        (h) =>
          h.publishedCarouselsCount === 0 && h.publishedShortsCount === 0,
      );
    }
    if (args.hideDraft) {
      results = results.filter(
        (h) => h.draftCarouselsCount === 0 && h.draftShortsCount === 0,
      );
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
export const getHookVariants = query({
  args: {
    hookId: v.id("hooks"),
    // Batch 3 Modif 6 — filtre optional par mediaType. Si défini, ne garde
    // que les pubs du format demandé avant d'agréger en groupes variantes.
    // Permet à HookVariantsPopover de scoper ses 2 boutons (carousel /
    // short) sur le format approprié. Si undefined : behavior antérieur
    // (tous formats), conservé pour compat des callsites existants.
    mediaType: v.optional(
      v.union(v.literal("carousel"), v.literal("short")),
    ),
  },
  handler: async (ctx, args) => {
    const allPubs = await ctx.db
      .query("publications")
      .withIndex("by_hookId", (q) => q.eq("hookId", args.hookId))
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
    const variants = pubs
      .filter((p) =>
        variantParentAncres.has(p.parentCarouselId ?? p.carouselId),
      )
      .map((p) => {
        const isPublished =
          typeof p.postUrl === "string" && p.postUrl.length > 0;
        const saveRate =
          p.saves === null || p.vuesJ7 === null || p.vuesJ7 === 0
            ? null
            : p.saves / p.vuesJ7;
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
      });

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
