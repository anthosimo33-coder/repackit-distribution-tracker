import type { CreatorProject } from "@/components/portal/CreatorProjectProvider";
import { cn } from "@/lib/utils";

/**
 * Logo du projet si configuré, sinon initiale sur carré d'accent. DÉCORATIF :
 * `aria-hidden` pour que l'initiale (fallback) ne pollue PAS le nom accessible
 * de l'item de menu (le label du projet, à côté, suffit). Sans ça, un item
 * « Snytch » serait lu « S Snytch » et son accessible name deviendrait
 * « SSnytch » (cassait aussi les sélecteurs e2e par nom exact).
 *
 * Partagé par le portail réel (CreatorProjectSwitcher) et sa réplique en mode
 * observation (ViewAsShell) : l'admin doit voir l'en-tête qu'elle voit.
 */
export function ProjectAvatar({
  project,
  size = "md",
}: {
  project: Pick<CreatorProject, "name" | "accentColor" | "logoUrl">;
  size?: "sm" | "md";
}) {
  const cls = size === "sm" ? "size-6" : "size-7";
  if (project.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={project.logoUrl}
        alt=""
        aria-hidden
        className={cn(cls, "shrink-0 rounded-md object-cover")}
      />
    );
  }
  return (
    <span
      aria-hidden
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
