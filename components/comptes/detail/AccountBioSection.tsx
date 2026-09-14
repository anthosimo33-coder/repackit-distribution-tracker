"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2Icon, ClockIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Compte } from "@/components/comptes/CompteDialog";
import { bioStateLabel } from "@/lib/account-bio";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";

const dtf = (locale: string) =>
  new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * Admin — section « Bio à mettre » d'une fiche compte (compte lié à un créateur).
 * L'admin saisit la bio que le créateur doit recopier ; toute modification
 * repasse le compte en « à appliquer » (garanti serveur). L'état d'application
 * par le créateur est affiché ici (Appliquée + date / En attente).
 */
export function AccountBioSection({ compte }: { compte: Compte }) {
  const showError = useConvexError();
  const tr = useTranslations("admin.accounts.AccountBioSection");
  const tState = useTranslations("admin.accounts.bioState");
  const loc = useIntlLocale();
  const setBio = useProjectMutation(api.comptes.setAccountBio);
  const [draft, setDraft] = useState(compte.bioToApply ?? "");
  const [saving, setSaving] = useState(false);

  const state = bioStateLabel(compte);
  const dirty = draft !== (compte.bioToApply ?? "");

  async function handleSave() {
    setSaving(true);
    try {
      await setBio({ id: compte._id, bio: draft });
      toast.success(tr("bioEnregistree"));
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{tr("bioAMettre")}</CardTitle>
        {state.tone !== "none" && (
          <span
            data-testid="admin-bio-status"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-semibold",
              state.tone === "applied"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700",
            )}
          >
            {state.tone === "applied" ? (
              <CheckCircle2Icon className="size-3.5" />
            ) : (
              <ClockIcon className="size-3.5" />
            )}
            {state.tone === "applied"
              ? compte.bioAppliedAt
                ? tr("appliqueeLe", { value: dtf(loc).format(compte.bioAppliedAt) })
                : tr("appliquee")
              : tr("enAttenteDApplication")}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="account-bio">
            {tr("texteDeBioARecopier")}
          </Label>
          <Textarea
            id="account-bio"
            data-testid="admin-bio-textarea"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tr("bioAAfficherSurLe")}
          />
          <p className="text-xs text-slate-500">
            {tr("touteModificationRenotifieLeCreateur")}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {compte.bioUpdatedAt
              ? tr("modifieeLe", { value: dtf(loc).format(compte.bioUpdatedAt) })
              : tr("aucuneBioDefiniePourL")}
          </span>
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("enregistrerLaBio")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
