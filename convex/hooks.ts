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
    hideUsed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const hooks = await ctx.db.query("hooks").collect();
    const publications = await ctx.db.query("publications").collect();

    type Usage = {
      publishedCount: number;
      draftCount: number;
      accountsUsed: Set<string>;
      lastPublishedAt: number | null;
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
      usageByHookId.set(key, u);
    }

    let results = hooks.map((h) => {
      const u = usageByHookId.get(h._id as unknown as string);
      return {
        ...h,
        publishedCount: u?.publishedCount ?? 0,
        draftCount: u?.draftCount ?? 0,
        accountsUsed: u ? Array.from(u.accountsUsed).sort() : [],
        lastPublishedAt: u?.lastPublishedAt ?? null,
      };
    });

    if (args.langue) results = results.filter((h) => h.langue === args.langue);
    if (args.mecanique)
      results = results.filter((h) => h.mecanique === args.mecanique);
    if (args.niveau)
      results = results.filter((h) => h.niveau === args.niveau);
    if (args.search && args.search.length > 0) {
      const q = args.search.toLowerCase();
      results = results.filter((h) => h.text.toLowerCase().includes(q));
    }
    if (args.hideUsed) {
      results = results.filter((h) => h.publishedCount === 0);
    }

    results.sort((a, b) =>
      a.text.localeCompare(b.text, "fr", { sensitivity: "base" }),
    );

    return results;
  },
});
