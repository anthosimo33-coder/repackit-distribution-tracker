"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ImageIcon, Loader2Icon, Trash2Icon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  LOGO_MAX_BYTES,
  logoRefusal,
  normalizeAccentColor,
  PROJECT_NAME_MAX,
} from "@/convex/projectLifecycleRules";
import { useProject } from "@/components/project/ProjectProvider";
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
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * MODIFIER LE PROJET COURANT (superadmin) : nom, logo, couleur d'accent. La
 * garde réelle est côté Convex (`superadminMutation`).
 *
 * Le slug est AFFICHÉ, pas modifiable : il est dans les URL déjà partagées, et le
 * code en dépend nommément. La suppression vit en bas, dans une zone à part, et
 * ouvre sa propre confirmation (`onDelete`).
 */
export function EditProjectDialog({
  open,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Monté à l'ouverture : le formulaire repart toujours des valeurs
            ACTUELLES du projet, jamais d'une saisie abandonnée. */}
        {open && (
          <FormulaireProjet
            onClose={() => onOpenChange(false)}
            onDelete={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormulaireProjet({
  onClose,
  onDelete,
}: {
  onClose: () => void;
  onDelete: () => void;
}) {
  const tr = useTranslations("admin.common.EditProjectDialog");
  const showError = useConvexError();
  const { project } = useProject();
  const updateProject = useMutation(api.projectLifecycle.updateProject);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const fichierRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(project.name);
  const [accent, setAccent] = useState(project.accentColor || "#ff5200");
  // Logo : fichier choisi (pas encore envoyé), ou demande de retrait.
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [retirerLogo, setRetirerLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // L'aperçu local est libéré dès qu'il est remplacé, et à la fermeture.
  useEffect(() => {
    return () => {
      if (apercu) URL.revokeObjectURL(apercu);
    };
  }, [apercu]);

  const logoAffiche = apercu ?? (retirerLogo ? null : project.logoUrl);
  const couleur = normalizeAccentColor(accent);

  function choisirFichier(f: File | undefined) {
    if (!f) return;
    const refus = logoRefusal({ contentType: f.type, size: f.size });
    if (refus !== null) {
      setError(
        refus === "too_large"
          ? tr("logoTropLourd", { maxMb: LOGO_MAX_BYTES / (1024 * 1024) })
          : tr("logoPasUneImage"),
      );
      return;
    }
    setError(null);
    setFichier(f);
    setApercu(URL.createObjectURL(f));
    setRetirerLogo(false);
  }

  function retirer() {
    setFichier(null);
    setApercu(null);
    setRetirerLogo(true);
    if (fichierRef.current) fichierRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (couleur === null) {
      setError(tr("couleurInvalide"));
      return;
    }
    setSubmitting(true);
    try {
      let logo: Id<"_storage"> | null | undefined;
      if (fichier) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": fichier.type },
          body: fichier,
        });
        if (!res.ok) throw new Error("upload");
        const { storageId } = (await res.json()) as {
          storageId: Id<"_storage">;
        };
        logo = storageId;
      } else if (retirerLogo) {
        logo = null;
      }
      await updateProject({
        projectId: project._id,
        name,
        accentColor: couleur,
        ...(logo !== undefined ? { logo } : {}),
      });
      toast.success(tr("projetMisAJour"));
      onClose();
    } catch (err) {
      setError(showError(err, tr("enregistrementImpossible")));
      setSubmitting(false);
    }
  }

  const initiale = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{tr("modifierLeProjet")}</DialogTitle>
        <DialogDescription>{tr("description")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-4">
        {/* LOGO — l'aperçu est l'avatar réel du switcher, en plus grand. */}
        <div className="space-y-1.5">
          <Label>{tr("logo")}</Label>
          <div className="flex items-center gap-3">
            {logoAffiche ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoAffiche}
                alt={tr("apercuDuLogo")}
                className="size-14 shrink-0 rounded-lg border border-slate-200 object-cover"
              />
            ) : (
              <span
                aria-label={tr("apercuDuLogo")}
                role="img"
                className="flex size-14 shrink-0 items-center justify-center rounded-lg text-xl font-bold text-white"
                style={{ backgroundColor: couleur ?? "#94a3b8" }}
              >
                {initiale}
              </span>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                ref={fichierRef}
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label={tr("choisirUneImage")}
                onChange={(e) => choisirFichier(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fichierRef.current?.click()}
              >
                <ImageIcon className="size-3.5" />
                {logoAffiche ? tr("remplacer") : tr("ajouterUnLogo")}
              </Button>
              {logoAffiche && (
                <Button type="button" variant="ghost" size="sm" onClick={retirer}>
                  <XIcon className="size-3.5" />
                  {tr("retirer")}
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400">
            {tr("aideLogo", { maxMb: LOGO_MAX_BYTES / (1024 * 1024) })}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-project-name">{tr("nom")}</Label>
          <Input
            id="edit-project-name"
            value={name}
            maxLength={PROJECT_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-project-accent">{tr("couleurDAccent")}</Label>
          <div className="flex items-center gap-2">
            <input
              id="edit-project-accent"
              type="color"
              value={couleur ?? "#000000"}
              onChange={(e) => setAccent(e.target.value)}
              className="size-9 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
              aria-label={tr("couleurDAccent")}
            />
            <Input
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="w-28 font-mono"
              aria-label={tr("codeCouleur")}
              aria-invalid={couleur === null}
            />
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-sm font-medium text-slate-700">{tr("slug")}</span>
          <p className="text-xs text-slate-500">
            {/* i18n-exempt: chemin d'URL, pas du texte */}
            <span className="font-mono">/admin/{project.slug}</span>{" "}
            — {tr("slugFige")}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}

        {/* ZONE DE DANGER — séparée, et elle n'efface rien d'elle-même : elle
            ouvre une confirmation qui exige le nom du projet. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2.5">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-rose-900">
              {tr("supprimerCeProjet")}
            </p>
            <p className="text-xs text-rose-800/80">{tr("aideSuppression")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-rose-300 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
            onClick={onDelete}
          >
            <Trash2Icon className="size-3.5" />
            {tr("supprimer")}
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {tr("annuler")}
        </Button>
        <Button type="submit" disabled={submitting || couleur === null}>
          {submitting && <Loader2Icon className="size-4 animate-spin" />}
          {tr("enregistrer")}
        </Button>
      </DialogFooter>
    </form>
  );
}
