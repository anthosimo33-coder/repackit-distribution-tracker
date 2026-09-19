"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LayoutListIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * SCRIPT EN DEUX ZONES — réglage du projet (cf convex/scriptZonesSetting).
 *
 * Bascule SANS confirmation, à la différence de la validation des comptes : ce
 * réglage ne bloque ni ne débloque rien, il change l'affichage — y compris
 * celui des missions déjà attribuées, dont le texte figé n'est jamais réécrit.
 *
 * L'état affiché vient de `useProject()` (projectForClient, résolu serveur) :
 * c'est la valeur que lisent l'éditeur de brique et l'aperçu, donc l'interrupteur
 * ne peut pas dire autre chose que ce que l'écran montre.
 */
export function ScriptZonesSettingsCard() {
  const showError = useConvexError();
  const tr = useTranslations("admin.scripts.ScriptZonesSettingsCard");
  const enabled = useProject().project.scriptZonesEnabled;
  const save = useProjectMutation(api.projects.setScriptZonesEnabled);
  const [saving, setSaving] = useState(false);

  async function apply(next: boolean) {
    setSaving(true);
    try {
      await save({ enabled: next });
      toast.success(tr("reglageEnregistre"));
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <LayoutListIcon className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="script-zones" className="text-sm font-semibold text-slate-900">
              {tr("titre")}
            </Label>
            <p className="text-xs text-slate-500">{tr("aide")}</p>
          </div>
        </div>
        <Switch
          id="script-zones"
          checked={enabled}
          disabled={saving}
          onCheckedChange={(v) => void apply(v)}
        />
      </div>
      <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
        {tr("modeParDefaut")}
      </p>
    </div>
  );
}
