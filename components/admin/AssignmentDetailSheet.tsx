"use client";

import { useState, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { fr } from "date-fns/locale";
import {
  CalendarIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  Loader2Icon,
  RepeatIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { cn } from "@/lib/utils";
import { convexErrorMessage } from "@/lib/convex-error";
import { calendarStatus, type CalendarStatus } from "@/lib/calendar-status";
import { CALENDAR_STATUS_META } from "@/components/calendar/calendar-status-meta";
import {
  ASSIGNMENT_STATUS,
  type AssignmentStatus,
} from "@/lib/assignment-status";
import { AdminPublishForm } from "@/components/admin/AdminPublishForm";
import { AssignmentAttachments } from "@/components/admin/AssignmentAttachments";
import { ReplayScriptLauncher } from "@/components/admin/ReplayScriptLauncher";
import { ImposedComboBadge } from "@/components/admin/ImposedComboBadge";
import { dayStartMs } from "@/components/admin/AssignmentPlanningCalendar";
import { countryFlag } from "@/lib/countries";

/** Row LIVE de listAssignments (dérivée côté page → réactive : statut/pub à jour). */
type AssignmentRow =
  FunctionReturnType<typeof api.assignments.listAssignments>[number];

const formatDate = (ts: number) => new Date(ts).toLocaleDateString("fr-FR");

/**
 * Panneau de DÉTAIL d'une assignation, ouvert au clic sur un post du calendrier de
 * pilotage (page Assignments). Montre le SCRIPT (même donnée que la page Validation
 * / le brief créateur), le contexte (créatrice, compte/plateforme, date de post,
 * statut calendrier, échéance de prod), et — pour un COMPTE GÉRÉ prêt à publier —
 * la saisie du lien + « Publier » via la MÊME mutation que la page Validation
 * (AdminPublishForm → confirmPublicationAsAdmin). La date de post reste éditable.
 *
 * Aucune logique de statut/paie ici : on LIT postDate/postedAt et on affiche le
 * statut calendrier PUR (lib/calendar-status). La `row` étant re-dérivée live côté
 * page, publier ou replanifier recalcule la pastille SANS rechargement manuel.
 *
 * Compte de CRÉATRICE : la publication reste son geste (depuis son espace) — le
 * panneau montre alors l'état en lecture seule (pas de chemin de publication admin
 * inventé, cf. décision cadrée).
 */
export function AssignmentDetailSheet({
  open,
  onOpenChange,
  row,
  now,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: AssignmentRow;
  now: number;
}) {
  const setPostDate = useProjectMutation(api.assignments.setAssignmentPostDate);
  const [dateOpen, setDateOpen] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  // « Rejouer ce script » : ouvre la modale d'assignation pré-remplie depuis CETTE
  // assignation (lignage replayedFrom = row._id). Réservé aux assignations script.
  const [replayOpen, setReplayOpen] = useState(false);

  const label = row.scriptCampaignName ?? row.formatName ?? "—";
  const platforms = row.targets.map((t) => t.platform);
  const status = calendarStatus({
    postDate: row.postDate,
    postedAt: row.postedAt,
    now,
  });
  const script =
    row.origin === "script" ? (row.scriptCombo?.assembledScript ?? null) : null;

  async function saveDate(next: number | undefined) {
    setSavingDate(true);
    try {
      await setPostDate({ id: row._id, postDate: next });
      toast.success(
        next
          ? "Date de publication mise à jour."
          : "Date de publication retirée.",
      );
      setDateOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setSavingDate(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-lg"
        data-testid="assignment-detail-sheet"
      >
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle className="break-words">{row.creatorName}</SheetTitle>
          <SheetDescription>
            {label}
            {platforms.length > 0 ? ` · ${platforms.join(", ")}` : ""}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2">
            {row.comboImposed && <ImposedComboBadge className="mt-1" />}
            {row.origin === "script" && (
              <Button
                variant="outline"
                size="xs"
                className="mt-1 w-fit gap-1.5"
                onClick={() => setReplayOpen(true)}
              >
                <RepeatIcon className="size-3.5" />
                Rejouer ce script
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* « Rejouer ce script » — résout le combo de CETTE assignation et ouvre
            la modale d'assignation pré-remplie (par-dessus le panneau). */}
        <ReplayScriptLauncher
          source={replayOpen ? { assignmentId: row._id } : null}
          onClose={() => setReplayOpen(false)}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          {/* Contexte */}
          <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
            <DetailRow label="Compte">
              {row.targets.length === 0 ? (
                <span className="text-slate-400">—</span>
              ) : (
                <div className="space-y-0.5">
                  {row.targets.map((t) => {
                    const flag = countryFlag(t.country);
                    return (
                      <div
                        key={t.platform}
                        className="flex items-center gap-1.5"
                      >
                        <span className="text-xs text-slate-400">
                          {t.platform}
                        </span>
                        {flag && <span aria-hidden>{flag}</span>}
                        <span className="font-mono text-slate-600">
                          {t.accountHandle ?? "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </DetailRow>

            <DetailRow label="Statut calendrier">
              <CalendarStatusPill status={status} />
            </DetailRow>

            <DetailRow label="Date de post">
              <PostDatePopover
                open={dateOpen}
                onOpenChange={setDateOpen}
                postDate={row.postDate}
                saving={savingDate}
                onSelect={(d) => void saveDate(dayStartMs(d))}
                onClear={() => void saveDate(undefined)}
              />
            </DetailRow>

            <DetailRow label="Échéance prod.">
              <span className="text-slate-700">{formatDate(row.dueDate)}</span>
            </DetailRow>

            <DetailRow label="Production">
              <ProductionStatusBadge status={row.status as AssignmentStatus} />
            </DetailRow>
          </dl>

          {/* Script à publier (même donnée que Validation / brief créateur) */}
          {script ? (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <FileTextIcon className="size-4 text-slate-400" />
                Script à publier
              </h3>
              <div
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                data-testid="assignment-detail-script"
              >
                <SimpleMarkdown content={script} />
              </div>
            </section>
          ) : (
            <p className="text-sm text-slate-400">
              Pas de script monté pour cet assignment.
            </p>
          )}

          {/* Assets + vidéos modèles rattachés (mêmes données que le brief
              créateur). Rendu UNIQUEMENT s'il y en a (aucun bloc vide). */}
          <AssignmentAttachments
            assetFolderNames={row.assetFolderNames}
            assetFolderCount={row.assetFolderCount}
            modelVideos={row.modelVideos ?? []}
            variant="panel"
          />

          {/* Publication */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">Publication</h3>
            <PublicationSection row={row} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function CalendarStatusPill({ status }: { status: CalendarStatus }) {
  if (status === "none") {
    return <span className="text-slate-400">Non planifié</span>;
  }
  const meta = CALENDAR_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        meta.chip,
      )}
    >
      <meta.Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function ProductionStatusBadge({ status }: { status: AssignmentStatus }) {
  const st = ASSIGNMENT_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        st.className,
      )}
    >
      {st.label}
    </span>
  );
}

function PostDatePopover({
  open,
  onOpenChange,
  postDate,
  saving,
  onSelect,
  onClear,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  postDate?: number;
  saving: boolean;
  onSelect: (d: Date) => void;
  onClear: () => void;
}) {
  const selected = postDate ? new Date(postDate) : undefined;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 justify-start gap-1.5 font-normal"
            aria-label="Modifier la date de publication"
          >
            <CalendarIcon className="size-4" />
            {postDate ? formatDate(postDate) : "Planifier"}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => d && onSelect(d)}
          locale={fr}
          weekStartsOn={1}
          defaultMonth={selected}
        />
        <div className="border-t border-slate-100 p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-slate-500"
            onClick={onClear}
            disabled={saving || postDate === undefined}
          >
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Retirer la date
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Bloc PUBLICATION du panneau. DEUX cas seulement :
 *  - déjà publié (géré OU créatrice, statut published/paid) → liens en lecture seule ;
 *  - TOUT le reste (non publié, quel que soit le statut de production, géré OU
 *    créatrice) → saisie du lien via AdminPublishForm. Si le statut n'est pas
 *    `to_publish`, le formulaire AVERTIT que la saisie passe direct en publiée —
 *    jamais un blocage : l'admin colle le lien en secours quand le process n'a pas
 *    été suivi (post publié hors app, statut resté « À faire »).
 */
function PublicationSection({ row }: { row: AssignmentRow }) {
  const managed = row.managedByAdmin === true;
  const isPublished = row.status === "published" || row.status === "paid";
  const publishedTargets = row.targets.filter((t) => t.publishedUrl);

  if (isPublished) {
    return (
      <div className="space-y-2" data-testid="detail-publication-published">
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2Icon className="size-4 shrink-0" />
          {row.status === "paid" ? "Publié et payé ✓" : "Publié ✓"}
        </div>
        {publishedTargets.map((t) => (
          <a
            key={t.platform}
            href={t.publishedUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Voir le post {t.platform}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        ))}
        <PublishedByLine publishedBy={row.publishedBy} at={row.postedAt} />
      </div>
    );
  }

  // TOUTE assignation NON encore publiée → saisie du lien disponible (le SEUL cas
  // masqué, « déjà publiée », est traité au-dessus), QUEL QUE SOIT le statut de
  // production — compte géré comme compte de créatrice. Le cas d'usage EST que le
  // process n'a pas été suivi (post publié hors app, statut resté « À faire »).
  // AdminPublishForm affiche un AVERTISSEMENT quand le statut n'est pas `to_publish`
  // (la saisie passe direct en publiée) ; jamais un blocage, l'admin décide.
  return (
    <AdminPublishForm
      assignmentId={row._id}
      targets={row.targets}
      managed={managed}
      notReady={row.status !== "to_publish"}
      buttonTestId={`detail-${managed ? "managed" : "creator-backup"}-publish-${row._id}`}
    />
  );
}

/**
 * Traçabilité de la saisie du lien : « la créatrice » / « l'admin » / inconnu (—).
 * ABSENT sur tout l'historique d'avant `publishedBy` → tiret, JAMAIS « créatrice »
 * par défaut (inventerait une info). La date (postedAt) peut exister même quand
 * l'auteur est inconnu — on l'affiche alors avec le tiret.
 */
function PublishedByLine({
  publishedBy,
  at,
}: {
  publishedBy?: "creator" | "admin";
  at: number | null;
}) {
  const who =
    publishedBy === "creator"
      ? "la créatrice"
      : publishedBy === "admin"
        ? "l'admin"
        : null;
  const date =
    at != null
      ? new Date(at).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
        })
      : null;
  return (
    <p className="text-xs text-slate-500" data-testid="detail-published-by">
      Lien saisi par{" "}
      <span className={who ? "font-medium text-slate-600" : "text-slate-400"}>
        {who ?? "—"}
      </span>
      {date ? ` le ${date}` : ""}.
    </p>
  );
}
