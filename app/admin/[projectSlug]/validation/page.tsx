"use client";

import { useMemo, useState } from "react";
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

type SubmittedAssignment =
  FunctionReturnType<typeof api.assignments.listAssignments>[number];
type BonusRowData =
  FunctionReturnType<typeof api.assignments.listValidatedForBonus>[number];

/**
 * P8 — File de validation admin. Deux sections :
 *  1. « À valider » : assignments soumis (preview de l'URL via VideoExample) →
 *     Valider (matérialise la publication + crédite le paiement) / Rejeter
 *     (feedback obligatoire, resoumission créateur ensuite possible).
 *  2. « Bonus de vues » : assignments validés avec snapshots → calcul (manuel)
 *     du bonus, prérempli avec les vues du dernier snapshot.
 */

const PLATFORM_MAP: Record<string, "tiktok" | "youtube" | "instagram"> = {
  TikTok: "tiktok",
  Instagram: "instagram",
  YouTube: "youtube",
};

const nf = new Intl.NumberFormat("fr-FR");
const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    n,
  );
const formatDate = (ts: number) => new Date(ts).toLocaleDateString("fr-FR");

export default function ValidationPage() {
  const assignments = useProjectQuery(api.assignments.listAssignments, {});
  const bonusRows = useProjectQuery(api.assignments.listValidatedForBonus, {});

  const submitted = useMemo(
    () =>
      (assignments ?? [])
        .filter((a) => a.status === "submitted")
        .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)),
    [assignments],
  );

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Validation
        </h1>
        <p className="text-sm text-slate-500">
          {assignments === undefined
            ? "Chargement…"
            : `${submitted.length} post${submitted.length > 1 ? "s" : ""} en attente de validation`}
        </p>
      </header>

      {/* ─── À valider ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          À valider
        </h2>
        {assignments === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : submitted.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <InboxIcon className="size-10 text-slate-300" strokeWidth={1.5} />
              <p className="text-sm text-slate-500">
                Aucun post en attente. Les soumissions des créateurs
                apparaîtront ici.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {submitted.map((a) => (
              <SubmittedCard key={a._id} a={a} />
            ))}
          </div>
        )}
      </section>

      {/* ─── Bonus de vues ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Bonus de vues
        </h2>
        {bonusRows === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : bonusRows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              Aucun post validé pour l&apos;instant.
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
                    <TableHead>Publication</TableHead>
                    <TableHead className="text-right">Dernières vues</TableHead>
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

function SubmittedCard({ a }: { a: SubmittedAssignment }) {
  const validate = useProjectMutation(api.assignments.validateAssignment);
  const reject = useProjectMutation(api.assignments.rejectAssignment);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const platform = a.submittedPlatform
    ? PLATFORM_MAP[a.submittedPlatform]
    : null;

  async function onValidate() {
    setBusy(true);
    try {
      const r = await validate({ id: a._id });
      toast.success(
        r.alreadyValidated
          ? "Déjà validé."
          : "Validé — publication créée et paiement crédité.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (feedback.trim().length === 0) {
      toast.error("Un motif de rejet est requis.");
      return;
    }
    setBusy(true);
    try {
      await reject({ id: a._id, feedback });
      toast.success("Rejeté — le créateur peut resoumettre.");
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
            <div className="text-sm text-slate-500">{a.formatName}</div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>Échéance {formatDate(a.dueDate)}</div>
            {a.submittedAt && <div>Soumis {formatDate(a.submittedAt)}</div>}
          </div>
        </div>

        {a.submittedUrl && platform ? (
          <VideoExample
            example={{
              kind: "url",
              url: a.submittedUrl,
              platform,
              title: "",
            }}
          />
        ) : a.submittedUrl ? (
          <a
            href={a.submittedUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Voir le post soumis
            <ExternalLinkIcon className="size-3.5" />
          </a>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button
            onClick={onValidate}
            disabled={busy}
            className="flex-1"
            data-testid={`validate-${a._id}`}
          >
            {busy ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <CheckIcon className="mr-2 size-4" />
            )}
            Valider
          </Button>
          <Button
            variant="outline"
            onClick={() => setRejectOpen(true)}
            disabled={busy}
            className="flex-1"
          >
            <XIcon className="mr-2 size-4" />
            Rejeter
          </Button>
        </div>
      </CardContent>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter — {a.creatorName}</DialogTitle>
            <DialogDescription>
              Le motif est visible par le créateur, qui pourra corriger et
              resoumettre.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-feedback">Motif du rejet</Label>
            <Textarea
              id="reject-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ex. mauvais format, hook hors brief, vidéo coupée…"
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
              Rejeter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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
      <TableCell className="font-mono text-sm text-slate-500">
        {r.carouselId ?? "—"}
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
