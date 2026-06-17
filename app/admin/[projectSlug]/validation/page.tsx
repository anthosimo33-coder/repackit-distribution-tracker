"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import {
  CheckIcon,
  XIcon,
  Loader2Icon,
  ExternalLinkIcon,
  TrendingUpIcon,
  InboxIcon,
} from "lucide-react";

type VideoSubmittedRow =
  FunctionReturnType<typeof api.assignments.listVideoSubmitted>[number];
type PublishedRow =
  FunctionReturnType<typeof api.assignments.listPublished>[number];
type BonusRowData =
  FunctionReturnType<typeof api.assignments.listValidatedForBonus>[number];

/**
 * File de validation admin. La REVUE VIDÉO vient AVANT publication :
 *  1. « Vidéos à valider » : assignments en video_submitted, MP4 lisible in-app
 *     (controlsList nodownload). Valider → to_publish (notif créateur, AUCUN
 *     paiement ici). Refuser → feedback obligatoire → video_rejected.
 *  2. « Publiées récemment » : assignments passés en published (URL).
 *  3. « Bonus de vues » : assignments publiés avec snapshots → calcul du bonus.
 */

const nf = new Intl.NumberFormat("fr-FR");
const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    n,
  );
const formatDate = (ts: number) => new Date(ts).toLocaleDateString("fr-FR");

export default function ValidationPage() {
  const toReview = useProjectQuery(api.assignments.listVideoSubmitted, {});
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
                    <BonusRow key={r.assignmentId} r={r} />
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
      toast.error(e instanceof Error ? e.message : "Erreur");
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
      toast.error(e instanceof Error ? e.message : "Erreur");
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

        {a.videoUrl && a.videoStorageId ? (
          <VideoExample
            example={{
              kind: "file",
              storageId: a.videoStorageId,
              title: "",
              mimeType: a.videoMimeType,
              url: a.videoUrl,
            }}
          />
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-400">
            Vidéo indisponible.
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

function BonusRow({ r }: { r: BonusRowData }) {
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
      toast.success(`Bonus crédité : ${eur(res.bonus)}`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
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
        {r.existingBonus !== null ? eur(r.existingBonus) : "—"}
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
