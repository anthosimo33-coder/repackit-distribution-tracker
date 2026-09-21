import type { MetadataRoute } from "next";
import { ROBOTS_ALLOW, ROBOTS_DISALLOW } from "@/lib/robots-policy";

/**
 * Le dépôt n'avait AUCUN robots.txt : `/robots.txt` rendait 404 (mesuré en
 * production le 21/09/2026). Les 67 routes dynamiques de l'app étaient donc
 * ouvertes à l'exploration, et chaque chemin visité par un robot fait tourner
 * le proxy puis un 307 vers `/login` — du CPU Vercel dépensé pour rediriger
 * une machine vers un écran de connexion qu'elle ne remplira jamais.
 *
 * CE QUI EST INDEXABLE : la vitrine, et elle seule. `Allow: /$` ne vaut que
 * pour la racine exacte ; tout le reste tombe sous `Disallow: /`. C'est déjà ce
 * que dit la page elle-même, dont le `alternates.canonical` ramène les quatre
 * langues sur `/`.
 *
 * DEUX EXCEPTIONS, et leurs raisons :
 *   - `/_next/` et `/landing/` : Google rend la page avant de la juger. Lui
 *     interdire les scripts, les styles et les visuels, c'est lui montrer une
 *     page cassée.
 *   - `/s/` : les dashboards publics à jeton, lus par une marque sans compte et
 *     surtout par les robots d'aperçu de lien. Slackbot RESPECTE robots.txt —
 *     fermer `/s/` casserait l'aperçu des liens déjà partagés. Le jeton reste
 *     la seule clé, et une URL à jeton n'est pas découvrable : rien n'est
 *     exposé de plus qu'aujourd'hui.
 *
 * Les deux listes vivent dans `lib/robots-policy.ts`, avec leur test : le
 * vitest du dépôt ne scanne ni `app/` ni les routes de métadonnées.
 *
 * Route de métadonnées STATIQUE : aucune API de requête ici, donc Next la
 * prérend et elle ne coûte aucune invocation. Le proxy ne la voit pas non plus
 * (son matcher exclut les chemins avec extension).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [...ROBOTS_ALLOW],
        disallow: ROBOTS_DISALLOW,
      },
    ],
  };
}
