"use client";

import { useState, type MouseEvent } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submittedVideoFilename } from "@/lib/video-download";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VideoExample } from "@/components/formats/VideoExample";
import { StreamPlayer } from "@/components/formats/StreamPlayer";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { ManagedPublishForm } from "@/components/admin/ManagedPublishForm";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { formatMoney } from "@/lib/format-rate";
import type { FunctionReturnType } from "convex/server";
import {
  CheckIcon,
  XIcon,
  Loader2Icon,
  ExternalLinkIcon,
  TrendingUpIcon,
  InboxIcon,
  DownloadIcon,
  FilmIcon,
  FileTextIcon,
  ChevronDownIcon,
} from "lucide-react";

type VideoSubmittedRow =
  FunctionReturnType<typeof api.assignments.listVideoSubmitted>[number];
type PublishedRow =
  FunctionReturnType<typeof api.assignments.listPublished>[number];
type BonusRowData =
  FunctionReturnType<typeof api.assignments.listValidatedForBonus>[number];
type ManagedToPublishRow =
  FunctionReturnType<typeof api.assignments.listManagedToPublish>[number];

/**
 * File de validation admin. La REVUE VIDÉO vient AVANT publication :
 *  1. « Vidéos à valider » : assignments en video_submitted, MP4 lisible in-app
 *     (controlsList nodownload). Valider → to_publish (notif créateur, AUCUN
 *     paiement ici). Refuser → feedback obligatoire → video_rejected.
 *  2. « Publiées récemment » : assignments passés en published (URL).
 *  3. « Bonus de vues » : assignments publiés avec snapshots → calcul du bonus.
 */

const nf = new Intl.NumberFormat("fr-FR");
const formatDate = (ts: number) => new Date(ts).toLocaleDateString("fr-FR");

export default function ValidationPage() {
  // Devise de la PAIE créatrices (dollars) — pour les montants de bonus affichés.
  const payCurrency = useProject().project.payCurrency;
  const toReview = useProjectQuery(api.assignments.listVideoSubmitted, {});
  const managedToPublish = useProjectQuery(
    api.assignments.listManagedToPublish,
    {},
  );
  const published = useProjectQuery(api.assignments.listPublished, {});
  const bonusRows = useProjectQuery(api.assignments.listValidatedForBonus, {});

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Validation
        </h1>
        <p className="text-sm text-slate-500">
          {toReview === undefined
            ? "Chargement…"
            : `${toReview.length} vidéo${toReview.length > 1 ? "s" : ""} en attente de revue`}
        </p>
      </header>

      {/* ─── Vidéos à valider ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Vidéos à valider
        </h2>
        {toReview === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : toReview.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <InboxIcon className="size-10 text-slate-300" strokeWidth={1.5} />
              <p className="text-sm text-slate-500">
                Aucune vidéo en attente. Les soumissions des créateurs
                apparaîtront ici.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {toReview.map((a) => (
              <VideoReviewCard key={a._id} a={a} />
            ))}
          </div>
        )}
      </section>

      {/* ─── Comptes gérés — à publier ──────────────────────────────────────── */}
      {managedToPublish !== undefined && managedToPublish.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Comptes gérés — à publier
          </h2>
          <p className="text-sm text-slate-500">
            Comptes tenus par l&apos;équipe : colle le lien du post publié. La
            créatrice est créditée et voit le post + ses perfs (elle ne publie
            pas).
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {managedToPublish.map((a) => (
              <ManagedPublishCard key={a._id} a={a} />
            ))}
          </div>
        </section>
      )}

      {/* ─── Publiées récemment ────────────────────────────────────────────── */}
      {published !== undefined && published.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Publiées récemment
          </h2>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Créateur</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Publié le</TableHead>
                    <TableHead>Posts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {published.map((p) => (
                    <PublishedTableRow key={p._id} p={p} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ─── Bonus de vues ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Bonus de vues
        </h2>
        {bonusRows === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : bonusRows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              Aucun post publié pour l&apos;instant.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Créateur</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Posts</TableHead>
                    <TableHead className="text-right">Vues cumulées</TableHead>
                    <TableHead className="text-right">Bonus</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bonusRows.map((r) => (
                    <BonusRow
                      key={r.assignmentId}
                      r={r}
                      currency={payCurrency}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function VideoReviewCard({ a }: { a: VideoSubmittedRow }) {
  const approve = useProjectMutation(api.assignments.reviewVideoApprove);
  const reject = useProjectMutation(api.assignments.reviewVideoReject);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  // Le lecteur inline signale s'il ne sait pas afficher la vidéo (HEVC iPhone) :
  // on met alors le téléchargement en avant comme seule façon de la visionner.
  const [unreadable, setUnreadable] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const downloadName = submittedVideoFilename({
    creatorName: a.creatorName,
    label: a.label,
    mimeType: a.videoMimeType,
  });

  // Script monté FIGÉ à suivre (origine script uniquement). Court → déplié
  // d'emblée pour comparer vidéo ↔ script ; long → replié, dérouler à la
  // demande pour ne pas noyer la carte.
  const scriptText = a.assembledScript ?? "";
  const hasScript = a.origin === "script" && scriptText.trim().length > 0;
  const [scriptOpen, setScriptOpen] = useState(scriptText.length <= 360);

  // Télécharge le FICHIER ORIGINAL déjà stocké (URL signée Convex du
  // storageId). On passe par fetch → blob → <a download> : cross-origin, c'est
  // le seul moyen FIABLE d'imposer le téléchargement (et le nom de fichier)
  // plutôt qu'une ouverture inline que le navigateur ne sait pas lire (HEVC).
  // Repli : ouverture dans un onglet si le fetch échoue (réseau/CORS).
  async function onDownload(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!a.videoUrl || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(a.videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(a.videoUrl, "_blank", "noopener,noreferrer");
      toast.error("Téléchargement direct impossible — ouvert dans un onglet.");
    } finally {
      setDownloading(false);
    }
  }

  async function onApprove() {
    setBusy(true);
    try {
      const r = await approve({ id: a._id });
      toast.success(
        r.alreadyApproved
          ? "Déjà validée."
          : "Vidéo validée — le créateur peut publier.",
      );
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la validation de la vidéo"));
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (feedback.trim().length === 0) {
      toast.error("Un motif de refus est requis.");
      return;
    }
    setBusy(true);
    try {
      await reject({ id: a._id, feedback });
      toast.success("Refusée — le créateur peut re-soumettre.");
      setRejectOpen(false);
      setFeedback("");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec du refus de la vidéo"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-medium text-slate-900">{a.creatorName}</div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              {a.label}
              {a.origin === "script" && (
                <Badge variant="secondary" className="text-[10px]">
                  Script
                </Badge>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            Échéance {formatDate(a.dueDate)}
          </div>
        </div>

        {/* Conteneur scopé à l'assignment (testid par id) : plusieurs cartes
            cohabitent dans la file, les assertions e2e doivent viser LA bonne. */}
        <div data-testid={`submission-media-${a._id}`}>
          {a.streamUid &&
          (a.streamStatus === "ready" || a.streamStatus === "processing") ? (
            // Cloudflare Stream a transcodé (ou transcode) la vidéo → player
            // lisible inline, HEVC inclus, sans téléchargement. Le bouton
            // télécharger (#56) reste affiché en complément ci-dessous.
            <StreamPlayer uid={a.streamUid} status={a.streamStatus} />
          ) : a.videoUrl && a.videoStorageId ? (
            // Fallback : pas de Stream (env absent, copie/transcoding en erreur,
            // ou ancienne vidéo non migrée) → <video> Convex + message HEVC + DL.
            <VideoExample
              example={{
                kind: "file",
                storageId: a.videoStorageId,
                title: "",
                mimeType: a.videoMimeType,
                url: a.videoUrl,
              }}
              onUnreadable={() => setUnreadable(true)}
            />
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-400">
              Vidéo indisponible.
            </div>
          )}
        </div>

        {a.videoUrl && (
          <div className="space-y-2">
            {unreadable && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                <FilmIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span>
                  La vidéo ne s&apos;affiche pas dans le navigateur (format HEVC
                  iPhone). Télécharge-la pour la visionner dans ton lecteur
                  (QuickTime).
                </span>
              </div>
            )}
            <a
              href={a.videoUrl}
              download={downloadName}
              onClick={onDownload}
              data-testid={`download-${a._id}`}
              aria-disabled={downloading}
              className={cn(
                buttonVariants({
                  variant: unreadable ? "default" : "outline",
                }),
                "w-full",
              )}
            >
              {downloading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <DownloadIcon className="mr-2 size-4" />
              )}
              Télécharger la vidéo
            </a>
          </div>
        )}

        {hasScript && (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => setScriptOpen((o) => !o)}
              aria-expanded={scriptOpen}
              data-testid={`script-toggle-${a._id}`}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
                <FileTextIcon className="size-4 shrink-0 text-slate-400" />
                <span className="shrink-0">Script à suivre</span>
                {a.comboSummary && (
                  <span className="truncate text-xs font-normal text-slate-400">
                    · {a.comboSummary}
                  </span>
                )}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-4 shrink-0 text-slate-400 transition-transform",
                  scriptOpen && "rotate-180",
                )}
              />
            </button>
            {scriptOpen && (
              <div
                className="border-t border-slate-200 px-3 py-2.5"
                data-testid={`script-content-${a._id}`}
              >
                <SimpleMarkdown content={scriptText} />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            onClick={onApprove}
            disabled={busy}
            className="flex-1"
            data-testid={`approve-${a._id}`}
          >
            {busy ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <CheckIcon className="mr-2 size-4" />
            )}
            Valider la vidéo
          </Button>
          <Button
            variant="outline"
            onClick={() => setRejectOpen(true)}
            disabled={busy}
            className="flex-1"
          >
            <XIcon className="mr-2 size-4" />
            Refuser
          </Button>
        </div>
      </CardContent>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refuser — {a.creatorName}</DialogTitle>
            <DialogDescription>
              Le motif est visible par le créateur, qui pourra corriger et
              re-soumettre une vidéo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-feedback">Motif du refus</Label>
            <Textarea
              id="reject-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ex. hook hors brief, cadrage, sous-titres manquants…"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={busy}
            >
              Annuler
            </Button>
            <Button variant="destructive" onClick={onReject} disabled={busy}>
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Refuser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * COMPTE GÉRÉ — l'admin colle le(s) lien(s) du post publié (1 URL par cible) puis
 * publie via confirmPublicationAsAdmin. MÊME accrual que la publication créatrice
 * → la créatrice est créditée à l'identique et voit le post + ses perfs.
 */
function ManagedPublishCard({ a }: { a: ManagedToPublishRow }) {
  const [scriptOpen, setScriptOpen] = useState(false);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-medium text-slate-900">{a.creatorName}</div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              {a.label}
              <Badge variant="secondary" className="text-[10px]">
                Géré
              </Badge>
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            Échéance {formatDate(a.dueDate)}
          </div>
        </div>

        {a.assembledScript && (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => setScriptOpen((o) => !o)}
              aria-expanded={scriptOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
                <FileTextIcon className="size-4 shrink-0 text-slate-400" />
                Script à publier
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-4 shrink-0 text-slate-400 transition-transform",
                  scriptOpen && "rotate-180",
                )}
              />
            </button>
            {scriptOpen && (
              <div className="border-t border-slate-200 px-3 py-2.5">
                <SimpleMarkdown content={a.assembledScript} />
              </div>
            )}
          </div>
        )}

        <ManagedPublishForm
          assignmentId={a._id}
          targets={a.targets}
          buttonTestId={`managed-publish-${a._id}`}
        />
      </CardContent>
    </Card>
  );
}

function PublishedTableRow({ p }: { p: PublishedRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium text-slate-900">
        {p.creatorName}
      </TableCell>
      <TableCell className="text-slate-700">{p.label}</TableCell>
      <TableCell className="text-slate-500">
        {p.publishedAt ? formatDate(p.publishedAt) : "—"}
      </TableCell>
      <TableCell>
        {p.targets.length === 0 ? (
          "—"
        ) : (
          <div className="flex flex-col gap-1">
            {p.targets.map((t) =>
              t.publishedUrl ? (
                <a
                  key={t.platform}
                  href={t.publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  {t.platform}
                  {t.accountHandle ? (
                    <span className="font-mono text-xs text-slate-400">
                      {t.accountHandle}
                    </span>
                  ) : null}
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              ) : (
                <span key={t.platform} className="text-xs text-slate-400">
                  {t.platform} —
                </span>
              ),
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function BonusRow({
  r,
  currency,
}: {
  r: BonusRowData;
  /** Devise de la PAIE créatrices (dollars), threadée depuis ValidationPage. */
  currency?: string | null;
}) {
  const compute = useProjectMutation(api.assignments.computeViewBonus);
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState("");
  const [busy, setBusy] = useState(false);

  function openDialog() {
    setViews(String(r.latestViews ?? 0));
    setOpen(true);
  }

  async function onCompute() {
    const v = Number(views);
    if (!Number.isFinite(v) || v < 0) {
      toast.error("Nombre de vues invalide.");
      return;
    }
    setBusy(true);
    try {
      const res = await compute({ id: r.assignmentId, views: v });
      toast.success(`Bonus crédité : ${formatMoney(res.bonus, currency)}`);
      setOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec du calcul du bonus"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-slate-900">
        {r.creatorName}
      </TableCell>
      <TableCell className="text-slate-700">{r.formatName}</TableCell>
      <TableCell className="text-sm text-slate-500">
        {r.postCount} post{r.postCount > 1 ? "s" : ""}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {r.latestViews !== null ? (
          nf.format(r.latestViews)
        ) : (
          <span className="text-xs text-slate-400">aucun snapshot</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {r.existingBonus !== null ? formatMoney(r.existingBonus, currency) : "—"}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          onClick={openDialog}
          disabled={!r.hasSnapshot}
          title={
            r.hasSnapshot
              ? undefined
              : "Aucun snapshot de vues pour cette publication"
          }
        >
          <TrendingUpIcon className="mr-2 size-4" />
          {r.existingBonus !== null ? "Recalculer" : "Calculer le bonus"}
        </Button>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bonus de vues — {r.creatorName}</DialogTitle>
              <DialogDescription>
                Prérempli avec les vues du dernier snapshot. Le montant est
                calculé serveur depuis le tarif figé de l&apos;assignment (un
                seul bonus par post — recalculer remplace la ligne).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="bonus-views">Vues</Label>
              <Input
                id="bonus-views"
                type="number"
                min={0}
                value={views}
                onChange={(e) => setViews(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button onClick={onCompute} disabled={busy}>
                {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                {r.existingBonus !== null ? "Recalculer" : "Calculer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}
