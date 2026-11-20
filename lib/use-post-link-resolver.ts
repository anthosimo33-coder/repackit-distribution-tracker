"use client";

import { useCallback, useMemo } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Plateforme } from "@/convex/platforms";
import { isTikTokShortlink } from "@/convex/postUrlDate";

/** Un lien de publication, avec sa plateforme (ce que prennent les mutations). */
export type PublishUrl = { platform: Plateforme; url: string };

/** Résolveurs rendus par le hook : liens d'une publication, ou un lien seul. */
export type PostLinkResolver = {
  /** Les liens d'une publication, dans le même ordre, liens courts résolus. */
  urls: (items: PublishUrl[]) => Promise<PublishUrl[]>;
  /** Un lien seul (correction, cible ajoutée), lien court résolu. */
  url: (url: string) => Promise<string>;
};

/**
 * Résout les liens courts TikTok d'une saisie JUSTE AVANT de l'envoyer.
 *
 * Un lien court (`vm.`, `vt.`, `tiktok.com/t/`) ne contient pas l'id de la
 * vidéo, et chaque « Partager » en fabrique un nouveau : sans résolution, la
 * garde « lien déjà rattaché à une autre mission » (convex/postDuplicateGuard)
 * ne voit pas qu'il mène à une vidéo déjà rattachée — 14 doublons sur 19 le
 * 19/11/2026. Envoyer l'URL canonique la lui montre.
 *
 * Ne bloque JAMAIS la saisie : aucun lien court → aucun appel ; échec de
 * résolution → liens d'origine (la résolution différée côté serveur reprend le
 * relais et marque le doublon s'il y en a un).
 */
export function usePostLinkResolver(): PostLinkResolver {
  const resolve = useAction(api.postUrlResolution.resolvePostLinks);
  const resolveAll = useCallback(
    async (urls: string[]): Promise<string[]> => {
      if (!urls.some((u) => isTikTokShortlink(u.trim()))) return urls;
      try {
        const out = await resolve({ urls });
        return urls.map((u, i) => out[i] ?? u);
      } catch {
        return urls;
      }
    },
    [resolve],
  );
  return useMemo(
    () => ({
      urls: async (items: PublishUrl[]) => {
        const out = await resolveAll(items.map((it) => it.url));
        return items.map((it, i) => ({ platform: it.platform, url: out[i] }));
      },
      url: async (url: string) => (await resolveAll([url]))[0],
    }),
    [resolveAll],
  );
}
