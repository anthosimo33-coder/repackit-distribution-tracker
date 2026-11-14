/**
 * RADAR — FAMILLES DE HOOKS d'une langue à l'autre. Toutes les 6 h, les hooks
 * repris par au moins deux comptes et pas encore rangés partent chez Claude Haiku
 * avec les familles connues ; chacun rejoint une famille ou en ouvre une
 * (règles et validation : convex/radarFamiliesMath). Payé sur le poste « Analyse
 * IA » du budget du Radar, en dollars, coupé le premier ; sans ANTHROPIC_API_KEY,
 * rien ne part.
 */
import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { allowanceUsd, budgetState } from "./radarSignalsMath";
import {
  addExample,
  FAMILY_BATCH,
  FAMILY_KNOWN_MAX,
  FAMILY_KNOWN_WINDOW_MS,
  FAMILY_MODEL,
  FAMILY_SCHEMA,
  FAMILY_SYSTEM,
  FAMILY_WINDOW_MS,
  familyPrompt,
  formatLang,
  haikuCostUsd,
  placeAnswer,
  type FamilyCandidate,
  type KnownFamily,
} from "./radarFamiliesMath";

/** Sous ce reste d'enveloppe, on n'appelle pas (un appel coûte moins d'un cent). */
const MIN_ALLOWANCE_USD = 0.01;

type FamilyWork = { candidates: (FamilyCandidate & { lang: string })[]; known: KnownFamily[] };

/** Les hooks à ranger (les plus vus d'abord) et les familles connues. */
export const familyWork = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<FamilyWork> => {
    const recent = await ctx.db
      .query("radarFormats")
      .withIndex("by_last", (q) => q.gte("lastPostAt", now - FAMILY_WINDOW_MS))
      .take(1_000);
    const todo = recent
      .filter((f) => f.kind === "hook" && f.accountCount >= 2 && f.familyCheckedAt === undefined)
      .sort((a, b) => b.maxViews - a.maxViews)
      .slice(0, FAMILY_BATCH);
    const candidates: FamilyWork["candidates"] = [];
    for (const f of todo) {
      const variants = [...new Set(f.members.map((m) => m.hook).filter((h): h is string => !!h))];
      const langs: (string | undefined)[] = [];
      for (const m of f.members.slice(0, 12)) langs.push((await ctx.db.get(m.accountId))?.lang);
      candidates.push({ id: f._id, variants: (variants.length ? variants : [f.label]).slice(0, 3), lang: formatLang(langs) });
    }
    const known = await ctx.db
      .query("radarHookFamilies")
      .withIndex("by_last", (q) => q.gte("lastSeenAt", now - FAMILY_KNOWN_WINDOW_MS))
      .order("desc")
      .take(FAMILY_KNOWN_MAX);
    return { candidates, known: known.map((k) => ({ id: k._id, label: k.label, examples: k.examples.map((e) => e.text) })) };
  },
});

/** Range les hooks : familles nouvelles créées, chaque format relié, ses exemples tenus. */
export const applyFamilies = internalMutation({
  args: {
    now: v.number(),
    placements: v.array(
      v.object({ formatId: v.id("radarFormats"), known: v.optional(v.id("radarHookFamilies")), ref: v.optional(v.string()), lang: v.string(), text: v.string() }),
    ),
    newFamilies: v.array(v.object({ ref: v.string(), label: v.string() })),
  },
  handler: async (ctx, { now, placements, newFamilies }) => {
    const created = new Map<string, Id<"radarHookFamilies">>();
    for (const f of newFamilies) {
      if (!placements.some((p) => p.ref === f.ref)) continue;
      created.set(f.ref, await ctx.db.insert("radarHookFamilies", { label: f.label, examples: [], createdAt: now, lastSeenAt: now }));
    }
    for (const p of placements) {
      const familyId = p.known ?? (p.ref !== undefined ? created.get(p.ref) : undefined);
      const format = await ctx.db.get(p.formatId);
      const family = familyId ? await ctx.db.get(familyId) : null;
      if (!format || !family) continue;
      await ctx.db.patch(format._id, { familyId: family._id, familyCheckedAt: now, lang: p.lang });
      await ctx.db.patch(family._id, { examples: addExample(family.examples, { text: p.text, lang: p.lang }), lastSeenAt: now });
    }
    return { placed: placements.length, families: created.size };
  },
});

export const runFamilies = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped: "no-key" | "budget" | "rien" } | { placed: number; usd: number }> => {
    if (!process.env.ANTHROPIC_API_KEY) return { skipped: "no-key" };
    const now = Date.now();
    const st = await ctx.runQuery(internal.radarSignals.jobState, { now });
    if (allowanceUsd(st.budget, budgetState(st.budget, st.usage, st.balance), "ai") < MIN_ALLOWANCE_USD) return { skipped: "budget" };
    const work: FamilyWork = await ctx.runQuery(internal.radarFamilies.familyWork, { now });
    if (work.candidates.length === 0) return { skipped: "rien" };

    const client = new Anthropic();
    let usd = 0;
    let placed = 0;
    let lastError: string | undefined;
    try {
      const response = await client.messages.create({
        model: FAMILY_MODEL,
        max_tokens: 8_000,
        system: FAMILY_SYSTEM,
        // Ranger, pas raisonner longuement : effort bas.
        output_config: { effort: "low", format: { type: "json_schema", schema: FAMILY_SCHEMA } },
        messages: [{ role: "user", content: familyPrompt(work.candidates, work.known) }],
      });
      usd = haikuCostUsd(response.usage);
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        lastError = `Analyse IA : réponse interrompue (${response.stop_reason})`;
      } else {
        const text = response.content.find((b) => b.type === "text")?.text ?? "";
        const answer = placeAnswer(JSON.parse(text), work.candidates, work.known);
        const byId = new Map(work.candidates.map((c) => [c.id, c]));
        await ctx.runMutation(internal.radarFamilies.applyFamilies, {
          now,
          newFamilies: answer.newFamilies,
          placements: answer.placements.map((p) => ({
            formatId: p.formatId as Id<"radarFormats">,
            ...("known" in p.family ? { known: p.family.known as Id<"radarHookFamilies"> } : { ref: p.family.ref }),
            lang: byId.get(p.formatId)?.lang ?? "autre",
            text: byId.get(p.formatId)?.variants[0] ?? "",
          })),
        });
        placed = answer.placements.length;
      }
    } catch (e) {
      lastError =
        e instanceof Anthropic.RateLimitError
          ? "Analyse IA : trop de demandes, nouvel essai au prochain passage"
          : e instanceof Anthropic.AuthenticationError
            ? "Analyse IA : clé ANTHROPIC_API_KEY refusée"
            : e instanceof Anthropic.APIError
              ? `Analyse IA : erreur ${e.status ?? "réseau"}`
              : "Analyse IA : réponse illisible";
    }
    await ctx.runMutation(internal.radarSignals.recordRun, {
      poste: "ai",
      credits: 0,
      calls: 1,
      errors: lastError ? 1 : 0,
      now,
      usd,
      ...(lastError ? { lastError } : {}),
    });
    return { placed, usd };
  },
});
