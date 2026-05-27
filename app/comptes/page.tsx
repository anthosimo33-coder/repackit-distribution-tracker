"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MoreHorizontalIcon,
  Loader2Icon,
  PlusIcon,
  UsersIcon,
  TargetIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getEffectiveStatus,
  getStatusBadge,
  type CompteStatus,
} from "@/lib/compte-status";
import { PersonnesManagerSection } from "@/components/comptes/PersonnesManagerSection";
import { IcpsManagerSection } from "@/components/icps/IcpsManagerSection";
import { WarmupGuideButton } from "@/components/comptes/WarmupGuideButton";
import CompteDialog, { type Compte } from "@/components/comptes/CompteDialog";

type StatusFilter = "all" | CompteStatus;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "actif", label: "Actifs" },
  { value: "warmup", label: "Warmup" },
  { value: "shadowban", label: "Shadowban" },
  { value: "archived", label: "Archivés" },
];

export default function ComptesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ComptesPageInner />
    </Suspense>
  );
}

function ComptesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const comptes = useQuery(api.comptes.listComptes, {});
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Compte | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Compte | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const viewParam = searchParams.get("view");
  const isPersonnesView = viewParam === "personnes";
  const isIcpsView = viewParam === "icps";

  function navigate(view: "personnes" | "icps" | null) {
    const params = new URLSearchParams(searchParams);
    if (view) params.set("view", view);
    else params.delete("view");
    const qs = params.toString();
    router.replace(qs ? `/comptes?${qs}` : "/comptes");
  }

  // Compteurs par statut (sur l'ensemble, hors filtre) pour le sous-titre.
  const counts = useMemo(() => {
    const acc = { actif: 0, warmup: 0, shadowban: 0, archived: 0 };
    for (const c of comptes ?? []) acc[getEffectiveStatus(c)]++;
    return acc;
  }, [comptes]);

  // Lignes affichées : filtre statut + archivés repoussés en bas (tri stable
  // → l'ordre alphabétique du serveur est préservé à l'intérieur d'un rang).
  const rows = useMemo(() => {
    const list = (comptes ?? []).filter(
      (c) => statusFilter === "all" || getEffectiveStatus(c) === statusFilter,
    );
    return [...list].sort(
      (a, b) =>
        (getEffectiveStatus(a) === "archived" ? 1 : 0) -
        (getEffectiveStatus(b) === "archived" ? 1 : 0),
    );
  }, [comptes, statusFilter]);

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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Comptes
          </h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Handle</TableHead>
                  <TableHead>Plateforme</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Gestionnaire</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const badge = getStatusBadge(c);
                  return (
                    <TableRow
                      key={c._id}
                      className={cn(
                        getEffectiveStatus(c) === "archived" && "opacity-50",
                      )}
                    >
                      <TableCell className="font-mono font-medium text-slate-900">
                        <Link
                          href={`/comptes/${c._id}`}
                          className="transition-colors hover:text-primary hover:underline"
                        >
                          {c.handle}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <PlatformBadge plateforme={c.plateforme} />
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold",
                            badge.className,
                          )}
                        >
                          {badge.label}
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
                      <TableCell className="max-w-xs truncate text-sm text-slate-500">
                        {c.notes || "—"}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          compte={c}
                          onEdit={() => setEditTarget(c)}
                          onDelete={() => setDeleteTarget(c)}
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
      <DeleteDialog
        compte={deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      />
    </div>
  );
}

function RowActions({
  compte,
  onEdit,
  onDelete,
}: {
  compte: Compte;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const updateCompte = useMutation(api.comptes.updateCompte);
  const isArchived = getEffectiveStatus(compte) === "archived";
  const toggleArchive = async () => {
    try {
      await updateCompte({
        id: compte._id,
        status: isArchived ? "actif" : "archived",
      });
      toast.success(
        isArchived ? `${compte.handle} réactivé` : `${compte.handle} archivé`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="size-8 p-0">
            <MoreHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>Modifier</DropdownMenuItem>
        <DropdownMenuItem onClick={toggleArchive}>
          {isArchived ? "Réactiver" : "Archiver"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="text-rose-600 focus:text-rose-700"
        >
          Supprimer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteDialog({
  compte,
  onOpenChange,
}: {
  compte: Compte | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const deleteCompte = useMutation(api.comptes.deleteCompte);

  async function confirm() {
    if (!compte) return;
    setSubmitting(true);
    try {
      await deleteCompte({ id: compte._id });
      toast.success(`${compte.handle} supprimé`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={compte !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer {compte?.handle}</DialogTitle>
          <DialogDescription>
            Cette action est irréversible. Si le compte a déjà été utilisé pour
            des publications, la suppression sera refusée — utilise plutôt
            l&apos;action « Archiver ».
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={submitting}
          >
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
