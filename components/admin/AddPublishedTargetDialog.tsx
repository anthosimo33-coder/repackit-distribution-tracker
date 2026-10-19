"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Plateforme } from "@/convex/platforms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountCheckLine, todayLocal } from "@/components/admin/AdminPublishForm";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * Vidéo DÉJÀ SORTIE : ajouter un compte qu'on n'avait pas coché, AVEC le lien
 * du post qu'elle y a publié (Kelly : mission TikTok, reel posté aussi sur
 * Instagram). Le serveur (`addPublishedTarget`) refait tous les contrôles et
 * crée la publication — le post est suivi et payé comme les autres plateformes
 * de la vidéo.
 *
 * Même saisie que la publication en secours (AdminPublishForm) : contrôle
 * lien ↔ compte en avertissement, date réelle envoyée seulement si elle est
 * antérieure à aujourd'hui.
 */
export function AddPublishedTargetDialog({
  assignmentId,
  account,
  onClose,
}: {
  assignmentId: Id<"assignments">;
  /** Compte choisi dans le menu ; `null` = fermé. */
  account: { _id: Id<"comptes">; handle: string; platform: Plateforme } | null;
  onClose: () => void;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.assignments.AddPublishedTargetDialog");
  const add = useProjectMutation(api.assignments.addPublishedTarget);
  const today = todayLocal();
  const [url, setUrl] = useState("");
  const [dateStr, setDateStr] = useState(today);
  const [busy, setBusy] = useState(false);

  function close() {
    setUrl("");
    setDateStr(today);
    onClose();
  }

  async function submit() {
    if (!account) return;
    const clean = url.trim();
    if (clean.length === 0) {
      toast.error(tr("colleLeLien"));
      return;
    }
    // Le jour même = pas d'override : le serveur pose `now`.
    const publishedAt =
      dateStr && dateStr < today
        ? new Date(`${dateStr}T12:00:00`).getTime()
        : undefined;
    setBusy(true);
    try {
      await add({
        id: assignmentId,
        accountId: account._id,
        url: clean,
        ...(publishedAt !== undefined ? { publishedAt } : {}),
      });
      toast.success(
        tr("postAjoute", { platform: account.platform, handle: account.handle }),
      );
      close();
    } catch (e) {
      toast.error(showError(e, tr("echecDeLAjout")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={account !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent data-testid="add-published-target-dialog">
        {account && (
          <>
            <DialogHeader>
              <DialogTitle>
                {tr("titre", { platform: account.platform })}
              </DialogTitle>
              <DialogDescription>{tr("description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor={`add-published-url-${assignmentId}`} className="flex-wrap gap-x-1 text-xs">
                <span className="shrink-0">{account.platform}</span>
                <span className="min-w-0 font-mono break-all text-slate-400">
                  {account.handle}
                </span>
              </Label>
              <Input
                id={`add-published-url-${assignmentId}`}
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <AccountCheckLine
                url={url}
                platform={account.platform}
                expected={account.handle}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`add-published-date-${assignmentId}`} className="text-xs">
                {tr("dateDePublication")}
              </Label>
              <Input
                id={`add-published-date-${assignmentId}`}
                type="date"
                value={dateStr}
                max={today}
                onChange={(e) => setDateStr(e.target.value)}
              />
              <p className="text-xs text-slate-500">{tr("aideDate")}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>
                {tr("annuler")}
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={busy || url.trim().length === 0}
                data-testid="add-published-target-submit"
              >
                {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                {tr("ajouter")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
