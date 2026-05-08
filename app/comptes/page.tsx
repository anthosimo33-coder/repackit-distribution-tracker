"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontalIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Compte = Doc<"comptes">;
// Batch 1 Shorts — YouTube ajouté pour les Shorts (cf lib/media-type.ts).
// Carrousels restent TikTok+Instagram only ; côté comptes la table accepte
// les 3 plateformes, et la cohérence format/plateforme est validée
// uniquement au moment de créer une publication (createPublication).
type Plateforme = "TikTok" | "Instagram" | "YouTube";

export default function ComptesPage() {
  const comptes = useQuery(api.comptes.listComptes, {});
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Compte | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Compte | null>(null);

  const actifs = comptes?.filter((c) => c.actif) ?? [];
  const archives = comptes?.filter((c) => !c.actif) ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Comptes
          </h1>
          <p className="text-sm text-slate-500">
            {comptes === undefined
              ? "Chargement…"
              : `${actifs.length} actif${actifs.length > 1 ? "s" : ""}${archives.length > 0 ? ` · ${archives.length} archivé${archives.length > 1 ? "s" : ""}` : ""}`}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          Ajouter un compte
        </Button>
      </header>

      {comptes === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : comptes.length === 0 ? (
        <EmptyState onAdd={() => setAddOpen(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Handle</TableHead>
                  <TableHead>Plateforme</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...actifs, ...archives].map((c) => (
                  <TableRow
                    key={c._id}
                    className={cn(!c.actif && "opacity-50")}
                  >
                    <TableCell className="font-mono font-medium text-slate-900">
                      {c.handle}
                    </TableCell>
                    <TableCell>
                      <PlatformBadge plateforme={c.plateforme} />
                    </TableCell>
                    <TableCell>
                      {c.actif ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-semibold text-emerald-700">
                          Actif
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-0.5 text-xs font-semibold text-slate-500">
                          Archivé
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-slate-500">
                      {c.notes || "—"}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        compte={c}
                        onEdit={() => setEditTarget(c)}
                        onDelete={() => setDeleteTarget(c)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CompteDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        compte={null}
      />
      <CompteDialog
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        compte={editTarget}
      />
      <DeleteDialog
        compte={deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      />
    </div>
  );
}

// PlatformBadge is imported from @/components/VerdictBadge

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
  const toggleActif = async () => {
    try {
      await updateCompte({ id: compte._id, actif: !compte.actif });
      toast.success(
        compte.actif
          ? `${compte.handle} archivé`
          : `${compte.handle} réactivé`,
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
        <DropdownMenuItem onClick={toggleActif}>
          {compte.actif ? "Archiver" : "Réactiver"}
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

function CompteDialog({
  open,
  onOpenChange,
  compte,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  compte: Compte | null;
}) {
  const isEdit = compte !== null;
  const [handle, setHandle] = useState(compte?.handle ?? "");
  const [plateforme, setPlateforme] = useState<string>(
    compte?.plateforme ?? "TikTok",
  );
  const [notes, setNotes] = useState(compte?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const createCompte = useMutation(api.comptes.createCompte);
  const updateCompte = useMutation(api.comptes.updateCompte);

  // Reset state when dialog opens (especially for edit mode targeting a different compte)
  useEffect(() => {
    if (open) {
      setHandle(compte?.handle ?? "");
      setPlateforme(compte?.plateforme ?? "TikTok");
      setNotes(compte?.notes ?? "");
    }
  }, [open, compte]);

  const normalizeHandle = (h: string) => {
    const trimmed = h.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  };

  async function submit() {
    const finalHandle = normalizeHandle(handle);
    if (!finalHandle || finalHandle === "@") {
      toast.error("Handle requis");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateCompte({
          id: compte._id,
          handle: finalHandle,
          notes,
        });
        toast.success(`${finalHandle} mis à jour`);
      } else {
        await createCompte({
          handle: finalHandle,
          plateforme: plateforme as Plateforme,
          notes,
        });
        toast.success(`${finalHandle} ajouté sur ${plateforme}`);
      }
      onOpenChange(false);
      setHandle("");
      setNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier le compte" : "Nouveau compte"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifie le handle ou les notes. La plateforme ne peut pas changer."
              : "Ajoute un compte TikTok ou Instagram à utiliser pour publier."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="compte-handle">Handle</Label>
            <Input
              id="compte-handle"
              placeholder="@compte_pro"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Le @ est ajouté automatiquement si tu l&apos;oublies.
            </p>
          </div>
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Plateforme</Label>
              <Select
                value={plateforme}
                onValueChange={(v) => v !== null && setPlateforme(v)}
              >
                <SelectTrigger>
                  <SelectValue>{plateforme}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TikTok">TikTok</SelectItem>
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  <SelectItem value="YouTube">YouTube</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="compte-notes">Notes</Label>
            <Textarea
              id="compte-notes"
              rows={3}
              placeholder="Optionnel"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {isEdit ? "Enregistrer" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
