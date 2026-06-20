"use client";

import { useRouter } from "next/navigation";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import {
  useCreatorProject,
  type CreatorProject,
} from "@/components/portal/CreatorProjectProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Switcher de projet du portail créateur. Mobile-first (les créateurs sont au
 * téléphone) : zone tactile généreuse, dropdown plein-pouce.
 *   - 1 seul projet → affichage statique discret du projet courant (pas de menu).
 *   - N projets → bouton + dropdown listant SES projets, avec branding par
 *     projet (logo ou initiale + accent). Changer de projet mémorise le choix
 *     (localStorage via le provider) et renvoie au tableau de bord du projet.
 */
export function CreatorProjectSwitcher() {
  const router = useRouter();
  const { current, projects, setProjectId } = useCreatorProject();
  const multi = projects.length > 1;

  function switchTo(p: CreatorProject) {
    if (p.projectId !== current.projectId) {
      setProjectId(p.projectId);
      // Repart du tableau de bord : un détail (assignment) du projet précédent
      // n'existe pas dans le nouveau projet.
      router.push("/app");
    }
  }

  // Mono-projet : pas de switcher, juste l'identité du projet courant.
  if (!multi) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <ProjectAvatar project={current} />
        <span className="truncate text-sm font-semibold text-slate-900">
          {current.name}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
            aria-label="Changer de projet"
          >
            <ProjectAvatar project={current} />
            <span className="truncate text-sm font-semibold text-slate-900">
              {current.name}
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 text-slate-400" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-60" sideOffset={6}>
        <DropdownMenuLabel>Mes projets</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.projectId}
            onClick={() => switchTo(p)}
            className="gap-2 py-2.5"
          >
            <ProjectAvatar project={p} size="sm" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.projectId === current.projectId && (
              <CheckIcon className="size-4 shrink-0 text-slate-500" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Logo du projet si configuré, sinon initiale sur carré d'accent. */
function ProjectAvatar({
  project,
  size = "md",
}: {
  project: CreatorProject;
  size?: "sm" | "md";
}) {
  const cls = size === "sm" ? "size-6" : "size-7";
  if (project.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={project.logoUrl}
        alt=""
        className={cn(cls, "shrink-0 rounded-md object-cover")}
      />
    );
  }
  return (
    <span
      className={cn(
        cls,
        "flex shrink-0 items-center justify-center rounded-md text-xs font-bold text-white",
      )}
      style={{ backgroundColor: project.accentColor || "#FF5200" }}
    >
      {project.name.charAt(0).toUpperCase() || "?"}
    </span>
  );
}
