"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
import { useProject } from "@/components/project/ProjectProvider";
import { CreateProjectDialog } from "@/components/project/CreateProjectDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * P3 — switcher de projet en tête de sidebar. Liste les projets de
 * l'utilisateur (memberships ; superadmin → tous, via api.projects
 * .listMyProjects). Sélectionner un projet navigue vers son dashboard scopé.
 * « Créer un projet » (superadmin uniquement) ouvre le modal de création.
 *
 * En mode collapsed : pastille d'accent + initiale, le menu reste accessible.
 */
export function ProjectSwitcher({
  isCollapsed,
  onNavigate,
}: {
  isCollapsed: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { project } = useProject();
  const projects = useQuery(api.projects.listMyProjects, {});
  const me = useQuery(api.projects.getMe, {});
  const [createOpen, setCreateOpen] = useState(false);

  function switchTo(slug: string) {
    onNavigate?.();
    if (slug !== project.slug) {
      router.push(projectPath(slug, "/dashboard"));
    }
  }

  const trigger = (
    <button
      type="button"
      className={cn(
        "flex w-full items-center rounded-md border border-slate-200 bg-white text-left transition-colors hover:bg-slate-50",
        isCollapsed ? "justify-center p-1.5" : "gap-2 px-2 py-1.5",
      )}
      aria-label="Changer de projet"
    >
      <ProjectAvatar
        name={project.name}
        accentColor={project.accentColor}
        logoUrl={project.logoUrl}
      />
      {!isCollapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">
              {project.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-slate-400">
              {project.slug}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-slate-400" />
        </>
      )}
    </button>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            isCollapsed ? (
              <Tooltip>
                <TooltipTrigger render={trigger} />
                <TooltipContent side="right" sideOffset={8}>
                  {project.name}
                </TooltipContent>
              </Tooltip>
            ) : (
              trigger
            )
          }
        />
        <DropdownMenuContent
          align="start"
          className="w-56"
          sideOffset={6}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Projets</DropdownMenuLabel>
            {projects === undefined ? (
              <DropdownMenuItem disabled>Chargement…</DropdownMenuItem>
            ) : (
              projects.map((p) => (
                <DropdownMenuItem
                  key={p._id}
                  onClick={() => switchTo(p.slug)}
                  className="gap-2"
                >
                  {p.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.logoUrl}
                      alt=""
                      className="size-4 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: p.accentColor || "#FF5200" }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.slug === project.slug && (
                    <CheckIcon className="size-4 shrink-0 text-slate-500" />
                  )}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
          {me?.isSuperadmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  onNavigate?.();
                  setCreateOpen(true);
                }}
                className="gap-2 text-slate-600"
              >
                <PlusIcon className="size-4" />
                Créer un projet
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {me?.isSuperadmin && (
        <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      )}
    </>
  );
}

/**
 * Identité visuelle du projet : logo (image carrée arrondie, object-cover) si
 * le projet a un `logoUrl` configuré ; sinon fallback initiale du nom sur un
 * carré de l'accentColor (comportement historique inchangé). Même gabarit dans
 * les deux cas (size-7) pour ne pas décaler la mise en page du switcher.
 */
function ProjectAvatar({
  name,
  accentColor,
  logoUrl,
}: {
  name: string;
  accentColor: string;
  logoUrl?: string;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className="size-7 shrink-0 rounded-md object-cover"
      />
    );
  }
  const accent = accentColor || "#FF5200";
  const initial = name.charAt(0).toUpperCase() || "?";
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
      style={{ backgroundColor: accent }}
    >
      {initial}
    </span>
  );
}
