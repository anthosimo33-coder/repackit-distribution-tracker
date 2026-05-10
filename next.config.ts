import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Batch B — redirects de routes legacy vers les nouvelles pages format.
   *
   * Ordre important : la règle /tracker avec `has` (carouselId présent) doit
   * matcher AVANT la règle /tracker générique. Next.js teste les redirects
   * dans l'ordre déclaré.
   *
   * permanent: true → 308 (sémantiquement permanent : / ou /hooks ne
   * reviendront pas). permanent: false → 307 pour /tracker?carouselId →
   * /p/X car la résolution dynamique ne devrait pas être cachée par les
   * crawlers/browsers indéfiniment.
   */
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: true,
      },
      {
        source: "/hooks",
        destination: "/biblio-hooks",
        permanent: true,
      },
      {
        source: "/hooks/:path*",
        destination: "/biblio-hooks/:path*",
        permanent: true,
      },
      {
        // Deeplink legacy /tracker?carouselId=C00X → catch-all /p/C00X qui
        // résout via Convex et redirige vers /carrousels ou /shorts.
        source: "/tracker",
        has: [{ type: "query", key: "carouselId", value: "(?<id>.+)" }],
        destination: "/p/:id",
        permanent: false,
      },
      {
        source: "/tracker",
        destination: "/carrousels",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
