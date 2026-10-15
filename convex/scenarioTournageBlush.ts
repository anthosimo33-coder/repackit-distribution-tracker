/**
 * API TOURNAGE DE BLUSH — Jarvia crée lui-même les liens de tournage (15/10/2026).
 *
 *   POST {url}            { nom, fichier, moi, ref } → { id, nouvelle, statut: "en_lecture" }
 *   GET  {url}/<id>       → { statut: "en_lecture" | "pret" | "echec", lien?, erreur? }
 *   POST {url}/<id>/arreter
 *
 * En-tête `Authorization: Bearer <BLUSH_TOURNAGE_CLE>` (variable du déploiement,
 * jamais dans le code). Sans clé, rien ne part : on colle les liens à la main.
 * `BLUSH_TOURNAGE_URL` remplace l'adresse (la fausse API des e2e).
 *
 * Chaque demande coûte une VRAIE lecture (~1 €, 40 par jour au plus avec la
 * clé). La même `ref` renvoie le même lien sans relire : un double envoi ne
 * coûte rien ; une nouvelle demande (réessai, lien remplacé) prend une nouvelle
 * version, donc une nouvelle ref. Le lien n'est posé qu'au statut « pret ».
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { lireReponseCreation, lireReponseSuivi, nomBlush, refBlush, type ReponseCreation, type ReponseSuivi } from "./scenarioTournageRegles";

const URL_BLUSH = "https://www.askblush.com/api/admin/tournage";
/** Au-delà, une demande qui n'aboutit pas passe en échec (BLUSH annonce ~3 min). */
const DELAI_MAX_MS = 20 * 60_000;
const SUIVI_MS = 12_000;
const REESSAI_MS = 30_000;

/** L'API, si le déploiement a sa clé ; null = liens collés à la main. */
export function apiBlush(): { url: string; cle: string } | null {
  const cle = process.env.BLUSH_TOURNAGE_CLE?.trim();
  if (!cle) return null;
  return { url: (process.env.BLUSH_TOURNAGE_URL?.trim() || URL_BLUSH).replace(/\/+$/, ""), cle };
}

/**
 * Demande à BLUSH le lien des tournages qui n'en ont pas (et dont aucune
 * demande n'est en cours) : statut « demande », nouvelle version, envoi
 * programmé. Rend le nombre de demandes parties. Sans clé : 0.
 */
export async function demanderLiensBlush(ctx: MutationCtx, rows: readonly Doc<"scenarioTournages">[]): Promise<number> {
  if (!apiBlush()) return 0;
  let n = 0;
  for (const t of rows) {
    if (t.lien || t.blush?.statut === "demande" || t.blush?.statut === "en_lecture") continue;
    const version = (t.blush?.version ?? 0) + 1;
    const maintenant = Date.now();
    await ctx.db.patch(t._id, {
      blush: { ref: refBlush(t._id, version), version, statut: "demande", demandeLe: maintenant },
      updatedAt: maintenant,
    });
    await ctx.scheduler.runAfter(0, internal.scenarioTournageBlush.envoyer, { tournageId: t._id, version });
    n += 1;
  }
  return n;
}

/** Arrête dans BLUSH les liens créés par l'API de tournages qui disparaissent. */
export async function arreterLiensBlush(ctx: MutationCtx, rows: readonly Doc<"scenarioTournages">[]): Promise<void> {
  for (const t of rows) {
    if (t.blush?.id) await ctx.scheduler.runAfter(0, internal.scenarioTournageBlush.arreter, { id: t.blush.id });
  }
}

// ─── Lectures et écritures internes ─────────────────────────────────────────

export const lirePourEnvoi = internalQuery({
  args: { tournageId: v.id("scenarioTournages") },
  handler: async (ctx, { tournageId }) => {
    const t = await ctx.db.get(tournageId);
    if (!t) return null;
    const s = await ctx.db.get(t.scenarioId);
    return { t, code: s?.code ?? "?", titre: s?.titre ?? "" };
  },
});

type Demande = NonNullable<Doc<"scenarioTournages">["blush"]>;
/** La demande sans son message d'échec. */
function sansErreur(d: Demande): Demande {
  const reste = { ...d };
  delete reste.erreur;
  return reste;
}

/** La demande en cours de CETTE version, sinon null (remplacée, finie, ou lien collé à la main). */
async function demandeCourante(ctx: MutationCtx, tournageId: Id<"scenarioTournages">, version: number) {
  const t = await ctx.db.get(tournageId);
  return t?.blush && t.blush.version === version && !t.lien ? { t, blush: t.blush } : null;
}

export const noterEnLecture = internalMutation({
  args: { tournageId: v.id("scenarioTournages"), version: v.number(), id: v.string() },
  handler: async (ctx, a) => {
    const d = await demandeCourante(ctx, a.tournageId, a.version);
    if (!d || d.blush.statut !== "demande") return false;
    await ctx.db.patch(d.t._id, { blush: { ...sansErreur(d.blush), id: a.id, statut: "en_lecture" }, updatedAt: Date.now() });
    return true;
  },
});

export const noterPret = internalMutation({
  args: { tournageId: v.id("scenarioTournages"), version: v.number(), lien: v.string() },
  handler: async (ctx, a) => {
    const d = await demandeCourante(ctx, a.tournageId, a.version);
    if (!d) return;
    // Le lien n'est montré qu'à « pret » ; un lien collé entre-temps à la main l'emporte (demandeCourante).
    await ctx.db.patch(d.t._id, { lien: a.lien, blush: { ...sansErreur(d.blush), statut: "pret" }, updatedAt: Date.now() });
  },
});

export const noterEchec = internalMutation({
  args: { tournageId: v.id("scenarioTournages"), version: v.number(), erreur: v.string() },
  handler: async (ctx, a) => {
    const d = await demandeCourante(ctx, a.tournageId, a.version);
    if (!d) return;
    await ctx.db.patch(d.t._id, { blush: { ...d.blush, statut: "echec", erreur: a.erreur }, updatedAt: Date.now() });
  },
});

// ─── Appels à BLUSH ─────────────────────────────────────────────────────────

async function appeler(
  api: { url: string; cle: string },
  chemin: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; corps: unknown }> {
  const r = await fetch(`${api.url}${chemin}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${api.cle}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: r.status, corps: await r.json().catch(() => ({})) };
}

/** Envoie le fichier figé : BLUSH lance la lecture et rend l'id du lien. */
export const envoyer = internalAction({
  args: { tournageId: v.id("scenarioTournages"), version: v.number() },
  handler: async (ctx, a) => {
    const lu = await ctx.runQuery(internal.scenarioTournageBlush.lirePourEnvoi, { tournageId: a.tournageId });
    const blush = lu?.t.blush;
    if (!lu || !blush || blush.version !== a.version || blush.statut !== "demande" || lu.t.lien) return;
    const api = apiBlush();
    if (!api) {
      await ctx.runMutation(internal.scenarioTournageBlush.noterEchec, { ...a, erreur: "API BLUSH non configurée (BLUSH_TOURNAGE_CLE)." });
      return;
    }
    const fichier = await ctx.storage.get(lu.t.fichierId);
    if (!fichier) {
      await ctx.runMutation(internal.scenarioTournageBlush.noterEchec, { ...a, erreur: "Fichier de tournage introuvable." });
      return;
    }
    let r: ReponseCreation;
    try {
      const { status, corps } = await appeler(api, "", {
        method: "POST",
        body: { nom: nomBlush(lu.t.prenom, lu.code, lu.titre), fichier: await fichier.text(), moi: lu.t.prenom, ref: blush.ref },
      });
      r = lireReponseCreation(status, corps, lu.t.prenom);
    } catch {
      r = { ok: false, transitoire: true, erreur: "BLUSH injoignable." };
    }
    if (r.ok) {
      if (await ctx.runMutation(internal.scenarioTournageBlush.noterEnLecture, { ...a, id: r.id })) {
        await ctx.scheduler.runAfter(SUIVI_MS, internal.scenarioTournageBlush.suivre, a);
      }
      return;
    }
    // Même ref = même lien : renvoyer après une coupure ne coûte pas une 2e lecture.
    if (r.transitoire && Date.now() - blush.demandeLe < DELAI_MAX_MS) {
      await ctx.scheduler.runAfter(REESSAI_MS, internal.scenarioTournageBlush.envoyer, a);
      return;
    }
    await ctx.runMutation(internal.scenarioTournageBlush.noterEchec, { ...a, erreur: r.erreur });
  },
});

/** Suit la lecture jusqu'à « pret » (le lien est alors posé) ou « echec ». */
export const suivre = internalAction({
  args: { tournageId: v.id("scenarioTournages"), version: v.number() },
  handler: async (ctx, a) => {
    const lu = await ctx.runQuery(internal.scenarioTournageBlush.lirePourEnvoi, { tournageId: a.tournageId });
    const blush = lu?.t.blush;
    if (!lu || !blush?.id || blush.version !== a.version || blush.statut !== "en_lecture" || lu.t.lien) return;
    const api = apiBlush();
    let r: ReponseSuivi;
    if (!api) r = { statut: "echec", erreur: "API BLUSH non configurée (BLUSH_TOURNAGE_CLE)." };
    else {
      try {
        const { status, corps } = await appeler(api, `/${encodeURIComponent(blush.id)}`, { method: "GET" });
        r = lireReponseSuivi(status, corps, lu.t.prenom);
      } catch {
        r = { statut: "transitoire", erreur: "BLUSH injoignable." };
      }
    }
    if (r.statut === "pret") {
      await ctx.runMutation(internal.scenarioTournageBlush.noterPret, { ...a, lien: r.lien });
    } else if (r.statut === "echec") {
      await ctx.runMutation(internal.scenarioTournageBlush.noterEchec, { ...a, erreur: r.erreur });
    } else if (Date.now() - blush.demandeLe < DELAI_MAX_MS) {
      await ctx.scheduler.runAfter(SUIVI_MS, internal.scenarioTournageBlush.suivre, a);
    } else {
      await ctx.runMutation(internal.scenarioTournageBlush.noterEchec, {
        ...a,
        erreur: r.statut === "transitoire" ? r.erreur : "BLUSH n'a pas fini la lecture en 20 minutes : réessaie.",
      });
    }
  },
});

/** Arrête un lien dans BLUSH (créatrice ou histoire supprimée). Au mieux : un échec ne bloque rien. */
export const arreter = internalAction({
  args: { id: v.string() },
  handler: async (_ctx, { id }) => {
    const api = apiBlush();
    if (!api) return;
    try {
      await appeler(api, `/${encodeURIComponent(id)}/arreter`, { method: "POST" });
    } catch {
      /* lien déjà arrêté ou BLUSH injoignable : à arrêter à la main dans BLUSH › Tournage */
    }
  },
});
