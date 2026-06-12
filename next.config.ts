import type { NextConfig } from "next";

/**
 * P3 Multi-tenant — l'app interne vit désormais sous `/admin/[projectSlug]/…`.
 *
 * Redirects legacy → `/admin/repackit/…` (repackit = projet historique, slug
 * par défaut). Les query params (carouselId, view, hookId…) sont préservés
 * automatiquement par Next.js. `permanent: false` (307) : la cible « repackit »
 * est une commodité pour les vieux liens, pas une vérité permanente (un membre
 * d'un autre projet n'a pas à se voir cacher repackit indéfiniment).
 *
 * `/` n'est plus un redirect mais une vraie page (`app/page.tsx`) qui résout le
 * projet par défaut de l'utilisateur connecté (dynamique). `/p/[carouselId]`
 * reste une page resolver (cross-projet). Ordre : la règle /tracker avec `has`
 * doit matcher AVANT la règle /tracker générique.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      // ── Routes internes legacy → /admin/repackit/… ──────────────────────
      {
        source: "/dashboard",
        destination: "/admin/repackit/dashboard",
        permanent: false,
      },
      {
        source: "/comptes",
        destination: "/admin/repackit/comptes",
        permanent: false,
      },
      {
        source: "/comptes/:path*",
        destination: "/admin/repackit/comptes/:path*",
        permanent: false,
      },
      {
        source: "/carrousels",
        destination: "/admin/repackit/carrousels",
        permanent: false,
      },
      {
        source: "/shorts/sources",
        destination: "/admin/repackit/shorts/sources",
        permanent: false,
      },
      {
        source: "/shorts",
        destination: "/admin/repackit/shorts",
        permanent: false,
      },
      {
        source: "/screenrecorder",
        destination: "/admin/repackit/screenrecorder",
        permanent: false,
      },
      {
        source: "/biblio-hooks",
        destination: "/admin/repackit/biblio-hooks",
        permanent: false,
      },
      {
        source: "/inspirations",
        destination: "/admin/repackit/inspirations",
        permanent: false,
      },
      // ── Alias legacy historiques ────────────────────────────────────────
      {
        source: "/hooks",
        destination: "/admin/repackit/biblio-hooks",
        permanent: false,
      },
      {
        // /nouveau remplacé par le modal NouveauModal piloté par ?nouveau=open.
        // format=carousel pré-sélectionné (default historique). hookId & co
        // préservés automatiquement.
        source: "/nouveau",
        destination: "/admin/repackit/dashboard?nouveau=open&format=carousel",
        permanent: false,
      },
      {
        // Deeplink legacy /tracker?carouselId=C00X → catch-all /p/C00X qui
        // résout le projet+format via Convex et redirige vers la route scopée.
        source: "/tracker",
        has: [{ type: "query", key: "carouselId", value: "(?<id>.+)" }],
        destination: "/p/:id",
        permanent: false,
      },
      {
        source: "/tracker",
        destination: "/admin/repackit/carrousels",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
