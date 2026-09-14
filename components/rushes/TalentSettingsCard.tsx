"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { useTranslations } from "next-intl";

/**
 * ESPACE TALENT — les deux réglages qui le mettent en service : le dépôt de
 * fichiers, et le brief permanent que tous les talents du projet liront.
 *
 * ⚠️ AUCUNE ÉDITION DE BRIEF ICI, ET CE N'EST PAS UN OUBLI.
 *
 * Un brief modifié en place réécrit RÉTROACTIVEMENT ce que la personne a lu. Le
 * jour où un rush est refusé pour non-respect du brief, c'est la version qu'elle
 * avait sous les yeux au tournage qui fait foi — pas celle qu'on a réécrite
 * depuis. Un bouton « Modifier » rendrait cette version-là irrécupérable, et le
 * refus indéfendable.
 *
 * Réécrire un brief se fait donc en en CRÉANT un nouveau et en le désignant :
 * deux gestes au lieu d'un, et l'ancien reste intact, consultable, opposable.
 *
 * Si quelqu'un lit ce fichier en se disant qu'il manque un bouton « Modifier » :
 * c'est cette phrase-là qu'il faut relire avant de l'ajouter.
 */

export function TalentSettingsCard() {
  const tr = useTranslations("admin.validation.TalentSettingsCard");
  const reglages = useProjectQuery(api.projects.getTalentSettings, {});
  const formats = useProjectQuery(api.formats.listFormats, {});
  const setSettings = useProjectMutation(api.projects.setTalentSettings);
  const createFormat = useProjectMutation(api.formats.createFormat);

  const [creation, setCreation] = useState(false);
  const [nom, setNom] = useState("");
  const [brief, setBrief] = useState("");
  const [exemples, setExemples] = useState("");
  const [busy, setBusy] = useState(false);

  if (reglages === undefined || formats === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }

  const actifs = (formats ?? []).filter((f) => f.status !== "archived");
  const briefActuel = reglages.talentBriefFormatId;
  const depotActif = reglages.fileDropEnabled;

  async function appliquer(patch: {
    fileDropEnabled?: boolean;
    talentBriefFormatId?: Id<"formats"> | null;
  }) {
    setBusy(true);
    try {
      await setSettings(patch);
      toast.success(tr("reglagesEnregistres"));
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("echecDeLEnregistrement")));
    } finally {
      setBusy(false);
    }
  }

  /** Crée un format et le désigne DANS LA FOULÉE — c'est le geste attendu. */
  async function creerEtDesigner() {
    if (nom.trim().length === 0 || brief.trim().length === 0) return;
    setBusy(true);
    try {
      const formatId = await createFormat({
        name: nom.trim(),
        type: "custom",
        brief: brief.trim(),
        exampleVideos: exemples
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((url) => ({
            kind: "url" as const,
            url,
            platform: url.includes("youtu")
              ? ("youtube" as const)
              : url.includes("instagram")
                ? ("instagram" as const)
                : ("tiktok" as const),
            // Aucun titre : il s'affichait sous chaque lecteur côté talent, où
            // « Exemple » n'apprend rien que la vignette ne dise déjà. Cf
            // lib/talent-brief.ts pour les briefs qui le portent déjà en base.
            title: "",
          })),
      });
      await setSettings({ talentBriefFormatId: formatId });
      toast.success(tr("briefCreeEtMisEn"));
      setCreation(false);
      setNom("");
      setBrief("");
      setExemples("");
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("echecDeLaCreationDu")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("espaceTalent")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="depot">{tr("depotDeFichiers")}</Label>
            <p className="text-xs text-slate-500">
              {tr("sansLuiLesTalentsDe")}
            </p>
          </div>
          <Switch
            id="depot"
            checked={depotActif}
            disabled={busy}
            onCheckedChange={(v) => void appliquer({ fileDropEnabled: v })}
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="brief">{tr("briefPermanent")}</Label>
          <p className="text-xs text-slate-500">
            {tr("luParTousLesTalents")}
          </p>
          {actifs.length > 0 && (
            <Select
              value={briefActuel ?? "none"}
              onValueChange={(v) =>
                v &&
                void appliquer({
                  talentBriefFormatId:
                    v === "none" ? null : (v as Id<"formats">),
                })
              }
            >
              <SelectTrigger id="brief" aria-label={tr("briefPermanent")}>
                {/*
                  ENFANTS OBLIGATOIRES. `SelectPrimitive.Value` sans enfants rend
                  la VALEUR BRUTE — ici un id Convex. C'est la convention du
                  dépôt (tous les autres sélecteurs passent leur libellé) et le
                  seul endroit où l'oubli ne se voit pas en écrivant le code.
                */}
                <SelectValue placeholder={tr("aucunBrief")}>
                  {briefActuel === null
                    ? tr("aucunBrief")
                    : (actifs.find((f) => f._id === briefActuel)?.name ??
                      tr("briefIntrouvableSupprime"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tr("aucunBrief")}</SelectItem>
                {actifs.map((f) => (
                  <SelectItem key={f._id} value={f._id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {!creation ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreation(true)}
              className="mt-2"
            >
              {actifs.length === 0 ? tr("ecrireLeBrief") : tr("ecrireUnNouveauBrief")}
            </Button>
          ) : (
            <div className="mt-2 space-y-3 rounded-lg border border-slate-200 p-3">
              {/*
                Pas de champ d'édition : réécrire un brief, c'est en créer un
                nouveau (cf en-tête de ce fichier). L'ancien reste lisible et
                opposable — c'est lui que la talent avait sous les yeux.
              */}
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="brief-nom">{tr("nom")}</Label>
                <Input
                  id="brief-nom"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder={tr("exBriefTournageAout")}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="brief-texte">{tr("briefMarkdown")}</Label>
                <Textarea
                  id="brief-texte"
                  rows={8}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder={tr("commentFilmerLumiereNaturellePlan")}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="brief-exemples">
                  {tr("videosDExempleUneUrl")}
                </Label>
                <Textarea
                  id="brief-exemples"
                  rows={3}
                  value={exemples}
                  onChange={(e) => setExemples(e.target.value)}
                  placeholder="https://www.tiktok.com/@compte/video/123"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !nom.trim() || !brief.trim()}
                  onClick={() => void creerEtDesigner()}
                >
                  {tr("creerEtMettreEnService")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreation(false)}
                >
                  {tr("annuler")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
