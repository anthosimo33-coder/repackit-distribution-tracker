"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { getCreatorTools } from "@/lib/creator-tools";
import { resolveSidebarLinkIcon } from "@/lib/sidebar-link-icon";
import { useLabel } from "@/lib/use-label";

/**
 * Page « Outils » du portail créateur (cible de l'onglet Outils de la bottom
 * tab bar mobile). Liste les outils FIGÉS du projet courant — chacun redirige
 * vers son URL externe dans un nouvel onglet. Scopée au projet courant
 * (useCreatorProject) → aucune fuite inter-projets.
 *
 * En pratique l'onglet n'est affiché QUE si le projet a des outils, mais la
 * page gère proprement le cas vide (navigation directe vers /app/outils).
 */
export default function OutilsPage() {
  const t = useTranslations("portal");
  const tLabel = useLabel();
  const { current } = useCreatorProject();
  const tools = getCreatorTools(current.slug);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900">{t("tools.title")}</h1>
        <p className="text-sm text-slate-500">
          Les outils de {current.name}, à ouvrir dans un nouvel onglet.
        </p>
      </header>

      {tools.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">{t("tools.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {tools.map((tool) => {
            const Icon = resolveSidebarLinkIcon(tool.icon);
            return (
              <li key={tool.url}>
                <a
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                    {tLabel(tool.labelKey)}
                  </span>
                  <ExternalLinkIcon className="size-4 shrink-0 text-slate-400" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
