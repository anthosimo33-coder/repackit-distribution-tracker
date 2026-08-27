"use client";

import { useState } from "react";
import {
  LOCALES,
  LOCALE_LABELS,
  DEFAULT_LOCALE,
  normalizeLocale,
  type Locale,
} from "@/i18n/locales";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GuideMarkdown } from "@/components/ui/GuideMarkdown";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

const TITLE_MAX = 120;
const CONTENT_MAX = 50_000;

export type GuideModuleDraft = {
  _id: Id<"guideModules">;
  title: string;
  contentMarkdown: string;
  status: "published" | "draft";
  /** Absente sur les modules écrits avant le champ ⇒ français. */
  locale?: string;
};

/**
 * Dialog création/édition d'un module « Comment ça marche ». Éditeur markdown
 * (textarea) + APERÇU live du rendu créateur (GuideMarkdown) côte à côte
 * (empilé en mobile). Toggle published/draft, sélecteur de LANGUE. Le pattern
 * wrapper + form interne keyé permet d'initialiser useState depuis
 * initialModule sans useEffect.
 *
 * `initialLocale` n'est lu qu'en CRÉATION : le bouton « Nouveau module anglais »
 * ouvre le dialog déjà réglé sur l'anglais, personne n'a à y penser. En édition,
 * c'est la langue du module qui gagne — toujours.
 */
export function GuideModuleEditDialog({
  open,
  onOpenChange,
  mode,
  initialModule,
  initialLocale = DEFAULT_LOCALE,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialModule: GuideModuleDraft | null;
  initialLocale?: Locale;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <GuideModuleEditForm
          key={initialModule?._id ?? "create"}
          mode={mode}
          initialModule={initialModule}
          initialLocale={initialLocale}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const MARKDOWN_HINT =
  "Markdown : # Titre, ## Sous-titre, **gras**, *italique*, `code`, - liste, 1. liste numérotée, [lien](https://…). Une ligne vide sépare les paragraphes.";

function GuideModuleEditForm({
  mode,
  initialModule,
  initialLocale,
  onClose,
}: {
  mode: "create" | "edit";
  initialModule: GuideModuleDraft | null;
  initialLocale: Locale;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";
  const [title, setTitle] = useState(initialModule?.title ?? "");
  const [content, setContent] = useState(initialModule?.contentMarkdown ?? "");
  const [published, setPublished] = useState(
    initialModule ? initialModule.status === "published" : true,
  );
  const [locale, setLocale] = useState<Locale>(
    initialModule
      ? (normalizeLocale(initialModule.locale) ?? DEFAULT_LOCALE)
      : initialLocale,
  );
  const [submitting, setSubmitting] = useState(false);

  const createModule = useProjectMutation(api.guideModules.createModule);
  const updateModule = useProjectMutation(api.guideModules.updateModule);

  const trimmed = title.trim();
  const canSubmit =
    trimmed.length > 0 &&
    trimmed.length <= TITLE_MAX &&
    content.length <= CONTENT_MAX &&
    !submitting;

  async function handleSave() {
    if (!canSubmit) return;
    setSubmitting(true);
    const status = published ? "published" : "draft";
    try {
      if (isEdit && initialModule) {
        await updateModule({
          id: initialModule._id,
          title: trimmed,
          contentMarkdown: content,
          status,
          locale,
        });
        toast.success("Module mis à jour");
      } else {
        await createModule({
          title: trimmed,
          contentMarkdown: content,
          status,
          locale,
        });
        toast.success("Module créé");
      }
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Modifier le module" : "Nouveau module"}
        </DialogTitle>
        <DialogDescription>
          Écris le contenu en markdown — l&apos;aperçu montre ce que verra le
          créateur.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="module-title">Titre *</Label>
        <Input
          id="module-title"
          autoFocus
          maxLength={TITLE_MAX}
          placeholder="Ex : Comment je suis payé"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <p className="text-xs text-slate-500">
          {trimmed.length}/{TITLE_MAX} caractères
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="module-content">Contenu (markdown)</Label>
          <Textarea
            id="module-content"
            rows={18}
            placeholder={"# Titre\n\nÉcris ton contenu ici…"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-xs text-slate-400">{MARKDOWN_HINT}</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label>Aperçu créateur</Label>
          <div className="min-h-[18rem] rounded-md border border-slate-200 bg-white p-4">
            {content.trim().length > 0 ? (
              <GuideMarkdown content={content} />
            ) : (
              <p className="text-sm text-slate-400">
                L&apos;aperçu du rendu apparaîtra ici.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Langue *</Label>
        <Select
          value={locale}
          onValueChange={(v) => v !== null && setLocale(v as Locale)}
        >
          <SelectTrigger aria-label="Langue" className="w-full sm:w-64">
            <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => (
              <SelectItem key={l} value={l}>
                {LOCALE_LABELS[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-slate-500">
          Chaque langue a son propre jeu de modules. Ce module n&apos;apparaît
          que dans le guide {LOCALE_LABELS[locale]}
          {isEdit
            ? " — le changer le déplace en fin de l'autre jeu."
            : ", et ne touche à rien dans l'autre."}
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
        <Switch
          id="module-published"
          checked={published}
          onCheckedChange={setPublished}
        />
        <div className="space-y-0.5">
          <Label htmlFor="module-published" className="cursor-pointer">
            {published ? "Publié" : "Brouillon"}
          </Label>
          <p className="text-xs text-slate-500">
            {published
              ? "Visible par les créateurs du projet."
              : "Invisible côté créateur tant que brouillon."}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {isEdit ? "Sauvegarder" : "Créer"}
        </Button>
      </DialogFooter>
    </>
  );
}
