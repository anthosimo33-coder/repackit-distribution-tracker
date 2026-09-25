import { v } from "convex/values";

/**
 * PLATEFORMES DE PUBLICATION — la liste, en UNE définition.
 *
 * Module PUR (aucun import `_generated`) → importable côté serveur, côté client
 * ET depuis `lib/`. Même patron que `convex/postUrlShape.ts`.
 *
 * ── Pourquoi ce module ──────────────────────────────────────────────────────
 * Jusqu'au 2026-09-25, `"TikTok" | "Instagram" | "YouTube"` était recopié à
 * neuf endroits du schéma et dans une vingtaine de types locaux (TD-008).
 * Ajouter Facebook et Snapchat par recopie aurait laissé derrière soi des
 * copies à trois qui compilent encore — un compte Snapchat qui s'enregistre
 * mais qu'un écran ne sait pas filtrer, sans qu'aucune erreur ne le signale.
 *
 * ── Ce qui N'EN DÉPEND PAS, volontairement ──────────────────────────────────
 * La veille (inspirations), les vidéos exemples et les sources de Shorts ont
 * leur propre liste : elles décrivent des contenus qu'on REGARDE, pas des
 * comptes sur lesquels on publie. Les étendre est un chantier à part.
 */

/** Ordre d'affichage : filtres, sélecteurs, colonnes. */
export const PLATEFORMES = [
  "TikTok",
  "Instagram",
  "YouTube",
  "Facebook",
  "Snapchat",
] as const;

export type Plateforme = (typeof PLATEFORMES)[number];

export const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
  v.literal("Facebook"),
  v.literal("Snapchat"),
);

/**
 * Clé minuscule d'une plateforme — celle des objets indexés par plateforme
 * (`projects.warmupTargetDays`, `creators.handlesToCreate`).
 */
export type PlateformeKey =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "facebook"
  | "snapchat";

export const PLATEFORME_KEY: Record<Plateforme, PlateformeKey> = {
  TikTok: "tiktok",
  Instagram: "instagram",
  YouTube: "youtube",
  Facebook: "facebook",
  Snapchat: "snapchat",
};

export function isPlateforme(value: unknown): value is Plateforme {
  return (
    typeof value === "string" &&
    (PLATEFORMES as readonly string[]).includes(value)
  );
}
