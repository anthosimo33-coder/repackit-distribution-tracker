"use client";

import { useState } from "react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon, TimerIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

/**
 * Durée de warmup DU PROJET, par plateforme.
 *
 * POURQUOI CET ÉCRAN EXISTE. Le 2026-06-23, changer la durée « de l'app » a
 * modifié la règle de Snytch en silence et fait attendre ses créatrices quatre
 * jours de trop par compte pendant deux mois. La durée est une règle PRODUIT,
 * elle doit se régler sans PR — et par projet.
 *
 * UN CHAMP VIDE N'EST PAS UN ZÉRO : il veut dire « ce projet ne définit pas
 * cette plateforme », et la durée retombe alors sur le défaut. C'est la
 * différence entre « Snytch chauffe 3 jours sur TikTok » et « Snytch ne fait
 * pas de YouTube » — deux faits qu'un nombre seul ne saurait pas distinguer.
 * L'écran affiche le défaut appliqué en dessous, pour qu'un champ vide ne soit
 * jamais une inconnue.
 *
 * NE TOUCHE PAS AUX CHAUFFES EN COURS : la durée est figée sur chaque compte à
 * son démarrage. C'est écrit à l'écran, pour qu'on ne l'attende pas en vain.
 */
const PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

export function WarmupSettingsCard() {
  const settings = useProjectQuery(api.projects.getWarmupSettings, {});
  const save = useProjectMutation(api.projects.setWarmupSettings);
  const [draft, setDraft] = useState<Record<PlatformKey, string> | null>(null);
  const [saving, setSaving] = useState(false);

  if (settings === undefined) return <Skeleton className="h-48 w-full" />;

  const current: Record<PlatformKey, string> =
    draft ??
    ({
      tiktok: settings.defined.tiktok?.toString() ?? "",
      instagram: settings.defined.instagram?.toString() ?? "",
      youtube: settings.defined.youtube?.toString() ?? "",
    } as Record<PlatformKey, string>);

  const parse = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isInteger(n) ? n : NaN;
  };
  const invalid = PLATFORMS.some(({ key }) => Number.isNaN(parse(current[key])));

  async function handleSave() {
    setSaving(true);
    try {
      await save({
        tiktok: parse(current.tiktok),
        instagram: parse(current.instagram),
        youtube: parse(current.youtube),
      });
      setDraft(null);
      toast.success("Durées de warmup enregistrées");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <TimerIcon className="size-4" />
        </span>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900">
            Durée de warmup, par plateforme
          </h2>
          <p className="text-xs text-slate-500">
            Le nombre de checks à poser avant qu&apos;un compte de ce projet
            sorte de chauffe. <strong>Laisse vide</strong> une plateforme que ce
            projet n&apos;utilise pas : elle prendra le défaut.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map(({ key, label }) => {
          const raw = current[key];
          const bad = Number.isNaN(parse(raw));
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`warmup-${key}`}>{label}</Label>
              <Input
                id={`warmup-${key}`}
                inputMode="numeric"
                placeholder={`défaut : ${settings.effective[key]}`}
                value={raw}
                aria-invalid={bad}
                onChange={(e) =>
                  setDraft({ ...current, [key]: e.target.value })
                }
              />
              <p className="text-xs text-slate-400">
                {raw.trim() === ""
                  ? `non défini — ${settings.effective[key]} jours appliqués`
                  : `${raw.trim()} jours`}
              </p>
            </div>
          );
        })}
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
        Ce réglage ne change <strong>que les chauffes à venir</strong>. Les
        comptes déjà en warmup gardent la durée figée à leur démarrage.
      </p>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || invalid || draft === null}>
          {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
