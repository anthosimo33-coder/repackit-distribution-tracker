import { adminQuery } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { buildPublicationAssignmentMap, postLabel } from "./trackerData";
import {
  detectOpenDoor,
  detectDeadHooks,
  detectAccountAlarms,
  computeDelta24h,
  computeFollowersDelta,
  type PostSignal,
  type AccountAlarm,
} from "./decisions";
import {
  RECENT_WINDOW_MS,
  OPEN_DOOR_MAX_AGE_MS,
  PENDING_POST_MAX_AGE_MS,
  ACCOUNT_ALARM_RUN_LENGTH,
} from "./decisionThresholds";
import {
  LAB_CAMPAIGN_NAME,
  PROVEN_CAMPAIGN_NAME,
  campaignNameMatches,
  bestRun,
  qualifiesForGraduation,
} from "./graduation";

/**
 * QUERY D'ASSEMBLAGE du dashboard décisionnel — la seule lecture serveur des
 * deux sections « À décider » et « Posts des dernières 48 h ».
 *
 * Toute la LOGIQUE vit dans les modules purs déjà testés (convex/decisions.ts,
 * convex/graduation.ts) : cette query ne fait que joindre les tables et leur
 * tendre les signaux. Un seuil qui apparaîtrait ici serait au mauvais endroit.
 *
 * ── Fenêtres ─────────────────────────────────────────────────────────────────
 * La fenêtre « 48 h » est GLISSANTE depuis l'instant de lecture — pas un jour
 * calendaire, donc pas de piège de fuseau ici (le fuseau ne mord que quand on
 * bucketise par jour, cf convex/viewsDaily.ts). Les dates AFFICHÉES restent
 * formatées en Europe/Paris côté client.
 *
 * ── Choix de population, tous documentés ─────────────────────────────────────
 *  - HOOKS MORTS : seuls les runs SORTIS DE FENÊTRE (> 48 h) comptent — un post
 *    de 6 h à 300 vues n'est pas un run raté, c'est un run en cours. Et seuls
 *    les hooks encore ACTIFS sont proposés (désactiver un hook déjà désactivé
 *    n'est pas une décision).
 *  - ALARME : les posts de moins de 12 h (« en attente ») sont exclus de la
 *    série — compter un post pas encore parti ferait sonner l'alarme sur du
 *    vide. La série se lit du plus récent, bornée aux ~8 derniers posts.
 *  - GRADUATION : hooks ACTIFS du LAB dont le MEILLEUR run qualifie. La règle
 *    exige les saves : tant que la collecte ne peuple pas, la liste est vide —
 *    dormance voulue, cf convex/decisions.ts.
 */
export const decisionDashboard = adminQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const [pubs, refs, bricks, campaigns, comptes] = await Promise.all([
      ctx.db
        .query("publications")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      buildPublicationAssignmentMap(ctx),
      ctx.db
        .query("scriptBricks")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("scriptCampaigns")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);

    const brickById = new Map(bricks.map((b) => [b._id as string, b]));
    const campaignById = new Map(campaigns.map((c) => [c._id as string, c]));
    const compteByHandle = new Map(comptes.map((c) => [c.handle, c]));
    const lab = campaigns.find((c) =>
      campaignNameMatches(c.name, LAB_CAMPAIGN_NAME),
    );
    const proven = campaigns.find((c) =>
      campaignNameMatches(c.name, PROVEN_CAMPAIGN_NAME),
    );

    const published = pubs.filter(
      (p) => typeof p.postUrl === "string" && p.postUrl.length > 0,
    );

    // ── Deltas d'abonnés PAR COMPTE (un chargement par compte concerné) ──────
    // Seuls les comptes ayant publié dans la fenêtre en ont besoin : le tableau
    // 48 h est la seule surface qui les affiche.
    const recentHandles = [
      ...new Set(
        published
          .filter((p) => now - p.datePubli <= RECENT_WINDOW_MS)
          .map((p) => p.compte),
      ),
    ];
    const followersByHandle = new Map<string, number | null>();
    for (const handle of recentHandles) {
      const compte = compteByHandle.get(handle);
      if (!compte) {
        followersByHandle.set(handle, null);
        continue;
      }
      // 4 jours d'historique : assez pour deux nuits de relevés plus la marge
      // d'un raté, sans charger toute la vie du compte.
      const snaps = await ctx.db
        .query("accountProfileSnapshots")
        .withIndex("by_compte_capturedAt", (q) =>
          q
            .eq("compteId", compte._id)
            .gte("capturedAt", now - 4 * 86_400_000),
        )
        .collect();
      followersByHandle.set(handle, computeFollowersDelta(snaps));
    }

    /**
     * Type ÉDITORIAL d'un post (badge du tableau 48 h) : campagne prouvée →
     * « prouvé », LAB → « lab », sinon warmup/promo selon le flag. Dérivé des
     * MÊMES campagnes que la graduation — un renommage qui casserait l'une
     * casserait l'autre au même endroit.
     */
    const typeOf = (p: Doc<"publications">): "prouve" | "lab" | "warmup" | "promo" => {
      const cid = p.scriptCombo?.campaignId as string | undefined;
      if (cid !== undefined && proven !== undefined && cid === (proven._id as string)) return "prouve";
      if (cid !== undefined && lab !== undefined && cid === (lab._id as string)) return "lab";
      return p.isWarmup === true ? "warmup" : "promo";
    };

    // ── PostSignal d'une publication (+ libellé et type pour l'affichage) ────
    const signalOf = async (
      p: Doc<"publications">,
    ): Promise<PostSignal & { label: string; type: string; snapshotAt: number | null }> => {
      const ref = refs.get(p._id as string);
      const hookBrickId = (p.scriptCombo?.hookBrickId as string) ?? null;
      const hook = hookBrickId ? brickById.get(hookBrickId) : undefined;
      const vuesLatest = p.vuesLatest ?? 0;
      // Historique de CETTE publication (≤ 48 h de vie → une poignée de rows).
      const snaps = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication_and_capturedAt", (q) =>
          q.eq("publicationId", p._id),
        )
        .collect();
      return {
        publicationId: p._id as string,
        compte: p.compte,
        plateforme: p.plateforme,
        creatorId: (ref?.creatorId as string) ?? null,
        creatorName: ref?.creatorName ?? null,
        postedAt: p.datePubli,
        vues: vuesLatest,
        likes: p.likesLatest ?? 0,
        saves: p.savesLatest ?? null,
        delta24h: computeDelta24h(p.datePubli, vuesLatest, snaps, now),
        followersDelta: followersByHandle.get(p.compte) ?? null,
        angleFamily: hook?.angleFamily ?? null,
        hookBrickId,
        label: postLabel(p),
        type: typeOf(p),
        // Instant du relevé qui porte vues/likes/saves affichés — l'écran le
        // DATE quand il n'est pas d'aujourd'hui : « 3 218 · au 16/08 » vaut
        // mieux qu'un tiret, tant que la date est visible.
        snapshotAt: p.latestSnapshotAt ?? null,
      };
    };

    // ── Section « Posts des dernières 48 h » + portes ouvertes ───────────────
    const posts48h: (PostSignal & { label: string; type: string; snapshotAt: number | null })[] = [];
    for (const p of published) {
      if (now - p.datePubli > RECENT_WINDOW_MS) continue;
      posts48h.push(await signalOf(p));
    }
    posts48h.sort((a, b) => b.postedAt - a.postedAt);
    const openDoors = posts48h
      .map((p) => detectOpenDoor(p, now))
      .filter((d): d is NonNullable<typeof d> => d !== null);

    // ── ALARME — série des derniers posts par compte, hors « en attente » ────
    const byCompteDesc = new Map<string, PostSignal[]>();
    const settled = published
      .filter((p) => now - p.datePubli >= PENDING_POST_MAX_AGE_MS)
      .sort((a, b) => b.datePubli - a.datePubli);
    for (const p of settled) {
      const arr = byCompteDesc.get(p.compte) ?? [];
      if (arr.length >= ACCOUNT_ALARM_RUN_LENGTH + 3) continue;
      // Les signaux d'alarme n'ont besoin ni du delta ni des abonnés : version
      // allégée SANS lecture de snapshots (les 5 derniers posts suffisent).
      arr.push({
        publicationId: p._id as string,
        compte: p.compte,
        plateforme: p.plateforme,
        creatorId: (refs.get(p._id as string)?.creatorId as string) ?? null,
        creatorName: refs.get(p._id as string)?.creatorName ?? null,
        postedAt: p.datePubli,
        vues: p.vuesLatest ?? 0,
        likes: p.likesLatest ?? 0,
        saves: p.savesLatest ?? null,
        delta24h: null,
        followersDelta: null,
        angleFamily: null,
        hookBrickId: (p.scriptCombo?.hookBrickId as string) ?? null,
      });
      byCompteDesc.set(p.compte, arr);
    }
    const alarms: AccountAlarm[] = detectAccountAlarms(byCompteDesc);

    // ── HOOKS MORTS — runs sortis de fenêtre, hooks encore actifs ────────────
    const settledOld = settled.filter(
      (p) => now - p.datePubli > OPEN_DOOR_MAX_AGE_MS && p.scriptCombo,
    );
    const deadCandidates = detectDeadHooks(
      settledOld.map((p) => ({
        publicationId: p._id as string,
        compte: p.compte,
        plateforme: p.plateforme,
        creatorId: null,
        creatorName: null,
        postedAt: p.datePubli,
        vues: p.vuesLatest ?? 0,
        likes: p.likesLatest ?? 0,
        saves: null,
        delta24h: null,
        followersDelta: null,
        angleFamily: null,
        hookBrickId: p.scriptCombo?.hookBrickId as string,
      })),
    );
    const deadHooks = deadCandidates.flatMap((d) => {
      const brick = brickById.get(d.hookBrickId);
      if (!brick || !brick.active) return [];
      return [
        {
          ...d,
          brickId: brick._id,
          content: brick.content,
          campaignName:
            campaignById.get(brick.campaignId as string)?.name ?? "?",
        },
      ];
    });

    // ── GRADUATIONS — hooks actifs du LAB dont le meilleur run qualifie ──────
    const runsByHook = new Map<
      string,
      { vues: number; likes: number; saves: number | null }[]
    >();
    for (const p of published) {
      const h = p.scriptCombo?.hookBrickId as string | undefined;
      if (!h) continue;
      const arr = runsByHook.get(h) ?? [];
      arr.push({
        vues: p.vuesLatest ?? 0,
        likes: p.likesLatest ?? 0,
        saves: p.savesLatest ?? null,
      });
      runsByHook.set(h, arr);
    }
    const graduations =
      lab === undefined
        ? []
        : bricks.flatMap((b) => {
            if (b.campaignId !== lab._id || b.kind !== "hook" || !b.active) {
              return [];
            }
            const runs = runsByHook.get(b._id as string) ?? [];
            const best = bestRun(runs);
            if (best === null || !qualifiesForGraduation(best)) return [];
            return [
              {
                brickId: b._id as Id<"scriptBricks">,
                content: b.content,
                angleFamily: b.angleFamily ?? null,
                best,
                runs: runs.length,
              },
            ];
          });

    return {
      posts48h,
      openDoors,
      alarms,
      deadHooks,
      graduations,
      // La modale « Programmer la frappe » assigne la campagne des ouvertures
      // prouvées ; absente sur ce projet → le bouton l'explique au lieu d'ouvrir.
      provenCampaign: proven
        ? { id: proven._id as Id<"scriptCampaigns">, name: proven.name }
        : null,
    };
  },
});
