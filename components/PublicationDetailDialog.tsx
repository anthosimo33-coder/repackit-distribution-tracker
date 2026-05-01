"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { fr } from "date-fns/locale";
import { VerdictBadge, PlatformBadge } from "@/components/VerdictBadge";
import {
  calculateAuditConversion,
  calculateSaveRate,
  calculateVerdict,
  formatNumber,
  formatPercent,
} from "@/lib/verdict";
import { isPublished } from "@/lib/publication-status";
import {
  CalendarIcon,
  ExternalLinkIcon,
  Loader2Icon,
} from "lucide-react";
import { toast } from "sonner";

const PLATEFORMES = ["TikTok", "Instagram"] as const;
type Plateforme = (typeof PLATEFORMES)[number];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">{children}</div>
    </div>
  );
}

/**
 * Aiguille entre vue lecture seule (publié) et formulaire d'édition (draft).
 * Choix UX : sur un draft on ouvre directement en mode édition (pas de bouton
 * « Modifier » intermédiaire) parce que la valeur ajoutée du dialog sur un
 * brouillon est de pouvoir le modifier — la lecture seule serait redondante
 * avec ce que la table montre déjà. Sur un publié, l'inverse : on protège
 * l'historique et l'édition des stats passe par un dialog dédié.
 */
export function PublicationDetailDialog({
  publication,
  open,
  onOpenChange,
  onEdit,
}: {
  publication: Doc<"publications">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  if (!isPublished(publication)) {
    return (
      <DraftEditView
        publication={publication}
        open={open}
        onOpenChange={onOpenChange}
      />
    );
  }
  return (
    <PublishedView
      publication={publication}
      open={open}
      onOpenChange={onOpenChange}
      onEdit={onEdit}
    />
  );
}

// ─── Mode publié : lecture seule (comportement existant) ───────────────────

function PublishedView({
  publication,
  open,
  onOpenChange,
  onEdit,
}: {
  publication: Doc<"publications">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  const saveRate = calculateSaveRate(publication.saves, publication.vuesJ7);
  const verdict = calculateVerdict(saveRate);
  const auditConv = calculateAuditConversion(
    publication.commentsAudit,
    publication.vuesJ7,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono">{publication.carouselId}</span>
            <PlatformBadge plateforme={publication.plateforme} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">Hook</div>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {publication.hookText}
            </p>
          </div>

          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-medium text-emerald-700">
              Lien de publication
            </div>
            <a
              href={publication.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
            >
              <span className="break-all">{publication.postUrl}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0" />
            </a>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Mécanique">
              <Badge variant="secondary">{publication.mecanique}</Badge>
            </Field>
            <Field label="Niveau">
              <Badge variant="outline">{publication.niveau}</Badge>
            </Field>
            <Field label="Format">{publication.format}</Field>
            <Field label="Angle tonal">{publication.angleTonal}</Field>
            <Field label="Langue">{publication.langue}</Field>
            <Field label="Compte">
              <span className="font-mono text-xs">{publication.compte}</span>
            </Field>
            <Field label="Date publi">
              {new Date(publication.datePubli).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </Field>
            <Field label="Nb slides">{publication.nbSlides}</Field>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Slides ({publication.slides.length})
            </div>
            <ol className="space-y-2">
              {publication.slides.map((s) => (
                <li
                  key={s.position}
                  className="flex gap-3 rounded-md border border-slate-200 bg-white p-2 text-sm"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs font-medium text-slate-600">
                    {s.position}
                  </span>
                  <span className="whitespace-pre-wrap text-slate-700">
                    {s.texte || (
                      <em className="text-slate-400">(vide)</em>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Métriques
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm sm:grid-cols-4">
              <Field label="Vues J+1">{formatNumber(publication.vuesJ1)}</Field>
              <Field label="Vues J+3">{formatNumber(publication.vuesJ3)}</Field>
              <Field label="Vues J+7">{formatNumber(publication.vuesJ7)}</Field>
              <Field label="Saves">{formatNumber(publication.saves)}</Field>
              <Field label="Comments total">
                {formatNumber(publication.commentsTotal)}
              </Field>
              <Field label="Comments AUDIT">
                {publication.plateforme === "TikTok" ? (
                  <span className="text-slate-400">n/a</span>
                ) : (
                  formatNumber(publication.commentsAudit)
                )}
              </Field>
              <Field label="Profile visits">
                {formatNumber(publication.profileVisits)}
              </Field>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Stats calculées
            </div>
            <div className="flex flex-wrap items-center gap-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div>
                <span className="text-slate-500">Save rate :</span>{" "}
                <span className="font-semibold">{formatPercent(saveRate)}</span>
              </div>
              {publication.plateforme === "Instagram" && (
                <div>
                  <span className="text-slate-500">Conv. AUDIT :</span>{" "}
                  <span className="font-semibold">
                    {formatPercent(auditConv, 3)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Verdict :</span>
                <VerdictBadge verdict={verdict} />
              </div>
            </div>
          </div>

          {publication.notes && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">
                Notes
              </div>
              <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                {publication.notes}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button onClick={onEdit}>Modifier les stats</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Mode draft : édition au niveau carrousel ──────────────────────────────

function DraftEditView({
  publication,
  open,
  onOpenChange,
}: {
  publication: Doc<"publications">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // État form local — initialisé depuis publication. Le parent (tracker) passe
  // key={viewingPub._id} sur le dialog, donc le composant remonte quand on
  // ouvre une autre publication → useState ré-init naturellement, pas besoin
  // d'un useEffect de synchronisation.
  const [slides, setSlides] = useState(publication.slides);
  const [datePubli, setDatePubli] = useState<Date>(
    new Date(publication.datePubli),
  );
  const [compte, setCompte] = useState(publication.compte);
  const [plateforme, setPlateforme] = useState<Plateforme>(
    publication.plateforme,
  );
  const [postUrl, setPostUrl] = useState(publication.postUrl ?? "");
  const [submitting, setSubmitting] = useState(false);

  const comptesData = useQuery(api.comptes.listComptes, { actifOnly: true });
  const filteredComptes = useMemo(
    () => comptesData?.filter((c) => c.plateforme === plateforme) ?? [],
    [comptesData, plateforme],
  );

  // Reset du compte synchrone à un changement de plateforme. Pris en charge
  // dans le handler du Select pour éviter un useEffect setState (rule
  // react-hooks/set-state-in-effect).
  function handlePlateformeChange(next: Plateforme) {
    setPlateforme(next);
    if (!comptesData) return;
    const stillValid = comptesData.some(
      (c) => c.handle === compte && c.plateforme === next,
    );
    if (!stillValid) {
      const firstMatch = comptesData.find((c) => c.plateforme === next);
      setCompte(firstMatch?.handle ?? "");
    }
  }

  const updateDraft = useMutation(api.publications.updateDraft);
  const updateMetrics = useMutation(api.publications.updateMetrics);

  async function handleSave() {
    if (!compte) {
      toast.error("Compte requis");
      return;
    }
    // Si comptesData est encore en cours de chargement (Convex query non
    // résolue), on saute la validation côté client. La validation côté serveur
    // dans updateDraft attrape toute incohérence et throw avec un message clair.
    if (comptesData !== undefined) {
      const compteValid = filteredComptes.find((c) => c.handle === compte);
      if (!compteValid) {
        toast.error(`Le compte ${compte} n'existe pas sur ${plateforme}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // 1. Champs partagés au niveau carrousel (toutes les rows du carouselId)
      await updateDraft({
        carouselId: publication.carouselId,
        patch: {
          slides,
          datePubli: datePubli.getTime(),
          compte,
          plateforme,
        },
      });

      // 2. Lien de publication = per-row (chaque plateforme a son propre lien).
      // On le route via updateMetrics qui patch uniquement cette row.
      const trimmedUrl = postUrl.trim();
      if (trimmedUrl !== (publication.postUrl ?? "")) {
        await updateMetrics({
          id: publication._id,
          postUrl: trimmedUrl,
        });
      }

      toast.success("Brouillon enregistré");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'édition");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono">{publication.carouselId}</span>
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
              À venir
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">
              Hook (non éditable)
            </div>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {publication.hookText}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Plateforme</Label>
              <Select
                value={plateforme}
                onValueChange={(v) =>
                  v !== null && handlePlateformeChange(v as Plateforme)
                }
              >
                <SelectTrigger>
                  <SelectValue>{plateforme}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PLATEFORMES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Compte</Label>
              {comptesData === undefined ? (
                <div className="h-9 animate-pulse rounded-md bg-slate-100" />
              ) : filteredComptes.length === 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  Aucun compte actif sur {plateforme}.
                </p>
              ) : (
                <Select
                  value={compte}
                  onValueChange={(v) => v !== null && setCompte(v)}
                >
                  <SelectTrigger>
                    <SelectValue>{compte}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredComptes.map((c) => (
                      <SelectItem key={c._id} value={c.handle}>
                        <span className="font-mono">{c.handle}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Date de publication prévue</Label>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 size-4" />
                      {datePubli.toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={datePubli}
                    onSelect={(d) => d && setDatePubli(d)}
                    locale={fr}
                    weekStartsOn={1}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Slides ({slides.length})
            </div>
            <div className="space-y-2">
              {slides.map((s, i) => (
                <div key={i} className="space-y-1">
                  <Label
                    htmlFor={`edit-slide-${i}`}
                    className="text-xs text-slate-600"
                  >
                    Slide {s.position}
                  </Label>
                  <Textarea
                    id={`edit-slide-${i}`}
                    rows={2}
                    value={s.texte}
                    placeholder={`Texte de la slide ${s.position}…`}
                    onChange={(e) => {
                      const next = [...slides];
                      next[i] = { ...s, texte: e.target.value };
                      setSlides(next);
                    }}
                    className="whitespace-pre-wrap"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="post-url-detail">Lien de publication</Label>
            <Input
              id="post-url-detail"
              type="url"
              placeholder="https://www.tiktok.com/@... ou https://www.instagram.com/..."
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Renseigner le lien fait passer cette row en « publié » et
              débloque l&apos;édition des métriques. La saisie vide la maintient
              en « à venir ».
            </p>
          </div>

          {publication.notes && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">
                Notes
              </div>
              <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                {publication.notes}
              </p>
            </div>
          )}

          {/*
            Décision D : si un draft a des métriques pré-saisies (legacy ou
            re-passage publié→draft), on les laisse en base mais on ne les
            affiche pas ici — les métriques n'ont pas de sens tant que la
            publication n'est pas live.
          */}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
