"use client";

import { useState } from "react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * VALIDATION DES COMPTES — le régime de publication du projet.
 *
 * Allumé (strict) : un compte ne reçoit de mission et ne publie qu'une fois
 * validé « actif » par l'admin. Éteint (souple) : un warmup terminé suffit.
 *
 * JAMAIS DE BASCULE EN UN CLIC. Changer de régime a un effet IMMÉDIAT sur des
 * comptes et des missions qui existent déjà : en strict, les missions attribuées
 * sur un compte non validé seront refusées au moment de publier ; en souple, des
 * comptes que personne n'a regardés publient dès maintenant. Le décompte vient
 * du serveur (getAccountValidationSettings) et s'affiche AVANT de confirmer.
 */
export function AccountValidationSettingsCard() {
  const showError = useConvexError();
  const tr = useTranslations("admin.accounts.AccountValidationSettingsCard");
  const settings = useProjectQuery(api.projects.getAccountValidationSettings, {});
  const save = useProjectMutation(api.projects.setAccountValidation);
  const [pending, setPending] = useState<"strict" | "lenient" | null>(null);
  const [saving, setSaving] = useState(false);

  if (settings === undefined) return <Skeleton className="h-32 w-full" />;

  const { accounts, pendingAssignments } = settings.affected;

  async function confirm() {
    if (pending === null) return;
    setSaving(true);
    try {
      await save({ mode: pending });
      toast.success(tr("regleEnregistree"));
      setPending(null);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSaving(false);
    }
  }

  const impact =
    accounts === 0
      ? tr("impactAucun")
      : pending === "strict"
        ? tr("impactStrict", { accounts, pendingAssignments })
        : tr("impactSouple", { accounts });

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <ShieldCheckIcon className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="account-validation" className="text-sm font-semibold text-slate-900">
              {tr("titre")}
            </Label>
            <p className="text-xs text-slate-500">
              {settings.mode === "strict" ? tr("aideStrict") : tr("aideSouple")}
            </p>
          </div>
        </div>
        <Switch
          id="account-validation"
          checked={settings.mode === "strict"}
          disabled={saving}
          onCheckedChange={(v) => setPending(v ? "strict" : "lenient")}
        />
      </div>

      {accounts > 0 && (
        <p className="text-xs text-slate-500">
          {tr("enAttente", { accounts })}
        </p>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(o) => !o && !saving && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "strict" ? tr("confirmerStrict") : tr("confirmerSouple")}
            </AlertDialogTitle>
            <AlertDialogDescription>{impact}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tr("annuler")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirm()} disabled={saving}>
              {tr("confirmer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
