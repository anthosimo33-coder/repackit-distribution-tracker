"use client";

import { useState } from "react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

const NONE = "__none__";

function defaultDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  // en-CA = YYYY-MM-DD en heure LOCALE (évite l'off-by-one d'un toISOString UTC).
  return d.toLocaleDateString("en-CA");
}

/**
 * P7 — assignation en masse d'un format : N créateurs × P posts = N×P
 * assignments (1 row = 1 livrable). Deadline + compte cible optionnel.
 */
export function AssignFormatDialog({
  formatId,
  formatName,
  open,
  onOpenChange,
}: {
  formatId: Id<"formats">;
  formatName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const creators = useProjectQuery(
    api.assignments.listAssignableCreators,
    open ? {} : "skip",
  );
  const comptes = useProjectQuery(api.comptes.listComptes, open ? {} : "skip");
  const assign = useProjectMutation(api.assignments.assignFormat);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posts, setPosts] = useState("1");
  const [due, setDue] = useState(defaultDue());
  const [accountId, setAccountId] = useState<string>(NONE);
  const [submitting, setSubmitting] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const postsPerCreator = Number(posts);
    if (selected.size === 0) {
      toast.error("Sélectionne au moins un créateur.");
      return;
    }
    if (!Number.isInteger(postsPerCreator) || postsPerCreator < 1) {
      toast.error("Nombre de posts invalide.");
      return;
    }
    const dueMs = new Date(`${due}T23:59:59`).getTime();
    if (!Number.isFinite(dueMs)) {
      toast.error("Échéance invalide.");
      return;
    }
    setSubmitting(true);
    try {
      const { created } = await assign({
        formatId,
        creatorIds: [...selected] as Id<"creators">[],
        postsPerCreator,
        dueDate: dueMs,
        accountId: accountId === NONE ? undefined : (accountId as Id<"comptes">),
      });
      toast.success(`${created} assignment${created > 1 ? "s" : ""} créé${created > 1 ? "s" : ""}`);
      setSelected(new Set());
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  const total =
    selected.size * (Number.isInteger(Number(posts)) ? Number(posts) : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assigner « {formatName} »</DialogTitle>
          <DialogDescription>
            1 post = 1 livrable. {total > 0 ? `${total} assignment(s) seront créés.` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Créateurs</Label>
            {creators === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : creators.length === 0 ? (
              <p className="text-sm text-slate-400">
                Aucun créateur disponible (onboardé et actif).
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                {creators.map((c) => (
                  <li key={c._id} className="flex items-center gap-2">
                    <Checkbox
                      id={`cr-${c._id}`}
                      checked={selected.has(c._id)}
                      onCheckedChange={() => toggle(c._id)}
                    />
                    <label
                      htmlFor={`cr-${c._id}`}
                      className="flex-1 cursor-pointer text-sm text-slate-700"
                    >
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="posts">Posts par créateur</Label>
              <Input
                id="posts"
                type="number"
                min={1}
                max={50}
                value={posts}
                onChange={(e) => setPosts(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">Échéance</Label>
              <Input
                id="due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Compte cible (optionnel)</Label>
            <Select value={accountId} onValueChange={(v) => v && setAccountId(v)}>
              <SelectTrigger aria-label="Compte cible">
                <SelectValue>
                  {accountId === NONE
                    ? "Aucun"
                    : (comptes?.find((c) => c._id === accountId)?.handle ??
                      "Compte")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Aucun</SelectItem>
                {(comptes ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.handle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Assigner
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
