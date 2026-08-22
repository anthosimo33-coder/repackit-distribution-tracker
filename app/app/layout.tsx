"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { HelpCircleIcon, LogOutIcon } from "lucide-react";
import { AccentStyle } from "@/components/project/AccentStyle";
import { CreatorBottomNav } from "@/components/portal/CreatorBottomNav";
import { CreatorSidebar } from "@/components/portal/CreatorSidebar";
import {
  PortalEmpty,
  PortalPending,
  usePortalGate,
} from "@/components/portal/PortalRoleGate";
import {
  CreatorProjectProvider,
  useCreatorProject,
} from "@/components/portal/CreatorProjectProvider";
import { CreatorProjectSwitcher } from "@/components/portal/CreatorProjectSwitcher";
import { ProgressionCelebration } from "@/components/portal/ProgressionCelebration";
import { Button, buttonVariants } from "@/components/ui/button";
import { getCreatorTools } from "@/lib/creator-tools";
import { isSnytchProject } from "@/lib/snytch-drive";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * P5 — shell du portail créateur PARTENAIRE (/app/*). La garde par rôle est
 * déléguée à `usePortalGate("creator")` (source unique de la matrice de
 * redirection, partagée avec les portails /talent et /clip) :
 *   - créateur partenaire → rend le shell (sidebar desktop / header + bottom nav
 *     mobile) et les pages enfants, sous CreatorProjectProvider ;
 *   - admin / superadmin → redirigé vers son /admin (l'app interne) ;
 *   - talent / clippeur → redirigé vers SON portail (ils n'ont rien à faire ici) ;
 *   - none → état vide.
 * Rendu sous <Authenticated> (AppShell), hors ProjectProvider.
 */
export default function AppPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gate = usePortalGate("creator");

  if (gate.state === "pending") return <PortalPending />;
  if (gate.state === "empty") return <PortalEmpty />;

  // Créateur partenaire : projet courant + switcher gérés par le provider.
  return (
    <CreatorProjectProvider>
      <CreatorShell>{children}</CreatorShell>
    </CreatorProjectProvider>
  );
}

/**
 * Shell interne (sous CreatorProjectProvider) : applique l'accent du PROJET
 * COURANT et agence la navigation scopée sur le projet courant :
 *   - DESKTOP (≥ md) : sidebar gauche (CreatorSidebar) — branding, items,
 *     catégorie Outils, déconnexion. Pas de barre du haut.
 *   - MOBILE (< md) : header (switcher | Guide si outils + déconnexion) en
 *     haut, bottom tab bar (CreatorBottomNav) en bas.
 *
 * Réorganisation mobile conditionnée par les outils du projet :
 *   - AVEC outils → Guide passe dans le header, « Outils » prend sa place dans
 *     la bottom bar (page /app/outils).
 *   - SANS outils → aucune réorganisation : Guide reste dans la bottom bar, pas
 *     de bouton Guide dans le header, pas d'onglet Outils.
 */
function CreatorShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const tPortal = useTranslations("portal");
  const router = useRouter();
  const { signOut } = useAuthActions();
  const { current } = useCreatorProject();
  const hasTools = getCreatorTools(current.slug).length > 0;
  // « Mes fichiers » (dépôt Drive) — Snytch uniquement.
  const showFiles = isSnytchProject(current.slug);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  // P10 branding — accent du projet COURANT injecté dans --primary/--ring.
  const accent = current.accentColor || "#FF5200";
  const accentVars = {
    "--primary": accent,
    "--ring": accent,
  } as React.CSSProperties;

  return (
    <div className="min-h-screen bg-slate-50 md:flex" style={accentVars}>
      <AccentStyle accent={accent} />
      {/* Célébration globale à la traversée d'un palier (créateur uniquement). */}
      <ProgressionCelebration projectId={current.projectId} />

      {/* Header MOBILE (< md) : switcher | (Guide si outils) + déconnexion. */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 md:hidden">
        <CreatorProjectSwitcher />
        <div className="flex shrink-0 items-center gap-0.5">
          {hasTools && (
            <Link
              href="/app/guide"
              aria-label={tPortal("nav.guide")}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "text-slate-600 hover:text-slate-900",
              )}
            >
              <HelpCircleIcon className="size-5" />
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSignOut}
            aria-label={t("action.logout")}
            className="text-slate-600 hover:text-slate-900"
          >
            <LogOutIcon className="size-5" />
          </Button>
        </div>
      </header>

      {/* Sidebar DESKTOP (≥ md). */}
      <CreatorSidebar onSignOut={handleSignOut} />

      {/* pb-24 sur mobile : marge sous le contenu pour ne pas être masqué par la
          bottom tab bar (h-16 + safe-area). */}
      <main className="flex-1 overflow-x-hidden">
        <div className="container mx-auto px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8">
          {children}
        </div>
      </main>

      <CreatorBottomNav
        projectId={current.projectId}
        hasTools={hasTools}
        showFiles={showFiles}
      />
    </div>
  );
}
