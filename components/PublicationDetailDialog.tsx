"use client";

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
import { VerdictBadge, PlatformBadge } from "@/components/VerdictBadge";
import {
  calculateAuditConversion,
  calculateSaveRate,
  calculateVerdict,
  formatNumber,
  formatPercent,
} from "@/lib/verdict";

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
  const saveRate = calculateSaveRate(publication.saves, publication.vuesJ7);
  const verdict = calculateVerdict(saveRate);
  const auditConv = calculateAuditConversion(
    publication.commentsAudit,
    publication.vuesJ7,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
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
                  <span className="text-slate-700">
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
