"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VerdictBadge, PlatformBadge } from "@/components/VerdictBadge";
import { PublicationEditDialog } from "@/components/PublicationEditDialog";
import { PublicationDetailDialog } from "@/components/PublicationDetailDialog";
import { calculateSaveRate, calculateVerdict, type Verdict } from "@/lib/verdict";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { isPublished } from "@/lib/publication-status";
import { cn } from "@/lib/utils";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  FileTextIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";

const ALL = "all";
const PENDING = "Pending";
const MECANIQUES = [
  "Erreur",
  "Volume",
  "Comparaison",
  "Contradiction",
  "Universalité",
  "Question",
] as const;
const FORMATS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type SortKey = "date" | "saveRate";
type SortDir = "asc" | "desc";

export default function TrackerPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [plateforme, setPlateforme] = useState<string>(ALL);
  const [mecanique, setMecanique] = useState<string>(ALL);
  const [format, setFormat] = useState<string>(ALL);
  const [verdictFilter, setVerdictFilter] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [editingPub, setEditingPub] = useState<Doc<"publications"> | null>(
    null,
  );
  const [viewingPub, setViewingPub] = useState<Doc<"publications"> | null>(
    null,
  );
  const [deletingPub, setDeletingPub] = useState<Doc<"publications"> | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const publications = useQuery(api.publications.listPublications);
  const deletePub = useMutation(api.publications.deletePublication);

  const filtered = useMemo(() => {
    if (!publications) return [];
    let list = publications;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((p) => p.hookText.toLowerCase().includes(q));
    }
    if (plateforme !== ALL)
      list = list.filter((p) => p.plateforme === plateforme);
    if (mecanique !== ALL)
      list = list.filter((p) => p.mecanique === mecanique);
    if (format !== ALL) list = list.filter((p) => p.format === format);
    if (verdictFilter !== ALL) {
      list = list.filter((p) => {
        // Verdict ne s'applique qu'aux publiés (Feature 4). Les drafts sont
        // toujours en attente, peu importe leurs métriques saisies.
        const v = isPublished(p)
          ? calculateVerdict(calculateSaveRate(p.saves, p.vuesJ7))
          : null;
        if (verdictFilter === PENDING) return v === null;
        return v === verdictFilter;
      });
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.datePubli - b.datePubli;
      else {
        // Save rate non défini sur les drafts pour le tri (consistance avec
        // l'affichage et le filtre verdict).
        const ra = isPublished(a) ? calculateSaveRate(a.saves, a.vuesJ7) : null;
        const rb = isPublished(b) ? calculateSaveRate(b.saves, b.vuesJ7) : null;
        if (ra === null && rb === null) cmp = 0;
        else if (ra === null) cmp = 1;
        else if (rb === null) cmp = -1;
        else cmp = ra - rb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [
    publications,
    debouncedSearch,
    plateforme,
    mecanique,
    format,
    verdictFilter,
    sortKey,
    sortDir,
  ]);

  // Split filtered list along the published/draft boundary defined by isPublished.
  // Both sections share the same filter + sort state — the split is purely visual.
  const drafts = useMemo(
    () => filtered.filter((p) => !isPublished(p)),
    [filtered],
  );
  const published = useMemo(
    () => filtered.filter((p) => isPublished(p)),
    [filtered],
  );

  const stats = useMemo(() => {
    if (!publications) {
      return {
        publishedCount: 0,
        draftCount: 0,
        vuesTotal: 0,
        avgSaveRate: null as number | null,
        winners: 0,
      };
    }
    // Feature 4 : KPIs agrègent sur publiés uniquement. Les drafts comptent
    // séparément pour l'affichage "+X à venir".
    const publishedPubs = publications.filter(isPublished);
    const draftCount = publications.length - publishedPubs.length;
    let vuesTotal = 0;
    const rates: number[] = [];
    let winners = 0;
    for (const p of publishedPubs) {
      if (p.vuesJ7 !== null) vuesTotal += p.vuesJ7;
      const r = calculateSaveRate(p.saves, p.vuesJ7);
      if (r !== null) rates.push(r);
      if (calculateVerdict(r) === "WINNER") winners++;
    }
    const avgSaveRate =
      rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    return {
      publishedCount: publishedPubs.length,
      draftCount,
      vuesTotal,
      avgSaveRate,
      winners,
    };
  }, [publications]);

  function reset() {
    setSearch("");
    setPlateforme(ALL);
    setMecanique(ALL);
    setFormat(ALL);
    setVerdictFilter(ALL);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function handleConfirmDelete() {
    if (!deletingPub) return;
    setDeleting(true);
    try {
      await deletePub({ id: deletingPub._id });
      toast.success(`${deletingPub.carouselId} (${deletingPub.plateforme}) supprimé`);
      setDeletingPub(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la suppression");
    } finally {
      setDeleting(false);
    }
  }

  if (publications === undefined) {
    return <LoadingState />;
  }

  if (publications.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Tracker
          </h1>
          {/*
            Compteur sous-header : on garde le contexte filtres+total
            ("X sur Y publications") et on ajoute le détail publiés/à venir
            de la sélection courante. "X publiés sur Y total" seul perdait
            l'information "combien matchent les filtres", qui est ce que
            l'utilisateur regarde quand il fouille.
          */}
          <p className="text-sm text-slate-500">
            {filtered.length} sur {publications.length} publication
            {publications.length > 1 ? "s" : ""}
            {filtered.length > 0 && (
              <span className="text-slate-400">
                {" "}
                · {filtered.filter(isPublished).length} publié
                {filtered.filter(isPublished).length > 1 ? "s" : ""} ·{" "}
                {filtered.filter((p) => !isPublished(p)).length} à venir
              </span>
            )}
          </p>
        </div>
        <Link
          href="/nouveau"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          <PlusIcon />
          Nouveau carrousel
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Publiés"
          value={String(stats.publishedCount)}
          secondary={
            stats.draftCount > 0 ? `+${stats.draftCount} à venir` : undefined
          }
        />
        <StatCard label="Vues totales (J+7)" value={formatNumber(stats.vuesTotal)} />
        <StatCard label="Save rate moyen" value={formatPercent(stats.avgSaveRate)} />
        <StatCard label="Winners" value={String(stats.winners)} highlight={stats.winners > 0} />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-600">Recherche</label>
          <Input
            placeholder="Hook text..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect
          label="Plateforme"
          value={plateforme}
          onChange={setPlateforme}
          options={["TikTok", "Instagram"]}
          allLabel="Toutes"
          width="w-[140px]"
        />
        <FilterSelect
          label="Mécanique"
          value={mecanique}
          onChange={setMecanique}
          options={[...MECANIQUES]}
          allLabel="Toutes"
          width="w-[160px]"
        />
        <FilterSelect
          label="Format"
          value={format}
          onChange={setFormat}
          options={[...FORMATS]}
          allLabel="Tous"
          width="w-[100px]"
        />
        <FilterSelect
          label="Verdict"
          value={verdictFilter}
          onChange={setVerdictFilter}
          options={["WINNER", "MOYEN", "FOLD", PENDING]}
          allLabel="Tous"
          width="w-[140px]"
        />
        <Button variant="outline" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16">
          <p className="text-sm text-slate-500">
            Aucune publication ne correspond à ces filtres.
          </p>
          <Button variant="outline" size="sm" onClick={reset}>
            Reset les filtres
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {drafts.length > 0 && (
            <PublicationsSection
              title="À venir"
              dotClass="bg-amber-500"
              rows={drafts}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              onView={setViewingPub}
              onEdit={setEditingPub}
              onDelete={setDeletingPub}
            />
          )}
          {published.length > 0 && (
            <PublicationsSection
              title="Publié"
              dotClass="bg-emerald-500"
              rows={published}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              onView={setViewingPub}
              onEdit={setEditingPub}
              onDelete={setDeletingPub}
            />
          )}
        </div>
      )}

      {editingPub && (
        <PublicationEditDialog
          key={editingPub._id}
          publication={editingPub}
          open={true}
          onOpenChange={(o) => !o && setEditingPub(null)}
        />
      )}

      {viewingPub && (
        <PublicationDetailDialog
          key={viewingPub._id}
          publication={viewingPub}
          open={true}
          onOpenChange={(o) => !o && setViewingPub(null)}
          onEdit={() => {
            setEditingPub(viewingPub);
            setViewingPub(null);
          }}
        />
      )}

      <Dialog
        open={!!deletingPub}
        onOpenChange={(o) => !o && !deleting && setDeletingPub(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette publication ?</DialogTitle>
            <DialogDescription>
              {deletingPub?.carouselId} ({deletingPub?.plateforme}) — cette
              action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingPub(null)}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PublicationsSection({
  title,
  dotClass,
  rows,
  sortKey,
  sortDir,
  onToggleSort,
  onView,
  onEdit,
  onDelete,
}: {
  title: string;
  dotClass: string;
  rows: Doc<"publications">[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (k: SortKey) => void;
  onView: (p: Doc<"publications">) => void;
  onEdit: (p: Doc<"publications">) => void;
  onDelete: (p: Doc<"publications">) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <span className={cn("inline-block size-2 rounded-full", dotClass)} />
        {title}
        <span className="font-normal text-slate-500">({rows.length})</span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                active={sortKey === "date"}
                dir={sortDir}
                onClick={() => onToggleSort("date")}
              >
                Date
              </SortableHead>
              <TableHead>Carrousel</TableHead>
              <TableHead>Hook</TableHead>
              <TableHead>Plateforme</TableHead>
              <TableHead>Compte</TableHead>
              <TableHead>Mécanique</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Angle</TableHead>
              <TableHead className="text-right">Vues J7</TableHead>
              <TableHead className="text-right">Saves</TableHead>
              <SortableHead
                active={sortKey === "saveRate"}
                dir={sortDir}
                onClick={() => onToggleSort("saveRate")}
                className="text-right"
              >
                Save rate
              </SortableHead>
              <TableHead>Verdict</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              // Feature 4 : un draft (= !isPublished) n'a pas de verdict, peu
              // importe ses métriques. Le saveRate brut peut rester affiché
              // (l'utilisateur peut saisir des chiffres en avance) mais le
              // badge verdict est forcé à "En attente".
              const saveRate = calculateSaveRate(p.saves, p.vuesJ7);
              const verdict = isPublished(p)
                ? calculateVerdict(saveRate)
                : null;
              return (
                <TableRow key={p._id}>
                  <TableCell className="whitespace-nowrap text-xs text-slate-600">
                    {formatDate(p.datePubli)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.carouselId}
                  </TableCell>
                  <TableCell
                    className="max-w-[280px] truncate text-sm"
                    title={p.hookText}
                  >
                    {p.hookText.length > 60
                      ? p.hookText.slice(0, 60) + "…"
                      : p.hookText}
                  </TableCell>
                  <TableCell>
                    <PlatformBadge plateforme={p.plateforme} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.compte}
                  </TableCell>
                  <TableCell className="text-xs">{p.mecanique}</TableCell>
                  <TableCell className="font-mono text-xs">{p.format}</TableCell>
                  <TableCell className="text-xs">{p.angleTonal}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {formatNumber(p.vuesJ7)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {formatNumber(p.saves)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums text-xs",
                      saveRate === null && "italic text-slate-400",
                    )}
                  >
                    {formatPercent(saveRate)}
                  </TableCell>
                  <TableCell>
                    <VerdictBadge verdict={verdict} />
                  </TableCell>
                  <TableCell className="w-8">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontalIcon />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onView(p)}>
                          {isPublished(p)
                            ? "Voir détail"
                            : "Voir détail / éditer"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onEdit(p)}
                          disabled={!isPublished(p)}
                          title={
                            !isPublished(p)
                              ? "Publiez d'abord pour saisir les stats"
                              : undefined
                          }
                        >
                          Mettre à jour stats
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-rose-600 focus:text-rose-700"
                          onClick={() => onDelete(p)}
                        >
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
  width: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
        <SelectTrigger className={width}>
          <SelectValue>{value === ALL ? allLabel : value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SortableHead({
  children,
  active,
  dir,
  onClick,
  className,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-slate-900"
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUpIcon className="size-3" />
          ) : (
            <ArrowDownIcon className="size-3" />
          )
        ) : (
          <ArrowUpDownIcon className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

function StatCard({
  label,
  value,
  highlight,
  secondary,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  secondary?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline gap-2">
          <div
            className={cn(
              "text-2xl font-bold tabular-nums",
              highlight ? "text-emerald-600" : "text-slate-900",
            )}
          >
            {value}
          </div>
          {secondary && (
            <div className="text-xs font-medium text-slate-500">
              {secondary}
            </div>
          )}
        </div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-300 bg-white py-24 text-center">
      <FileTextIcon className="size-10 text-slate-400" />
      <div>
        <h2 className="text-lg font-medium text-slate-900">
          Aucun carrousel pour l&apos;instant
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Crée ton premier carrousel pour commencer le tracking.
        </p>
      </div>
      <Link href="/nouveau" className={cn(buttonVariants({ size: "sm" }))}>
        <PlusIcon />
        Créer le premier carrousel
      </Link>
    </div>
  );
}
