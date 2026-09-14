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
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

const TITLE_MAX = 120;
const CONTENT_MAX = 50_000;

export type GuideModuleDraft = {
  _id: Id<"guideModules">;
  title: string;
  contentMarkdown: string;
  status: "published" | "draft";
  /** Absente sur les modules écrits avant le champ ⇒ français. */
  locale?: string;
  /** `"warmup"` = ce module est celui qu'ouvre le bouton de l'écran comptes. */
  slot?: string;
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
  const showError = useConvexError();
  const tr = useTranslations("admin.library.GuideModuleEditForm");
  const isEdit = mode === "edit";
  const [title, setTitle] = useState(initialModule?.title ?? "");
  const [content, setContent] = useState(initialModule?.contentMarkdown ?? "");
  const [published, setPublished] = useState(
    initialModule ? initialModule.status === "published" : true,
  );
  const [isWarmup, setIsWarmup] = useState(initialModule?.slot === "warmup");
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
          isWarmupGuide: isWarmup,
        });
        toast.success(tr("moduleMisAJour"));
      } else {
        await createModule({
          title: trimmed,
          contentMarkdown: content,
          status,
          locale,
        });
        toast.success(tr("moduleCree"));
      }
      onClose();
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? tr("modifierLeModule") : tr("nouveauModule")}
        </DialogTitle>
        <DialogDescription>
          {tr("ecrisLeContenuEnMarkdown")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="module-title">{tr("titre")}</Label>
        <Input
          id="module-title"
          autoFocus
          maxLength={TITLE_MAX}
          placeholder={tr("exCommentJeSuisPaye")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <p className="text-xs text-slate-500">
          {tr("caracteres", { count: trimmed.length, TITLE_MAX: TITLE_MAX })}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="module-content">{tr("contenuMarkdown")}</Label>
          <Textarea
            id="module-content"
            rows={18}
            placeholder={tr("titreEcrisTonContenuIci")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-xs text-slate-400">{MARKDOWN_HINT}</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label>{tr("apercuCreateur")}</Label>
          <div className="min-h-[18rem] rounded-md border border-slate-200 bg-white p-4">
            {content.trim().length > 0 ? (
              <GuideMarkdown content={content} />
            ) : (
              <p className="text-sm text-slate-400">
                {tr("lApercuDuRenduApparaitra")}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{tr("langue")}</Label>
        <Select
          value={locale}
          onValueChange={(v) => v !== null && setLocale(v as Locale)}
        >
          <SelectTrigger aria-label={tr("langue2")} className="w-full sm:w-64">
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
          {tr("chaqueLangueASonPropre", { value: LOCALE_LABELS[locale] })}
          {isEdit
            ? ` ${tr("leChangerLeDeplaceEn")}`
            : tr("etNeToucheARien")}
        </p>
      </div>

      {isEdit && (
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
          <Switch
            id="module-warmup"
            checked={isWarmup}
            onCheckedChange={setIsWarmup}
          />
          <div className="space-y-0.5">
            <Label htmlFor="module-warmup" className="cursor-pointer">
              {tr("cEstLeGuideWarmup")}
            </Label>
            <p className="text-xs text-slate-500">
              {tr("leBoutonGuideWarmupDe")}{" "}<strong>{tr("unSeulParLangue")}</strong>{" "}{tr("lActiverIciLeRetire")}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
        <Switch
          id="module-published"
          checked={published}
          onCheckedChange={setPublished}
        />
        <div className="space-y-0.5">
          <Label htmlFor="module-published" className="cursor-pointer">
            {published ? tr("publie") : tr("brouillon")}
          </Label>
          <p className="text-xs text-slate-500">
            {published
              ? tr("visibleParLesCreateursDu")
              : tr("invisibleCoteCreateurTantQue")}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          {tr("annuler")}
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {isEdit ? tr("sauvegarder") : tr("creer")}
        </Button>
      </DialogFooter>
    </>
  );
}
