import { ProjectProvider } from "@/components/project/ProjectProvider";
import { ViewAsProvider } from "@/components/portal/ViewAsProvider";
import { ViewAsShell } from "@/components/portal/ViewAsShell";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — layout du mode vue.
 *
 * Route SŒUR de /admin/[projectSlug] (segment statique « voir ») → elle
 * N'HÉRITE PAS du layout admin (sidebar interne) : on rend le shell créateur.
 *   - ProjectProvider résout le projet par slug et GATE l'accès admin/superadmin
 *     côté client (un créateur y est renvoyé vers /app ; un non-membre voit
 *     « accès refusé ») — la vraie barrière reste serveur (adminViewAsQuery) ;
 *   - ViewAsProvider résout le créateur ciblé (scopé projet) et alimente les
 *     contextes (projet synthétique + mode view-as) ;
 *   - ViewAsShell ajoute le bandeau persistant + la nav read-only.
 * Monté sous AppShell (<Authenticated>) via le layout racine.
 */
export default async function ViewAsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectSlug: string; id: string }>;
}) {
  const { projectSlug, id } = await params;

  return (
    <ProjectProvider slug={projectSlug}>
      <ViewAsProvider creatorId={id as Id<"creators">}>
        <ViewAsShell>{children}</ViewAsShell>
      </ViewAsProvider>
    </ProjectProvider>
  );
}
