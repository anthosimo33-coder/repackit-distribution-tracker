"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Batch C — bouton "+ Nouveau" sidebar : déclenche l'ouverture du modal
 * NouveauModal (rendu globalement par SidebarLayout) en ajoutant
 * ?nouveau=open à la route courante. Pas de pré-sélection format depuis ce
 * point d'entrée — c'est le flux générique.
 */
export function NewButton(props: {
  isCollapsed: boolean;
  onNavigate?: () => void;
}) {
  // useSearchParams() suspend en Next 16 — wrap interne pour ne pas
  // polluer la Sidebar parent qui ne l'utilise plus depuis Batch B.
  return (
    <Suspense fallback={<NewButtonShell {...props} />}>
      <NewButtonInner {...props} />
    </Suspense>
  );
}

function NewButtonInner({
  isCollapsed,
  onNavigate,
}: {
  isCollapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleClick() {
    onNavigate?.();
    const next = new URLSearchParams(searchParams);
    next.set("nouveau", "open");
    // Pas de pré-sélection format ici — flux générique. Si l'utilisateur
    // arrive depuis /carrousels ou /shorts, il pourra revenir au step 1
    // via le bouton "Précédent" du modal.
    next.delete("format");
    next.delete("hookId");
    router.push(`${pathname}?${next.toString()}`);
  }

  const button = (
    <Button
      onClick={handleClick}
      className={cn("h-10 w-full", isCollapsed && "px-0")}
    >
      <PlusIcon className="size-4" />
      {!isCollapsed && <span>{t("action.new")}</span>}
    </Button>
  );

  if (!isCollapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right" sideOffset={8}>
        Nouveau
      </TooltipContent>
    </Tooltip>
  );
}

// Fallback rendu pendant que useSearchParams() suspend (premier paint
// avant hydratation). Bouton no-op pour préserver le layout.
function NewButtonShell({ isCollapsed }: { isCollapsed: boolean }) {
  const t = useTranslations("nav");
  return (
    <Button
      disabled
      className={cn("h-10 w-full", isCollapsed && "px-0")}
    >
      <PlusIcon className="size-4" />
      {!isCollapsed && <span>{t("action.new")}</span>}
    </Button>
  );
}
