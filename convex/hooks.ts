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
 */
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
      publishedCount: number;
      draftCount: number;
      accountsUsed: Set<string>;
      lastPublishedAt: number | null;
      // Modif 3 : groupement par parent ancré (parentCarouselId ?? carouselId).
      // Pour chaque groupe, on stocke le Set des carouselIds distincts pour
      // que 1 carrousel multi-plateforme (= 2 rows même carouselId) ne compte
      // que 1. variantsCount = somme des tailles des groupes >= 2.
      carouselsByParentAncre: Map<string, Set<string>>;
    };
    const usageByHookId = new Map<string, Usage>();

    for (const pub of publications) {
      if (pub.hookId === null) continue;
      const key = pub.hookId as unknown as string;
      const u =
        usageByHookId.get(key) ??
        ({
          publishedCount: 0,
          draftCount: 0,
          accountsUsed: new Set<string>(),
          lastPublishedAt: null,
          carouselsByParentAncre: new Map<string, Set<string>>(),
        } satisfies Usage);

      const isPub =
        typeof pub.postUrl === "string" && pub.postUrl.length > 0;
      if (isPub) {
        u.publishedCount += 1;
        u.accountsUsed.add(pub.compte);
        if (
          u.lastPublishedAt === null ||
          pub.datePubli > u.lastPublishedAt
        ) {
          u.lastPublishedAt = pub.datePubli;
        }
      } else {
        u.draftCount += 1;
      }

      // Agrégation variantsCount : key = parent ancré. Tous les duplicats
      // d'une même lignée pointent vers le carouselId original (cf
      // duplicateCarousel) → ils tombent dans le même bucket que l'original.
      const parentAncre = pub.parentCarouselId ?? pub.carouselId;
      let bucket = u.carouselsByParentAncre.get(parentAncre);
      if (!bucket) {
        bucket = new Set<string>();
        u.carouselsByParentAncre.set(parentAncre, bucket);
      }
      bucket.add(pub.carouselId);

      usageByHookId.set(key, u);
    }

    let results = hooks.map((h) => {
      const u = usageByHookId.get(h._id as unknown as string);
      let variantsCount = 0;
      if (u) {
        for (const distinctCarouselIds of u.carouselsByParentAncre.values()) {
          if (distinctCarouselIds.size >= 2) {
            variantsCount += distinctCarouselIds.size;
          }
        }
      }
      return {
        ...h,
        publishedCount: u?.publishedCount ?? 0,
        draftCount: u?.draftCount ?? 0,
        accountsUsed: u ? Array.from(u.accountsUsed).sort() : [],
        lastPublishedAt: u?.lastPublishedAt ?? null,
        variantsCount,
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
    if (args.hideUsed) {
      results = results.filter((h) => h.publishedCount === 0);
    }
    // hideDraft est indépendant de hideUsed et combinable :
    //   aucun        → tout
    //   hideUsed     → publishedCount === 0 (peut avoir des drafts)
    //   hideDraft    → draftCount === 0     (peut avoir des publiés)
    //   les deux     → 100 % frais (publishedCount === 0 ET draftCount === 0)
    if (args.hideDraft) {
      results = results.filter((h) => h.draftCount === 0);
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
  args: { hookId: v.id("hooks") },
  handler: async (ctx, args) => {
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_hookId", (q) => q.eq("hookId", args.hookId))
      .collect();

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
