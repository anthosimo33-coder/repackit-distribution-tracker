"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Le visage d'une créatrice : sa photo de profil TikTok, ou ses initiales.
 *
 * ── Les initiales ne sont pas un mode dégradé ───────────────────────────────
 * Elles restent la réponse pour toute créatrice dont aucun compte TikTok n'a
 * encore été relevé — un compte sans publication n'entre pas dans le relevé de
 * nuit, donc sa photo n'arrive jamais. Ce n'est pas une panne, et l'écran ne
 * doit pas le donner à lire comme telle : pas de carré gris, pas d'icône
 * « image manquante », juste les initiales comme avant.
 *
 * ── Le repli à l'exécution ──────────────────────────────────────────────────
 * `onError` retombe sur les initiales. L'URL est signée par Convex et vaut
 * pour la durée de la page, mais entre le rendu et le chargement il reste un
 * blob qui peut avoir été purgé — auquel cas le navigateur afficherait l'icône
 * d'image brisée. Une initiale vaut mieux.
 *
 * `aria-hidden` : le nom est TOUJOURS écrit juste à côté aux trois endroits où
 * ce composant sert. Annoncer « photo de Juliette Chetrit » ferait lire le nom
 * deux fois de suite à un lecteur d'écran.
 */
export function CreatorAvatar({
  name,
  avatarUrl,
  className,
  textClassName,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  /** Taille et forme — `size-7`, `size-12`… La rondeur est déjà posée ici. */
  className?: string;
  /** Taille du texte des initiales, qui suit celle du rond. */
  textClassName?: string;
}) {
  const [casse, setCasse] = useState(false);
  const montrerPhoto = Boolean(avatarUrl) && !casse;

  return (
    <span
      aria-hidden
      // Photo ou initiales — les deux sont des états NORMAUX, et la spec doit
      // pouvoir affirmer lequel est rendu. Chercher un `<img>` ne dirait que la
      // moitié : « pas d'image » ressemble à « page pas encore chargée ».
      data-avatar={montrerPhoto ? "photo" : "initiales"}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary font-semibold text-primary-foreground",
        className,
        !montrerPhoto && textClassName,
      )}
    >
      {montrerPhoto ? (
        // Un rond de 28 à 48 px, déjà servi à la bonne taille par le CDN
        // TikTok : le faire repasser par l'optimiseur d'images coûterait une
        // requête de plus par visage pour ne rien gagner. Idiome du dépôt.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setCasse(true)}
          className="size-full object-cover"
        />
      ) : (
        initiales(name)
      )}
    </span>
  );
}

/** Initiales d'un nom — « Ladidi / Sam » → « LS », « Kelly » → « KE ». */
export function initiales(nom: string): string {
  const parts = nom.trim().split(/[\s/]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
