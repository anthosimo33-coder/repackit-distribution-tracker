import { adminViewAsQuery, creatorQuery } from "./functions";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { SnapshotPoint } from "./viewsDaily";
import { computeViewsPulse } from "./viewsPulseCore";

/**
 * LE POULS DES VUES D'UNE CRÉATRICE — les vues gagnées HIER, par vidéo.
 *
 * Lecture BORNÉE : seulement ses vidéos en ligne (published/paid), seulement les
 * relevés des trois derniers jours (index `by_publication_and_capturedAt`). Il
 * faut le relevé d'avant-hier pour attribuer le delta d'hier au prorata ; trois
 * jours couvrent aussi un soir de relevé manqué.
 *
 * Ce sont des VUES, pas de l'argent : l'observation passe par
 * `adminViewAsQuery`, pas par la variante « argent ».
 */
const DAY_MS = 86_400_000;

async function pulseFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  now: number,
) {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  const assignmentOf = new Map<string, string>();
  for (const a of assignments) {
    if (a.projectId !== projectId) continue;
    if (a.status !== "published" && a.status !== "paid") continue;
    for (const pid of [...(a.targets ?? []).map((t) => t.publicationId), a.publicationId]) {
      if (pid !== undefined) assignmentOf.set(pid, a._id);
    }
  }
  if (assignmentOf.size === 0) return null;

  const since = now - 3 * DAY_MS;
  const snaps: SnapshotPoint[] = [];
  for (const pid of assignmentOf.keys()) {
    const rows = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_publication_and_capturedAt", (q) =>
        q.eq("publicationId", pid as Id<"publications">).gte("capturedAt", since),
      )
      .collect();
    for (const r of rows) {
      snaps.push({ publicationId: pid, capturedAt: r.capturedAt, vues: r.vues });
    }
  }
  return computeViewsPulse(snaps, (pid) => assignmentOf.get(pid) ?? "", now);
}

/** Les vues d'hier de la créatrice connectée. `null` = rien gagné hier (ou rien en ligne). */
export const getMyViewsPulse = creatorQuery({
  args: {},
  handler: async (ctx) => pulseFor(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});

/** ADMIN view-as — même lecture pour la créatrice observée. */
export const getViewsPulseAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => pulseFor(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});
