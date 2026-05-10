"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NouveauModal } from "@/components/nouveau/NouveauModal";
import type { MediaType } from "@/lib/media-type";
import type { Id } from "@/convex/_generated/dataModel";

const STORAGE_KEY = "sidebar-collapsed";
const VALID_FORMATS = ["carousel", "short"] as const;

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
 *
 * Batch C — gestion du modal Nouveau via URL param ?nouveau=open. Le
 * NouveauModalController est wrappé en Suspense car useSearchParams()
 * suspend (Next 16). Choix URL params vs Context :
 *   - deeplink-friendly (rechargement préserve l'état d'ouverture)
 *   - cohérent avec la redirect rule next.config.ts /nouveau →
 *     /dashboard?nouveau=open
 *   - aucun provider supplémentaire à wrap autour de l'app
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

      <Suspense fallback={null}>
        <NouveauModalController />
      </Suspense>
    </div>
  );
}

/**
 * Lit ?nouveau=open / ?format=X / ?hookId=Y pour piloter NouveauModal.
 * Le `key` qui dépend de open/closed force un remount complet du modal au
 * close → reset propre du useReducer interne sans logique de nettoyage
 * spécifique. Au prochain ouvrir, fresh state.
 */
function NouveauModalController() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isOpen = searchParams.get("nouveau") === "open";
  const formatParam = searchParams.get("format");
  const hookIdParam = searchParams.get("hookId");

  const initialMediaType = (
    VALID_FORMATS as readonly string[]
  ).includes(formatParam ?? "")
    ? (formatParam as MediaType)
    : undefined;
  const initialHookId = hookIdParam
    ? (hookIdParam as Id<"hooks">)
    : null;

  function close() {
    const next = new URLSearchParams(searchParams);
    next.delete("nouveau");
    next.delete("format");
    next.delete("hookId");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleSuccess(carouselId: string, mediaType: MediaType) {
    const route = mediaType === "carousel" ? "/carrousels" : "/shorts";
    router.push(`${route}?carouselId=${carouselId}`);
  }

  return (
    <NouveauModal
      key={isOpen ? `open-${formatParam ?? ""}-${hookIdParam ?? ""}` : "closed"}
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      initialMediaType={initialMediaType}
      initialHookId={initialHookId}
      onSuccess={handleSuccess}
    />
  );
}
