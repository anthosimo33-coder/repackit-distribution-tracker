"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Batch A — pointe vers /nouveau (route legacy).
 * Au Batch C ce bouton ouvrira un modal multi-étapes (initialMediaType
 * optionnel selon le contexte de déclenchement). Cette version transitoire
 * est volontairement simple : router.push, pas de state global.
 */
export function NewButton({
  isCollapsed,
  onNavigate,
}: {
  isCollapsed: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  function handleClick() {
    onNavigate?.();
    router.push("/nouveau");
  }

  const button = (
    <Button
      onClick={handleClick}
      className={cn("h-10 w-full", isCollapsed && "px-0")}
    >
      <PlusIcon className="size-4" />
      {!isCollapsed && <span>Nouveau</span>}
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
