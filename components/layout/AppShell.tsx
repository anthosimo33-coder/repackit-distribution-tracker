"use client";

import { usePathname } from "next/navigation";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Loader2Icon } from "lucide-react";

/**
 * Remédiation sécurité — shell applicatif gaté par l'état d'auth (risque B4
 * du diagnostic) :
 *  - /login et /join/<token> sont rendus nus (pages accessibles sans session ;
 *    le proxy les exclut du gating). /join est le flow d'onboarding créateur.
 *  - Le reste de l'app n'est monté QUE sous <Authenticated> : tout le
 *    data-fetching étant client-side (useQuery), cela garantit qu'aucune
 *    query n'est lancée sans token (les fonctions authed* rejetteraient)
 *    et évite le flash de contenu pendant l'hydratation du token.
 *  - <Unauthenticated> n'affiche qu'un loader : le proxy fait la redirection
 *    serveur vers /login, cet état n'est que transitoire (ex: signOut).
 *
 * P3 Multi-tenant — l'AppShell ne monte plus ni ProjectProvider ni
 * SidebarLayout : c'est le rôle du layout `/admin/[projectSlug]` (le projet
 * actif dérive du segment d'URL). Les routes hors `/admin` rendues ici sous
 * <Authenticated> — `/` (resolver du projet par défaut) et `/p/[carouselId]`
 * (deeplink legacy) — n'ont pas de sidebar (transitoires/redirections).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login" || pathname.startsWith("/join")) {
    return <>{children}</>;
  }

  return (
    <>
      <AuthLoading>
        <FullPageLoader />
      </AuthLoading>
      <Unauthenticated>
        <FullPageLoader />
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}

function FullPageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
    </div>
  );
}
