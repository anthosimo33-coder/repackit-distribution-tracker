"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ImageUploader } from "@/components/ImageUploader";
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
import { getMediaType } from "@/lib/media-type";
import {
  CalendarIcon,
  ExternalLinkIcon,
  Loader2Icon,
} from "lucide-react";
import { toast } from "sonner";

// Batch C — adresse TD-008 : la const PLATEFORMES locale est remplacée par
// ALL_PLATFORMS de lib/format-config.ts (single source of truth).
// La validation du couple plateforme/mediaType (carrousel → pas YouTube) est
// appliquée côté serveur dans updateDraft — defense in depth, pas de
// filtrage UI ici (le draft autorise n'importe quelle des 3 plateformes,
// le serveur reject si incohérent avec le mediaType existant).
import { ALL_PLATFORMS, type Platform as Plateforme } from "@/lib/format-config";

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
// Batch D — type étendu : la query listPublications enrichit chaque row
// avec imageUrl résolu (cf convex/publications.ts). Les composants qui
// consomment ces rows doivent typer avec l'augmentation. Doc<"publications">
// reste la source de vérité pour les champs persistés.
export type PublicationWithImage = Doc<"publications"> & {
  imageUrl?: string | null;
};

export function PublicationDetailDialog({
  publication,
  open,
  onOpenChange,
  onEdit,
}: {
  publication: PublicationWithImage;
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
  publication: PublicationWithImage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  // Batch 2 Modif 4c — coercion mediaType pour le rendu conditionnel.
  // Batch D — branche screenrecorder ajoutée : titre + image en plus.
  // Pour les métriques, ScreenRecorder partage le shape Short
  // (likes/subsGained, pas de saveRate/verdict).
  const mediaType = getMediaType(publication);
  const isShort = mediaType === "short";
  const isScreenRecorder = mediaType === "screenrecorder";
  const isVideoFormat = isShort || isScreenRecorder;
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

          {/* Batch D — Section ScreenRecorder : image preview large +
              titre. Affiché uniquement pour ce mediaType (carousel/short
              n'ont ni titre ni image). L'image est cliquable pour ouvrir
              la URL Convex en plein écran (target=_blank). */}
          {isScreenRecorder && publication.imageUrl && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">Image</div>
              <a
                href={publication.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block max-w-md overflow-hidden rounded-md border border-slate-200 hover:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publication.imageUrl}
                  alt={publication.titre ?? "ScreenRecorder image"}
                  className="aspect-video w-full object-cover"
                />
              </a>
            </div>
          )}
          {isScreenRecorder && publication.titre && (
            <div>
              <div className="text-xs font-medium text-slate-500">Titre</div>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {publication.titre}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Mécanique">
              <Badge variant="secondary">{publication.mecanique}</Badge>
            </Field>
            <Field label="Niveau">
              <Badge variant="outline">{publication.niveau}</Badge>
            </Field>
            <Field label="Format">
              {isVideoFormat ? (
                <span className="text-slate-400">—</span>
              ) : (
                publication.format
              )}
            </Field>
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
            <Field label="Nb slides">
              {isVideoFormat ? (
                <span className="text-slate-400">—</span>
              ) : (
                publication.nbSlides
              )}
            </Field>
          </div>

          {/*
            Batch 2 Modif 4c — script (Short) ou liste de slides (Carousel).
            Le script préserve les sauts de ligne via whitespace-pre-wrap.
          */}
          {isVideoFormat ? (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                Script
              </div>
              <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                {publication.script ? (
                  publication.script
                ) : (
                  <em className="text-slate-400">(vide)</em>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                Slides ({(publication.slides ?? []).length})
              </div>
              <ol className="space-y-2">
                {(publication.slides ?? []).map((s) => (
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
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Métriques
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm sm:grid-cols-4">
              <Field label="Vues J+1">{formatNumber(publication.vuesJ1)}</Field>
              <Field label="Vues J+3">{formatNumber(publication.vuesJ3)}</Field>
              <Field label="Vues J+7">{formatNumber(publication.vuesJ7)}</Field>
              {/*
                Batch 2 Modif 4c — Saves (Carousel) remplacé par Likes +
                Subs gained (Short). Comments AUDIT passe en Instagram-only
                via la condition positive (cohérent avec l'inversion
                isTikTok → isInstagram dans PublicationEditDialog).
              */}
              {isVideoFormat ? (
                <>
                  <Field label="Likes">
                    {formatNumber(publication.likes)}
                  </Field>
                  <Field label="Subs gagnés">
                    {formatNumber(publication.subsGained)}
                  </Field>
                </>
              ) : (
                <Field label="Saves">{formatNumber(publication.saves)}</Field>
              )}
              <Field label="Comments total">
                {formatNumber(publication.commentsTotal)}
              </Field>
              <Field label="Comments AUDIT">
                {publication.plateforme === "Instagram" ? (
                  formatNumber(publication.commentsAudit)
                ) : (
                  <span className="text-slate-400">n/a</span>
                )}
              </Field>
              <Field label="Profile visits">
                {formatNumber(publication.profileVisits)}
              </Field>
            </div>
          </div>

          {/*
            Batch 2 Modif 4c — Save rate et Verdict masqués en mode short
            (saveRate non calculé, verdict non applicable). Conv. AUDIT
            reste Instagram-only (peut donc apparaître pour un Reel court
            futur). Si en short toutes les sub-stats sont absentes, on ne
            rend pas la section pour éviter une boîte vide.
          */}
          {(!isVideoFormat || publication.plateforme === "Instagram") && (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                Stats calculées
              </div>
              <div className="flex flex-wrap items-center gap-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                {!isVideoFormat && (
                  <div>
                    <span className="text-slate-500">Save rate :</span>{" "}
                    <span className="font-semibold">
                      {formatPercent(saveRate)}
                    </span>
                  </div>
                )}
                {publication.plateforme === "Instagram" && (
                  <div>
                    <span className="text-slate-500">Conv. AUDIT :</span>{" "}
                    <span className="font-semibold">
                      {formatPercent(auditConv, 3)}
                    </span>
                  </div>
                )}
                {!isVideoFormat && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Verdict :</span>
                    <VerdictBadge verdict={verdict} />
                  </div>
                )}
              </div>
            </div>
          )}

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
  publication: PublicationWithImage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Batch 2 Modif 4c — coercion mediaType pour brancher slides ↔ script.
  // Le mediaType d'un draft ne change pas (cf décision 8 : pas de switch
  // de format après création), donc on le calcule au mount et on garde.
  // Batch D — branche screenrecorder ajoutée : titre + image éditables.
  const mediaType = getMediaType(publication);
  const isShort = mediaType === "short";
  const isScreenRecorder = mediaType === "screenrecorder";
  const isVideoFormat = isShort || isScreenRecorder;

  // État form local — initialisé depuis publication. Le parent (tracker) passe
  // key={viewingPub._id} sur le dialog, donc le composant remonte quand on
  // ouvre une autre publication → useState ré-init naturellement, pas besoin
  // d'un useEffect de synchronisation.
  const [slides, setSlides] = useState(publication.slides ?? []);
  const [script, setScript] = useState(publication.script ?? "");
  const [titre, setTitre] = useState(publication.titre ?? "");
  // image: storageId (null = supprimée, undefined = non touchée).
  const [image, setImage] = useState<Id<"_storage"> | null | undefined>(
    publication.image ?? null,
  );
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
    // Batch 2 Modif 4c — validation script non vide pour les Shorts (pas
    // de slides à valider, pas de longueur min/max — cf décision 1).
    if (isShort && script.trim().length === 0) {
      toast.error("Le script ne peut pas être vide.");
      return;
    }
    // Batch D — ScreenRecorder : titre 3-200 + image requise.
    if (isScreenRecorder) {
      const t = titre.trim();
      if (t.length < 3 || t.length > 200) {
        toast.error("Titre requis (3-200 caractères).");
        return;
      }
      if (image === null || image === undefined) {
        toast.error("Image requise pour ScreenRecorder.");
        return;
      }
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
      // 1. Champs partagés au niveau carrousel (toutes les rows du carouselId).
      // Batch 2 Modif 4c — patch slides ou script selon mediaType. Les 2
      // sont déjà des champs optionnels du patch (cf updateDraft serveur
      // étendu Batch 1). On envoie uniquement le pertinent pour minimiser
      // les patches DB.
      // Patch shape selon mediaType :
      //   - carousel : slides
      //   - short : script
      //   - screenrecorder : script + titre + image
      const patchPayload = isScreenRecorder
        ? {
            script: script.trim(),
            titre: titre.trim(),
            // image: undefined = ne pas toucher ; null = supprimer la
            // référence storage (pas de cascade sur le blob — TD-011).
            image: image === undefined ? undefined : image,
            datePubli: datePubli.getTime(),
            compte,
            plateforme,
          }
        : isShort
          ? {
              script: script.trim(),
              datePubli: datePubli.getTime(),
              compte,
              plateforme,
            }
          : {
              slides,
              datePubli: datePubli.getTime(),
              compte,
              plateforme,
            };
      await updateDraft({
        carouselId: publication.carouselId,
        patch: patchPayload,
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
                  {ALL_PLATFORMS.map((p) => (
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

          {/*
            Batch 2 Modif 4c — édition script (Short/SR) ou liste de slides
            (Carousel). Le script est édité dans un seul Textarea long
            (rows=12 pour donner de la place à un texte vidéo continu).
            Batch D — pour ScreenRecorder, on ajoute Titre + ImageUploader
            au-dessus du script.
          */}
          {isScreenRecorder && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-titre">Titre</Label>
                <Input
                  id="edit-titre"
                  value={titre}
                  onChange={(e) => setTitre(e.target.value)}
                  placeholder="Titre du ScreenRecorder (3-200 caractères)"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Image</Label>
                <ImageUploader
                  value={image ?? null}
                  imageUrl={publication.imageUrl ?? null}
                  onChange={(storageId) => setImage(storageId)}
                />
              </div>
            </div>
          )}
          {isVideoFormat ? (
            <div className="space-y-1.5">
              <Label htmlFor="edit-script">
                {isScreenRecorder ? "Script (optionnel)" : "Script de la vidéo"}
              </Label>
              <Textarea
                id="edit-script"
                rows={12}
                value={script}
                placeholder={
                  isScreenRecorder
                    ? "Script de la narration — optionnel."
                    : "Texte intégral du Short…"
                }
                onChange={(e) => setScript(e.target.value)}
                className="whitespace-pre-wrap"
              />
              <p className="text-xs text-slate-500">
                Texte continu, pas de slides découpées.
              </p>
            </div>
          ) : (
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
          )}

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
