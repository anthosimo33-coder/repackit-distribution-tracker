"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { ArrowLeftIcon } from "lucide-react";
import { ShortSourcesTable } from "@/components/shorts/sources/ShortSourcesTable";
import { ShortSourcesSkeleton } from "@/components/shorts/sources/ShortSourcesSkeleton";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Bibliothèque sources (/shorts/sources) — matrice sourceId × plateforme.
 *
 * Sous-route de /shorts (sidebar reste sur "Shorts" via startsWith). Pattern
 * index calqué sur /biblio-hooks : header + barre filtres + table.
 *
 * Filtre couverture : Tous / Partiels (1-2 plateformes) / Complets (3). Note :
 * un sourceId n'apparaît qu'une fois posté quelque part, donc total ∈ {1,2,3}
 * (jamais 0) — pas de segment "Disponibles" (vide par construction).
 */
type CoverageFilter = "all" | "partial" | "complete";
const FILTERS: { key: CoverageFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "partial", label: "Partiels" },
  { key: "complete", label: "Complets" },
];

export default function ShortSourcesPage() {
  const projectPath = useProjectPath();
  const sources = useProjectQuery(api.publications.listSources, {});
  const [search, setSearch] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("all");

  const filtered = useMemo(() => {
    if (!sources) return [];
    const q = search.trim().toLowerCase();
    return sources.filter((s) => {
      if (
        coverageFilter === "partial" &&
        !(s.coverage.total === 1 || s.coverage.total === 2)
      ) {
        return false;
      }
      if (coverageFilter === "complete" && s.coverage.total !== 3) {
        return false;
      }
      if (q && !s.sourceId.includes(q)) return false;
      return true;
    });
  }, [sources, search, coverageFilter]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href={projectPath("/shorts")}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-4" />
          Retour aux Shorts
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Bibliothèque sources
        </h1>
        <p className="text-sm text-slate-500">
          {sources === undefined
            ? "Chargement…"
            : `${formatNumber(filtered.length)} source${
                filtered.length > 1 ? "s" : ""
              }${
                filtered.length !== sources.length
                  ? ` sur ${formatNumber(sources.length)}`
                  : ""
              }`}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label
            htmlFor="source-search"
            className="text-xs font-medium text-slate-600"
          >
            Recherche
          </label>
          <Input
            id="source-search"
            placeholder="Nom de source…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-600">Couverture</span>
          <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setCoverageFilter(f.key)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-semibold transition-colors",
                  coverageFilter === f.key
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {sources === undefined ? (
        <ShortSourcesSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState hasAny={sources.length > 0} />
      ) : (
        <ShortSourcesTable sources={filtered} />
      )}
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
      <p className="text-sm text-slate-500">
        {hasAny
          ? "Aucune source ne correspond à ces filtres."
          : "Aucune source de Short pour l'instant."}
      </p>
      {!hasAny && (
        <p className="text-xs text-slate-400">
          Les sourceId saisis sur les Shorts apparaîtront ici.
        </p>
      )}
    </div>
  );
}
