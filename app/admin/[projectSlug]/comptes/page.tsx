"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PlatformBadge } from "@/components/VerdictBadge";
import { countryLabel } from "@/lib/countries";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusIcon,
  UsersIcon,
  TargetIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getEffectiveStatus,
  getStatusBadge,
  getEffectiveWarmupDuration,
  type CompteStatus,
  type Plateforme,
} from "@/lib/compte-status";
import { warmupProgress, lastCheck } from "@/lib/warmup";
import { PersonnesManagerSection } from "@/components/comptes/PersonnesManagerSection";
import { IcpsManagerSection } from "@/components/icps/IcpsManagerSection";
import { WarmupGuideButton } from "@/components/warmup/WarmupGuideButton";
import CompteDialog, { type Compte } from "@/components/comptes/CompteDialog";
import { CompteAdminActions } from "@/components/comptes/CompteAdminActions";
import { ComptesAValiderSection } from "@/components/comptes/ComptesAValiderSection";
import { useLabel } from "@/lib/use-label";

type StatusFilter = "all" | CompteStatus;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "actif", label: "Actifs" },
  { value: "warmup", label: "Warmup" },
  { value: "shadowban", label: "Shadowban" },
  { value: "archived", label: "Archivés" },
];

type PlateformeFilter = "all" | "TikTok" | "Instagram" | "YouTube";
const PLATEFORME_FILTER_OPTIONS: { value: PlateformeFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "TikTok", label: "TikTok" },
  { value: "Instagram", label: "Instagram" },
  { value: "YouTube", label: "YouTube" },
];

// "all" | "internal" (comptes sans créateur) | <creatorId>.
type CreatorFilter = string;
type SortKey = "handle" | "vues" | "posts" | "dernierPost";
type SortDir = "asc" | "desc";

const nfFR = new Intl.NumberFormat("fr-FR");
function formatDateShort(ts: number | null): string {
  return ts === null ? "—" : new Date(ts).toLocaleDateString("fr-FR");
}

export default function ComptesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ComptesPageInner />
    </Suspense>
  );
}

function ComptesPageInner() {
  const tLabel = useLabel();
  const router = useRouter();
  const projectPath = useProjectPath();
  const searchParams = useSearchParams();
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Compte | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [plateformeFilter, setPlateformeFilter] =
    useState<PlateformeFilter>("all");
  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("handle");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const viewParam = searchParams.get("view");
  const isPersonnesView = viewParam === "personnes";
  const isIcpsView = viewParam === "icps";

  function navigate(view: "personnes" | "icps" | null) {
    const params = new URLSearchParams(searchParams);
    if (view) params.set("view", view);
    else params.delete("view");
    const qs = params.toString();
    router.replace(projectPath(qs ? `/comptes?${qs}` : "/comptes"));
  }

  // Compteurs par statut (sur l'ensemble, hors filtre) pour le sous-titre.
  const counts = useMemo(() => {
    const acc = { actif: 0, warmup: 0, shadowban: 0, archived: 0 };
    for (const c of comptes ?? []) acc[getEffectiveStatus(c)]++;
    return acc;
  }, [comptes]);

  // Options du filtre créateur : créateurs distincts présents (par id + nom).
  const creatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of comptes ?? []) {
      if (c.creatorId && c.creator) map.set(c.creatorId, c.creator.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [comptes]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Perf : tri descendant par défaut (le plus performant d'abord) ;
      // handle : ascendant (ordre alphabétique).
      setSortDir(key === "handle" ? "asc" : "desc");
    }
  }

  // Filtres combinables (statut × plateforme × créateur) + tri par colonne.
  const rows = useMemo(() => {
    const list = (comptes ?? []).filter((c) => {
      if (statusFilter !== "all" && getEffectiveStatus(c) !== statusFilter)
        return false;
      if (plateformeFilter !== "all" && c.plateforme !== plateformeFilter)
        return false;
      if (creatorFilter === "internal" && c.creatorId) return false;
      if (
        creatorFilter !== "all" &&
        creatorFilter !== "internal" &&
        c.creatorId !== creatorFilter
      )
        return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "handle":
          cmp = a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" });
          break;
        case "vues":
          cmp = a.perf.vuesCumulees - b.perf.vuesCumulees;
          break;
        case "posts":
          cmp = a.perf.nbPublies - b.perf.nbPublies;
          break;
        case "dernierPost":
          cmp = (a.perf.dernierPost ?? 0) - (b.perf.dernierPost ?? 0);
          break;
      }
      // Départage stable par handle quand la métrique est à égalité.
      if (cmp === 0 && sortKey !== "handle") {
        cmp = a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" });
        return cmp; // toujours ascendant pour le tie-break
      }
      return cmp * dir;
    });
  }, [comptes, statusFilter, plateformeFilter, creatorFilter, sortKey, sortDir]);

  if (isPersonnesView) {
    return (
      <div className="space-y-6">
        <PersonnesManagerSection onBack={() => navigate(null)} />
      </div>
    );
  }

  if (isIcpsView) {
    return (
      <div className="space-y-6">
        <IcpsManagerSection onBack={() => navigate(null)} />
      </div>
    );
  }

  const subtitle = (() => {
    if (comptes === undefined) return "Chargement…";
    const parts = [`${counts.actif} actif${counts.actif > 1 ? "s" : ""}`];
    if (counts.warmup > 0) parts.push(`${counts.warmup} warmup`);
    if (counts.shadowban > 0) parts.push(`${counts.shadowban} shadowban`);
    if (counts.archived > 0)
      parts.push(`${counts.archived} archivé${counts.archived > 1 ? "s" : ""}`);
    return parts.join(" · ");
  })();

  return (
    <div className="space-y-6">
      {/* File de validation des comptes de clippeur — en TÊTE parce qu'elle est
          bloquante pour eux : tant qu'un compte n'est pas validé, son compteur
          de phase n'a pas démarré et il ne peut rien publier. La section
          s'efface d'elle-même quand la file est vide. */}
      <ComptesAValiderSection />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Comptes
          </h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={creatorFilter}
            onValueChange={(v) => v !== null && setCreatorFilter(v)}
          >
            <SelectTrigger className="w-40" aria-label="Filtrer par créateur">
              <SelectValue>
                {creatorFilter === "all"
                  ? "Tous créateurs"
                  : creatorFilter === "internal"
                    ? "Interne"
                    : (creatorOptions.find((o) => o.id === creatorFilter)
                        ?.name ?? "Créateur")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous créateurs</SelectItem>
              <SelectItem value="internal">Interne</SelectItem>
              {creatorOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={plateformeFilter}
            onValueChange={(v) =>
              v !== null && setPlateformeFilter(v as PlateformeFilter)
            }
          >
            <SelectTrigger className="w-32" aria-label="Filtrer par plateforme">
              <SelectValue>
                {PLATEFORME_FILTER_OPTIONS.find(
                  (o) => o.value === plateformeFilter,
                )?.label ?? "Toutes"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PLATEFORME_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              v !== null && setStatusFilter(v as StatusFilter)
            }
          >
            <SelectTrigger className="w-36" aria-label="Filtrer par statut">
              <SelectValue>
                {STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)
                  ?.label ?? "Tous"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <WarmupGuideButton />
          <Button variant="outline" onClick={() => navigate("personnes")}>
            <UsersIcon className="mr-2 size-4" />
            Personnes
          </Button>
          <Button variant="outline" onClick={() => navigate("icps")}>
            <TargetIcon className="mr-2 size-4" />
            ICPs
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon className="mr-2 size-4" />
            Ajouter un compte
          </Button>
        </div>
      </header>

      {comptes === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : comptes.length === 0 ? (
        <EmptyState onAdd={() => setAddOpen(true)} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Aucun compte pour ce filtre.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader
                    label="Handle"
                    sortKey="handle"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <TableHead>Plateforme</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Gestionnaire</TableHead>
                  <TableHead>Créateur</TableHead>
                  <TableHead>Warmup</TableHead>
                  <SortHeader
                    label="Vues"
                    sortKey="vues"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Posts"
                    sortKey="posts"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Dernier post"
                    sortKey="dernierPost"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const badge = getStatusBadge(c);
                  const isWarmup = getEffectiveStatus(c) === "warmup";
                  // Durée servie par le serveur — jamais recalculée ici.
                  const target = c.targetDays;
                  const progress =
                    isWarmup && c.warmupStartedAt !== undefined
                      ? warmupProgress(
                          c.warmupProtocol?.dailyChecks?.length ?? 0,
                          target,
                        )
                      : null;
                  const last = lastCheck(c.warmupProtocol?.dailyChecks ?? []);
                  return (
                    <TableRow
                      key={c._id}
                      className={cn(
                        getEffectiveStatus(c) === "archived" && "opacity-50",
                      )}
                    >
                      <TableCell className="font-mono font-medium text-slate-900">
                        <Link
                          href={projectPath(`/comptes/${c._id}`)}
                          className="transition-colors hover:text-primary hover:underline"
                        >
                          {c.handle}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <PlatformBadge plateforme={c.plateforme} />
                          {/* Pays ciblé (label informatif #110) — masqué si non
                              défini, même style que le badge de la fiche détail. */}
                          {c.targetCountry && (
                            <span
                              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600"
                              title="Pays ciblé"
                            >
                              {countryLabel(c.targetCountry)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold",
                            badge.className,
                          )}
                        >
                          {tLabel(badge.labelKey, badge.params)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {c.personne ? (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                            {c.personne.prenom} {c.personne.nom}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.creator ? (
                          <span className="font-medium text-slate-700">
                            {c.creator.name}
                          </span>
                        ) : (
                          <span className="text-slate-400">Interne</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {progress ? (
                          <div className="leading-tight">
                            <span className="font-medium text-slate-700">
                              Jour {progress.day}/{progress.targetDays}
                            </span>
                            <span className="block text-xs text-slate-400">
                              {last ? `Check ${last}` : "Aucun check"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-slate-900">
                        {nfFR.format(c.perf.vuesCumulees)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">
                        {c.perf.nbPublies}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {formatDateShort(c.perf.dernierPost)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <CompteAdminActions
                          compte={c}
                          onEdit={() => setEditTarget(c)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CompteDialog open={addOpen} onOpenChange={setAddOpen} mode="add" />
      <CompteDialog
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        mode="edit"
        compte={editTarget ?? undefined}
      />
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === sortKey;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      {/* Pas d'aria-label : le texte visible EST le nom accessible. Un
          aria-label contenant le libellé (ex. « Handle ») collisionnerait avec
          les nombreux specs qui font getByLabel('Handle') (match en substring)
          dès que la table est rendue. */}
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-slate-900",
          align === "right" && "flex-row-reverse",
          active ? "text-slate-900" : "text-slate-500",
        )}
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ChevronUpIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          ))}
      </button>
    </TableHead>
  );
}


function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-sm text-slate-500">
          Aucun compte. Ajoute ton premier compte TikTok ou Instagram.
        </p>
        <Button onClick={onAdd}>
          <PlusIcon className="mr-2 size-4" />
          Ajouter un compte
        </Button>
      </CardContent>
    </Card>
  );
}
