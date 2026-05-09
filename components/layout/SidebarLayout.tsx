"use client";

import { useEffect, useState } from "react";
import { MenuIcon } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "sidebar-collapsed";

/**
 * Layout root sidebar + main slot. Logique :
 *  - Desktop (≥ lg) : sidebar fixe à gauche, largeur 240/64 selon collapsed.
 *  - Mobile  (< lg) : sidebar masquée, header sticky avec hamburger qui ouvre
 *                     un Sheet drawer left contenant la même Sidebar.
 *
 * Persistance localStorage : best-effort. Default = expanded (false). Lecture
 * en useEffect post-mount → un flicker possible si l'utilisateur a collapsed,
 * accepté pour ne pas SSR-mismatch.
 *
 * Choix Sheet shadcn (basé Base UI Dialog) plutôt qu'un Dialog custom :
 *   - Gestion native focus trap, ESC, scroll lock, animations side="left".
 *   - Cohérent avec le reste du repo qui utilise déjà Base UI partout
 *     (Tooltip, Popover, Select, Dialog…).
 *   - Aucun coût bundle additionnel — sheet réutilise la primitive Dialog.
 */
export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // Hydratation post-mount du state local depuis localStorage. Pattern
      // accepté ici car (a) la valeur n'est pas accessible en SSR, (b)
      // l'alternative useSyncExternalStore ajoute de la machinerie pour un
      // simple flag boolean. Flicker bref accepté.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "true") setIsCollapsed(true);
    } catch {
      // localStorage indispo (SSR, mode privé Safari, quota) → garde default.
    }
  }, []);

  function handleToggle() {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Best-effort : pas de fallback, l'état mémoire suffit pour la session.
      }
      return next;
    });
  }

  function closeMobileDrawer() {
    setMobileOpen(false);
  }

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      {/* Header mobile : visible uniquement < lg */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Ouvrir le menu"
              >
                <MenuIcon className="size-4" />
              </Button>
            }
          />
          <SheetContent
            side="left"
            className="w-60 p-0"
            showCloseButton={false}
          >
            <Sidebar
              isCollapsed={false}
              onToggle={() => {}}
              onNavigate={closeMobileDrawer}
              isMobileDrawer
            />
          </SheetContent>
        </Sheet>
        <span className="text-sm font-semibold text-slate-900">
          RepackIt Distribution
        </span>
      </header>

      {/* Sidebar desktop : visible uniquement ≥ lg */}
      <div className="hidden shrink-0 lg:block">
        <Sidebar isCollapsed={isCollapsed} onToggle={handleToggle} />
      </div>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
