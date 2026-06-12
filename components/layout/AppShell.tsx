"use client";

import { usePathname } from "next/navigation";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { SidebarLayout } from "@/components/layout/SidebarLayout";
import { ProjectProvider } from "@/components/project/ProjectProvider";

/**
 * Remédiation sécurité — shell applicatif gaté par l'état d'auth (risque B4
 * du diagnostic) :
 *  - /login est rendu nu (la page doit être accessible sans session ; le
 *    proxy redirige déjà les utilisateurs connectés vers /dashboard).
 *  - Le reste de l'app n'est monté QUE sous <Authenticated> : tout le
 *    data-fetching étant client-side (useQuery), cela garantit qu'aucune
 *    query n'est lancée sans token (les fonctions authed* rejetteraient)
 *    et évite le flash de contenu pendant l'hydratation du token.
 *  - <Unauthenticated> n'affiche qu'un loader : le proxy fait la redirection
 *    serveur vers /login, cet état n'est que transitoire (ex: signOut).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
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
      <Authenticated>
        {/* P2 — ProjectProvider gate le rendu sur la résolution du projet
            courant : sous cet arbre, useProjectId() est toujours défini. */}
        <ProjectProvider>
          <SidebarLayout>
            <div className="container mx-auto px-6 py-8">{children}</div>
          </SidebarLayout>
        </ProjectProvider>
      </Authenticated>
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
