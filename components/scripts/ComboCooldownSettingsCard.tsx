"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon, RepeatIcon } from "lucide-react";
import { toast } from "sonner";
import {
  COMBO_COOLDOWN_DAYS_MAX,
  COMBO_COOLDOWN_DAYS_MIN,
} from "@/convex/comboCooldown";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * COOLDOWN DE COMBO du projet — le seul endroit où cette durée se règle.
 *
 * Trois états à ne pas confondre, et l'écran les nomme tous les trois :
 *   - champ VIDE   = ce projet ne définit rien → le défaut s'applique ;
 *   - `0`          = cooldown DÉSACTIVÉ, décision explicite ;
 *   - N > 0        = un même script ne repart pas ailleurs à moins de N jours.
 *
 * Un `|| défaut` en place de la lecture confondrait les deux premiers, et
 * saisir 0 serait sans effet visible. C'est pourquoi la lecture passe par
 * `comboCooldownDaysOf` côté serveur et par `defined ?? null` ici.
 *
 * Ce réglage ne relâche JAMAIS l'unicité à vie (un même combo ne revient pas
 * chez la même créatrice sur la même plateforme) : les deux protections se
 * cumulent, et seule celle-ci est réglable. C'est dit à l'écran.
 */
export function ComboCooldownSettingsCard() {
  const showError = useConvexError();
  const tr = useTranslations("admin.scripts.ComboCooldownSettingsCard");
  const settings = useProjectQuery(api.projects.getComboCooldownSettings, {});
  const save = useProjectMutation(api.projects.setComboCooldownDays);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (settings === undefined) return <Skeleton className="h-48 w-full" />;

  const current = draft ?? (settings.defined?.toString() ?? "");

  const parse = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isInteger(n) ? n : NaN;
  };
  const parsed = parse(current);
  const invalid =
    Number.isNaN(parsed) ||
    (parsed !== null &&
      (parsed < COMBO_COOLDOWN_DAYS_MIN || parsed > COMBO_COOLDOWN_DAYS_MAX));

  async function handleSave() {
    setSaving(true);
    try {
      await save({ days: parse(current) });
      setDraft(null);
      toast.success(tr("cooldownEnregistre"));
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      data-testid="combo-cooldown-settings"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <RepeatIcon className="size-4" />
        </span>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900">
            {tr("cooldownDUnScriptEn")}
          </h2>
          <p className="text-xs text-slate-500">
            {tr("unScriptDejaProgrammeOu")}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="combo-cooldown-days">{tr("jours")}</Label>
        <Input
          id="combo-cooldown-days"
          inputMode="numeric"
          placeholder={tr("defaut", { fallback: settings.fallback })}
          value={current}
          aria-invalid={invalid}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="text-xs text-slate-400" data-testid="combo-cooldown-effective">
          {current.trim() === ""
            ? tr("nonDefiniJourApplique", { fallback: settings.fallback })
            : parsed === 0
              ? tr("n0CooldownDesactiveUnMeme")
              : tr("jourApplique", { parsed: parsed ?? 0, value: parsed ?? 0 })}
        </p>
        {invalid && (
          <p className="text-xs text-rose-600">
            {tr("unEntierEntreEtOu", { COMBO_COOLDOWN_DAYS_MIN: COMBO_COOLDOWN_DAYS_MIN, COMBO_COOLDOWN_DAYS_MAX: COMBO_COOLDOWN_DAYS_MAX })}
          </p>
        )}
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
        {tr("ceReglageNeChange")}{" "}<strong>{tr("queLesTiragesAVenir")}</strong>{" "}{tr("unComboDejaAttribueEst")}<strong>{tr("uniciteAVie")}</strong>{" "}{tr("uneCreatriceNeRecoitJamais")}
      </p>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || invalid || draft === null}
        >
          {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {tr("enregistrer")}
        </Button>
      </div>
    </div>
  );
}
