"use client";

import { useTranslations } from "next-intl";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { A_DOCUMENTER_MIN_VUES } from "@/convex/playbookFiche";

/**
 * À DOCUMENTER — les posts des 30 derniers jours qui sortent du lot et
 * qu'aucune fiche ne cite encore : la file qui tient le playbook à jour. On les
 * range en collant leur lien dans une fiche, ou Claude le fait
 * (`documenter_format`). Rien quand la file est vide.
 */
export function ADocumenter() {
  const tr = useTranslations("admin.scripts.PlaybookADocumenter");
  const loc = useIntlLocale();
  const file = useProjectQuery(api.playbook.listADocumenter, {});
  if (!file || file.total === 0) return null;

  return (
    <Card data-testid="playbook-a-documenter">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <SparklesIcon className="size-4 text-amber-500" aria-hidden />
          {tr("titre", { n: file.total })}
        </CardTitle>
        <p className="text-xs text-slate-500">{tr("aide", { seuil: formatNumber(A_DOCUMENTER_MIN_VUES, loc) })}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {file.posts.map((p) => (
            <li key={p.publicationId} className="flex items-start gap-3 px-3 py-2.5" data-testid="playbook-a-documenter-post">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <Badge variant="outline" className="text-[10px] text-slate-500">
                    {p.plateforme}
                  </Badge>
                  <span className="truncate font-medium text-slate-900">{p.compte}</span>
                  <span className="text-xs text-slate-400">{formatDate(p.datePubli, loc)}</span>
                </div>
                <p className="truncate text-xs text-slate-500">{p.campagne ?? tr("sansCampagne")}</p>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">
                {tr("vues", { n: formatNumber(p.vues ?? 0, loc) })}
              </span>
              {p.url && (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 text-slate-400 hover:text-slate-900"
                  aria-label={tr("ouvrir")}
                >
                  <ExternalLinkIcon className="size-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
        {file.total > file.posts.length && (
          <p className="text-xs text-slate-400">{tr("autres", { n: file.total - file.posts.length })}</p>
        )}
      </CardContent>
    </Card>
  );
}
