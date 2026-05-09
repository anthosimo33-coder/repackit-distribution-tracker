"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SidebarItemProps = {
  icon: LucideIcon;
  label: string;
  href: string;
  isActive: boolean;
  isCollapsed: boolean;
  // badge prêt mais pas câblé en Batch A. Utilisé au Batch E pour afficher
  // un compteur de drafts par page format.
  badge?: number;
  onNavigate?: () => void;
};

export function SidebarItem({
  icon: Icon,
  label,
  href,
  isActive,
  isCollapsed,
  badge,
  onNavigate,
}: SidebarItemProps) {
  const linkClass = cn(
    "flex items-center rounded-md text-sm transition-colors",
    isCollapsed ? "size-10 justify-center" : "h-10 gap-3 px-3",
    isActive
      ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100",
  );

  const link = (
    <Link href={href} className={linkClass} onClick={onNavigate}>
      <Icon className="size-4 shrink-0" />
      {!isCollapsed && <span className="flex-1 truncate">{label}</span>}
      {!isCollapsed && badge !== undefined && badge > 0 && (
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-xs tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {badge}
        </span>
      )}
    </Link>
  );

  // Tooltip uniquement en mode collapsed — en mode expanded le label est
  // déjà visible, un tooltip serait redondant et bruyant.
  if (!isCollapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
