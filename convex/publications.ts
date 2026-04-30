import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const mecaniqueValidator = v.union(
  v.literal("Erreur"),
  v.literal("Volume"),
  v.literal("Comparaison"),
  v.literal("Contradiction"),
  v.literal("Universalité"),
  v.literal("Question"),
);

const niveauValidator = v.union(
  v.literal("Broad-A"),
  v.literal("Broad-B"),
  v.literal("Niché"),
);

const formatValidator = v.union(
  v.literal("A"),
  v.literal("B"),
  v.literal("C"),
  v.literal("D"),
  v.literal("E"),
  v.literal("F"),
  v.literal("G"),
  v.literal("H"),
);

const angleValidator = v.union(
  v.literal("Psycho"),
  v.literal("Accusatoire"),
  v.literal("Pédagogique"),
  v.literal("Observation"),
  v.literal("Provocant"),
);

const langueValidator = v.union(v.literal("FR"), v.literal("EN"));

const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
);

export const createPublication = mutation({
  args: {
    carouselId: v.string(),
    hookId: v.union(v.id("hooks"), v.null()),
    hookText: v.string(),
    mecanique: mecaniqueValidator,
    niveau: niveauValidator,
    format: formatValidator,
    nbSlides: v.number(),
    slides: v.array(
      v.object({ position: v.number(), texte: v.string() }),
    ),
    angleTonal: angleValidator,
    langue: langueValidator,
    plateformes: v.array(plateformeValidator),
    compte: v.string(),
    datePubli: v.number(),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const plateforme of args.plateformes) {
      const id = await ctx.db.insert("publications", {
        carouselId: args.carouselId,
        hookId: args.hookId,
        hookText: args.hookText,
        mecanique: args.mecanique,
        niveau: args.niveau,
        format: args.format,
        nbSlides: args.nbSlides,
        slides: args.slides,
        angleTonal: args.angleTonal,
        langue: args.langue,
        plateforme,
        compte: args.compte,
        datePubli: args.datePubli,
        vuesJ1: null,
        vuesJ3: null,
        vuesJ7: null,
        saves: null,
        commentsTotal: null,
        commentsAudit: null,
        profileVisits: null,
        notes: args.notes,
      });
      ids.push(id);
    }
    return { ids };
  },
});

export const getNextCarouselId = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("publications").collect();
    if (all.length === 0) return "C001";

    const numbers = all
      .map((p) => p.carouselId)
      .map((id) => parseInt(id.replace(/^C/, ""), 10))
      .filter((n) => !isNaN(n));

    const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `C${String(maxNumber + 1).padStart(3, "0")}`;
  },
});

export const listPublications = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("publications")
      .withIndex("by_datePubli")
      .order("desc")
      .collect();
  },
});
