import { ProjectProvider } from "@/components/project/ProjectProvider";
import { SidebarLayout } from "@/components/layout/SidebarLayout";
import { SnapshotAgeProvider } from "@/components/snapshot-age-selector/SnapshotAgeContext";

/**
 * P3 Multi-tenant — layout de l'app interne, scopé par le segment d'URL
 * `[projectSlug]`. L'URL est la SOURCE DE VÉRITÉ du projet actif :
 *
 *  - ProjectProvider résout le slug (api.projects.getProjectForCurrentUser,
 *    vérif d'accès serveur) et gate le rendu → sous cet arbre, useProjectId()
 *    est toujours défini, et l'accès refusé/introuvable est rendu proprement.
 *  - SidebarLayout : sidebar (switcher de projet + nav scopée + footer) + slot
 *    principal + NouveauModal.
 *  - SnapshotAgeProvider keyé par slug : la période J+X est mémorisée PAR
 *    projet (clé localStorage `tracker.snapshot-age:<slug>`) ; le remount au
 *    changement de slug relit le bon état.
 *
 * Le rendu d'AppShell garantit que ce layout n'est monté que sous
 * <Authenticated>.
 */
export default async function AdminProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;

  return (
    <ProjectProvider slug={projectSlug}>
      <SidebarLayout>
        <SnapshotAgeProvider key={projectSlug} storageSuffix={projectSlug}>
          <div className="container mx-auto px-6 py-8">{children}</div>
        </SnapshotAgeProvider>
      </SidebarLayout>
    </ProjectProvider>
  );
}
