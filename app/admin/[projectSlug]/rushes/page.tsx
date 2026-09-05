"use client";

import { useState } from "react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ExternalLinkIcon, FilmIcon, InboxIcon } from "lucide-react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { formatBytes } from "@/lib/snytch-drive";
import { formatDate } from "@/lib/format";
import type { RushStatus } from "@/convex/rushStatus";
import { AssignScriptToRushDialog } from "@/components/rushes/AssignScriptToRushDialog";
import { TalentSettingsCard } from "@/components/rushes/TalentSettingsCard";
import { usePermissions } from "@/components/project/use-permissions";

/**
 * REVUE DES RUSHES (admin) — décider de chaque prise déposée par un talent :
 * la monter (assigner un script) ou l'écarter (avec un motif).
 *
 * Patron repris de l'écran de validation des vidéos : une carte par élément, les
 * actions à droite, l'historique en dessous. Desktop, comme le reste de l'admin
 * (assumé : la revue de rushes se fait au bureau).
 *
 * PREVIEW — `thumbnailLink` / `webViewLink` de Drive, déjà stockés au dépôt
 * (D4 phase 1). Pas de lecteur inline : Cloudflare Stream en upload direct est
 * une phase 2, conditionnée à une vérification du jeton. La miniature suffit à
 * reconnaître une prise ; le lien Drive s'ouvre pour la regarder.
 */

const STATUS_VARIANT: Record<
  RushStatus,
  "secondary" | "default" | "outline" | "destructive"
> = {
  deposited: "secondary",
  assigned: "default",
  published: "default",
  rejected: "destructive",
  expired: "outline",
};

/** Vocabulaire ADMIN — distinct de celui du talent, qui lit « Validé ». */
const ADMIN_STATUS_LABELS: Record<RushStatus, string> = {
  deposited: "À traiter",
  assigned: "Script monté",
  published: "Publié",
  rejected: "Refusé",
  expired: "Expiré",
};

type RushRow = {
  id: Id<"rushes">;
  fileName: string;
  sizeBytes: number;
  status: RushStatus;
  depositedAt: number;
  webViewLink: string | null;
  thumbnailLink: string | null;
  rejectionReason: string | null;
  talentName: string;
  clipperId: Id<"creators"> | null;
  clipperName: string | null;
};

function RejectDialog({
  rush,
  open,
  onOpenChange,
}: {
  rush: RushRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const reject = useProjectMutation(api.rushes.rejectRush);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reason.trim().length === 0) return;
    setBusy(true);
    try {
      await reject({ rushId: rush.id, reason });
      toast.success("Rush refusé — le talent voit le motif.");
      onOpenChange(false);
      setReason("");
    } catch (e) {
      toast.error(
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : "Refus impossible.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refuser cette prise</DialogTitle>
          <DialogDescription>
            {rush.talentName} — {rush.fileName}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="rush-reject-reason">Motif du refus *</Label>
          <Textarea
            id="rush-reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Ex. : cadrage trop serré, on ne voit pas le produit. Refais-la face à la fenêtre."
          />
          {/*
            LE POINT DE CET ÉCRAN. Le motif franchit une frontière de rôle : il
            est écrit ici et lu tel quel dans l'espace du talent. Sans cette
            phrase, l'admin écrit une note interne sans le savoir.
          */}
          <p className="text-xs font-medium text-amber-700">
            Visible par le talent — écris-le comme si tu t&apos;adressais à
            {" "}
            {rush.talentName}.
          </p>
          <p className="text-xs text-slate-400">
            {reason.trim().length}/500 · le fichier sera supprimé du stockage,
            l&apos;historique du dépôt est conservé.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy || reason.trim().length === 0}
          >
            Refuser
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RushCard({ rush }: { rush: RushRow }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const actionable = rush.status === "deposited";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start">
        {/* Miniature Drive — reconnaître la prise sans la télécharger. */}
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {rush.thumbnailLink ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={rush.thumbnailLink}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <FilmIcon className="size-8 text-slate-300" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-900">
              {rush.fileName}
            </p>
            <Badge variant={STATUS_VARIANT[rush.status]}>
              {ADMIN_STATUS_LABELS[rush.status]}
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            {rush.talentName} · {formatDate(rush.depositedAt)} ·{" "}
            {formatBytes(rush.sizeBytes)}
          </p>
          <p className="text-xs text-slate-400">
            {rush.clipperName
              ? `Clippeur : ${rush.clipperName}`
              : "Aucun clippeur apparié à ce talent"}
          </p>
          {rush.rejectionReason && (
            <p className="whitespace-pre-wrap break-words pt-1 text-xs text-red-600">
              {rush.rejectionReason}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {rush.webViewLink && (
            <a
              href={rush.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExternalLinkIcon className="size-3.5" />
              Voir
            </a>
          )}
          {actionable && (
            <>
              <Button
                size="sm"
                onClick={() => setAssignOpen(true)}
                disabled={rush.clipperId === null}
                title={
                  rush.clipperId === null
                    ? "Apparie d'abord ce talent à un clippeur"
                    : undefined
                }
              >
                Monter un script
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectOpen(true)}
              >
                Refuser
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <RejectDialog
        rush={rush}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
      />
      {rush.clipperId && (
        <AssignScriptToRushDialog
          rushId={rush.id}
          talentName={rush.talentName}
          clipperId={rush.clipperId}
          clipperName={rush.clipperName ?? ""}
          open={assignOpen}
          onOpenChange={setAssignOpen}
        />
      )}
    </Card>
  );
}

export default function RushesPage() {
  const droitsNav = usePermissions();
  const rushes = useProjectQuery(api.rushes.listRushesForReview, {});
  const waiting = (rushes ?? []).filter((r) => r.status === "deposited");
  const treated = (rushes ?? []).filter((r) => r.status !== "deposited");

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Rushes
        </h1>
        <p className="text-sm text-slate-500">
          {rushes === undefined
            ? "Chargement…"
            : `${waiting.length} prise${waiting.length > 1 ? "s" : ""} en attente de décision`}
        </p>
      </header>

      {/* Réglages de l'espace TALENT = réglage de PROJET. Le manager trie les
          Rushes sans décider de la configuration de l'espace. */}
      {droitsNav.has("project.settings") && <TalentSettingsCard />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          À traiter
        </h2>
        {rushes === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : waiting.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <InboxIcon className="size-10 text-slate-300" strokeWidth={1.5} />
              <p className="text-sm text-slate-500">
                Aucune prise en attente. Les dépôts des talents arrivent ici.
              </p>
            </CardContent>
          </Card>
        ) : (
          waiting.map((r) => <RushCard key={r.id} rush={r as RushRow} />)
        )}
      </section>

      {treated.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Traitées
          </h2>
          {treated.map((r) => (
            <RushCard key={r.id} rush={r as RushRow} />
          ))}
        </section>
      )}
    </div>
  );
}
