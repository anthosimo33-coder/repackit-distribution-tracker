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
import { convexErrorMessage } from "@/lib/convex-error";
import type { Compte } from "@/components/comptes/CompteDialog";
import { bioStateLabel } from "@/lib/account-bio";

const dtf = new Intl.DateTimeFormat("fr-FR", {
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
  const setBio = useProjectMutation(api.comptes.setAccountBio);
  const [draft, setDraft] = useState(compte.bioToApply ?? "");
  const [saving, setSaving] = useState(false);

  const state = bioStateLabel(compte);
  const dirty = draft !== (compte.bioToApply ?? "");

  async function handleSave() {
    setSaving(true);
    try {
      await setBio({ id: compte._id, bio: draft });
      toast.success("Bio enregistrée");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Erreur"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Bio à mettre</CardTitle>
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
                ? `Appliquée le ${dtf.format(compte.bioAppliedAt)}`
                : "Appliquée"
              : "En attente d'application"}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="account-bio">
            Texte de bio à recopier par le créateur
          </Label>
          <Textarea
            id="account-bio"
            data-testid="admin-bio-textarea"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Bio à afficher sur le compte (lien, accroche, hashtags…)"
          />
          <p className="text-xs text-slate-500">
            Toute modification renotifie le créateur : le compte repasse en
            « à appliquer » jusqu&apos;à ce qu&apos;il confirme.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {compte.bioUpdatedAt
              ? `Modifiée le ${dtf.format(compte.bioUpdatedAt)}`
              : "Aucune bio définie pour l'instant."}
          </span>
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer la bio
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
