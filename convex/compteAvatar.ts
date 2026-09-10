import { internalAction, internalMutation } from "./_generated/server";
import { e2eMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { pickFaceCompte } from "./creatorAvatar";

/**
 * PHOTO DE PROFIL d'un compte — miroir du blob TikTok dans le storage.
 *
 * ── D'où vient l'image ──────────────────────────────────────────────────────
 * De nulle part de nouveau : `authorMeta.avatar` arrive AVEC chaque item vidéo
 * du relevé de nuit (cf. convex/apifyItem.ts). Aucun run Apify supplémentaire,
 * aucun coût de plus — la même remarque que pour les abonnés TikTok.
 *
 * ── Pourquoi on la RECOPIE ──────────────────────────────────────────────────
 * Les liens du CDN TikTok sont signés et datés. Affichés tels quels, les
 * visages de l'écran Créateurs deviendraient des carrés gris au bout de
 * quelques jours, sans que rien ne signale la panne. On télécharge donc l'image
 * une fois, on la garde, et on ne recommence QUE si l'URL a changé — c'est le
 * seul signal disponible que la créatrice a changé de photo.
 *
 * ── Ce que ça ne fait pas ───────────────────────────────────────────────────
 * Aucun redimensionnement, aucun ré-encodage : l'avatar TikTok fait déjà
 * 720×720 pour quelques dizaines de Ko, et le pipeline `sharp` vit hors Convex
 * (cf. lib/image-postprocess.ts) — le faire traverser une route Next pour
 * gagner 10 Ko coûterait plus que ça ne rapporte.
 */

/** Types d'image acceptés — ce que le CDN TikTok sert réellement. */
const TYPES_ACCEPTES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/**
 * 4 Mo. Un avatar en fait 30 à 200 Ko ; au-delà, ce n'est plus une photo de
 * profil et on préfère l'initiale à un téléchargement qu'on n'a pas demandé.
 */
const TAILLE_MAX = 4 * 1024 * 1024;

/** Au-delà, on abandonne : le relevé de nuit ne doit pas attendre une image. */
const TIMEOUT_MS = 15_000;

/**
 * L'avatar stocké est-il déjà celui de cette URL ? Le CDN change le lien à
 * chaque nouvelle photo — même chaîne ⇒ même image ⇒ rien à télécharger.
 */
function dejaAJour(compte: Doc<"comptes">, sourceUrl: string): boolean {
  return compte.avatar?.sourceUrl === sourceUrl;
}

/** URL signée de la photo d'un compte, ou null. Résolue SERVEUR, toujours. */
export async function avatarUrlOf(
  ctx: QueryCtx,
  compte: Doc<"comptes">,
): Promise<string | null> {
  return compte.avatar ? await ctx.storage.getUrl(compte.avatar.storageId) : null;
}

/**
 * créatrice → URL de SA photo, pour un lot de comptes DÉJÀ chargé.
 *
 * Prend les comptes en argument plutôt que de les relire : les deux appelants
 * (la liste Créateurs et l'en-tête d'une fiche) les ont sous la main. Rajouter
 * un balayage ici ferait payer un second passage à un écran qui vient d'en
 * faire un.
 *
 * Une seule résolution d'URL par créatrice, jamais par compte : `getUrl` est
 * un appel, et dix-neuf visages ne doivent pas en coûter quarante.
 */
export async function faceUrlsByCreator(
  ctx: QueryCtx,
  comptes: readonly Doc<"comptes">[],
): Promise<Map<Id<"creators">, string>> {
  const parCreatrice = new Map<Id<"creators">, Doc<"comptes">[]>();
  for (const c of comptes) {
    if (!c.creatorId) continue;
    const liste = parCreatrice.get(c.creatorId) ?? [];
    liste.push(c);
    parCreatrice.set(c.creatorId, liste);
  }
  const urls = new Map<Id<"creators">, string>();
  for (const [creatorId, liste] of parCreatrice) {
    const choisi = pickFaceCompte(
      liste.map((c) => ({
        plateforme: c.plateforme,
        hasAvatar: c.avatar !== undefined,
        status: c.status,
        managedByAdmin: c.managedByAdmin,
        createdAt: c._creationTime,
        compte: c,
      })),
    );
    if (!choisi) continue;
    const url = await avatarUrlOf(ctx, choisi.compte);
    // Blob envolé (purge manuelle, migration) : pas d'entrée plutôt qu'une URL
    // vide — l'écran retombe sur l'initiale au lieu d'une image cassée.
    if (url) urls.set(creatorId, url);
  }
  return urls;
}

/**
 * Purge la photo d'un compte qu'on s'apprête à supprimer. À appeler AVANT
 * `ctx.db.delete(compte._id)` — après, le pointeur a disparu et le blob n'est
 * plus atteignable par personne tout en restant facturé.
 *
 * Sans effet sur un compte sans photo : c'est le cas le plus courant, et il ne
 * doit rien coûter à l'appelant de le traiter comme les autres.
 */
export async function purgeCompteAvatar(
  ctx: MutationCtx,
  compte: Doc<"comptes">,
): Promise<void> {
  if (compte.avatar) await ctx.storage.delete(compte.avatar.storageId);
}

/**
 * Attache le blob téléchargé au compte et purge l'ancien.
 *
 * La purge est ici, et pas dans l'action : elle doit se produire dans la MÊME
 * transaction que le remplacement du pointeur, sinon un échec entre les deux
 * laisse soit un blob orphelin, soit un compte qui pointe vers un blob effacé.
 */
export const attachAvatar = internalMutation({
  args: {
    compteId: v.id("comptes"),
    storageId: v.id("_storage"),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => attachAvatarCore(ctx, args),
});

/**
 * Le CŒUR de l'attache, appelé par la mutation interne du relevé ET par la
 * mutation e2e (`e2eAttachAvatar`). Un seul corps : la spec exerce le vrai
 * code, pas une imitation qui pourrait diverger.
 */
async function attachAvatarCore(
  ctx: MutationCtx,
  args: {
    compteId: Id<"comptes">;
    storageId: Id<"_storage">;
    sourceUrl: string;
  },
): Promise<{ action: "written" | "skipped" }> {
  const compte = await ctx.db.get(args.compteId);
  if (!compte) {
    // Compte supprimé pendant le téléchargement : le blob n'appartient à
    // personne, il ne doit pas rester.
    await ctx.storage.delete(args.storageId);
    return { action: "skipped" };
  }
  const ancien = compte.avatar?.storageId;
  await ctx.db.patch(args.compteId, {
    avatar: {
      storageId: args.storageId,
      sourceUrl: args.sourceUrl,
      fetchedAt: Date.now(),
    },
  });
  if (ancien && ancien !== args.storageId) await ctx.storage.delete(ancien);
  return { action: "written" };
}

/**
 * Test e2e — attache une photo SANS passer par le CDN TikTok (aucun réseau
 * externe sur le déploiement de test). Le blob est poussé par la spec via
 * `storage.generateUploadUrl` ; tout ce qui suit (choix du compte, service de
 * l'URL, purge à la suppression) est le code de production.
 */
export const e2eAttachAvatar = e2eMutation({
  args: {
    compteId: v.id("comptes"),
    storageId: v.id("_storage"),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => attachAvatarCore(ctx, args),
});

/** Comptes à rafraîchir : ceux dont l'URL diffère de celle déjà stockée. */
export const comptesARafraichir = internalMutation({
  args: {
    candidats: v.array(
      v.object({ compteId: v.id("comptes"), sourceUrl: v.string() }),
    ),
  },
  handler: async (ctx, { candidats }) => {
    const aFaire: { compteId: Id<"comptes">; sourceUrl: string }[] = [];
    for (const c of candidats) {
      const compte = await ctx.db.get(c.compteId);
      if (!compte || dejaAJour(compte, c.sourceUrl)) continue;
      aFaire.push(c);
    }
    return aFaire;
  },
});

/**
 * Télécharge les photos qui ont changé et les attache. NE JETTE JAMAIS : un CDN
 * qui refuse, un type inattendu, un timeout — le relevé de vues n'a aucune
 * raison de tomber pour une image. Chaque échec laisse simplement l'avatar
 * précédent (ou les initiales) en place, et se relira au relevé suivant.
 */
export const rafraichirAvatars = internalAction({
  args: {
    candidats: v.array(
      v.object({ compteId: v.id("comptes"), sourceUrl: v.string() }),
    ),
  },
  handler: async (ctx, { candidats }): Promise<{ recopies: number }> => {
    if (candidats.length === 0) return { recopies: 0 };
    const aFaire = await ctx.runMutation(
      internal.compteAvatar.comptesARafraichir,
      { candidats },
    );
    let recopies = 0;
    for (const c of aFaire) {
      try {
        const res = await fetch(c.sourceUrl, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          console.warn(
            `[avatar] ${c.compteId} — CDN HTTP ${res.status}, photo inchangée.`,
          );
          continue;
        }
        const type = (res.headers.get("content-type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!TYPES_ACCEPTES.includes(type)) {
          console.warn(`[avatar] ${c.compteId} — type « ${type} » refusé.`);
          continue;
        }
        const blob = await res.blob();
        if (blob.size === 0 || blob.size > TAILLE_MAX) {
          console.warn(`[avatar] ${c.compteId} — taille ${blob.size} refusée.`);
          continue;
        }
        const storageId = await ctx.storage.store(blob);
        const r = await ctx.runMutation(internal.compteAvatar.attachAvatar, {
          compteId: c.compteId,
          storageId,
          sourceUrl: c.sourceUrl,
        });
        if (r.action === "written") recopies++;
      } catch (e) {
        console.warn(`[avatar] ${c.compteId} — échec :`, e);
      }
    }
    if (recopies > 0) console.info(`[avatar] ${recopies} photo(s) recopiée(s).`);
    return { recopies };
  },
});
