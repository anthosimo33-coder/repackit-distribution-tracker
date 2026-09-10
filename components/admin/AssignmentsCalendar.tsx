"use client";

import { useMemo, useState } from "react";
import {
  formatPostWindow,
  formatWindowStart,
  compareByWindowStart,
} from "@/convex/postWindow";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import {
  Building2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  UserRoundIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useIsCompact } from "@/lib/use-media-query";
import {
  calendarStatus,
  isPastPost,
  isSameLocalDay,
  type CalendarStatus,
} from "@/lib/calendar-status";
import {
  CALENDAR_STATUS_META,
  type CalendarStatusVisual,
} from "@/components/calendar/calendar-status-meta";
import { countryFlag } from "@/lib/countries";
import { useLabel } from "@/lib/use-label";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Ligne d'assignment minimale attendue par le calendrier (sous-ensemble du
 *  retour listAssignments — passer la row complète est compatible). */
export type CalendarAssignmentRow = {
  _id: Id<"assignments">;
  creatorId: string;
  creatorName: string;
  /** Fuseau de la créatrice — `null`/absent = inconnu ⇒ repli sur Paris. */
  creatorTimezone?: string | null;
  formatName: string | null;
  scriptCampaignName?: string | null;
  postDate?: number;
  /** Créneau horaire (#56) — heure de début sur la vignette, créneau complet au survol. */
  postWindow?: { startMin: number; endMin: number };
  postedAt: number | null;
  // Compte GÉRÉ par l'équipe (dénormalisé) → marqueur géré/créatrice sur la pastille.
  managedByAdmin?: boolean;
  // Cibles (1 vidéo → N posts) : plateforme + compte (handle + pays) + URL publiée.
  targets: {
    platform: string;
    accountHandle: string | null;
    country?: string | null;
    publishedUrl?: string | null;
  }[];
};

/** Filtre de STATUT CALENDRIER (brique B) partagé depuis la page. */
export type CalendarStatusFilter = CalendarStatusVisual | "all";

// Pastille d'IDENTITÉ créatrice (couleur stable par créateur, ≠ statut).
const CREATOR_DOTS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-lime-600",
];
function creatorDot(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CREATOR_DOTS[h % CREATOR_DOTS.length];
}

const ON_TIME_THRESHOLD = 0.8; // sous ce taux → alerte visuelle.

function rowLabel(r: CalendarAssignmentRow): string {
  return r.scriptCampaignName ?? r.formatName ?? "—";
}

/** Handle affiché préfixé « @ » (les handles sont stockés sans). */
function atHandle(h: string | null): string | null {
  if (!h) return null;
  return h.startsWith("@") ? h : `@${h}`;
}

/**
 * Vue CALENDRIER de pilotage (brique C + améliorations), fusionnée dans la page
 * Assignments. Place chaque assignment AYANT une date de post (postDate) sur son
 * jour. La pastille montre, AVANT le clic : la créatrice (pastille couleur), le
 * STATUT calendrier (couleur + icône), le COMPTE ciblé (drapeau pays + @handle,
 * pour distinguer FR/US), un marqueur GÉRÉ (équipe) vs CRÉATRICE, et un accès
 * rapide au lien de la publication si publiée. En tête : rappel « aujourd'hui » +
 * stats. Un filtre de statut calendrier (depuis la page) restreint l'affichage.
 * Stats/rappel restent calculés sur les rows FILTRÉES (créateur/format), pas sur le
 * filtre de statut (qui ne fait que masquer des pastilles). Clic sur un post → onOpen.
 */
export function AssignmentsCalendar({
  rows,
  now,
  onOpen,
  statusFilter = "all",
}: {
  rows: CalendarAssignmentRow[];
  now: number;
  onOpen: (id: Id<"assignments">) => void;
  statusFilter?: CalendarStatusFilter;
}) {
  const tLabel = useLabel();
  const [currentMonth, setCurrentMonth] = useState(() => new Date(now));
  // Sous 768 px, une case de la grille fait ~46 px de large : la vignette
  // détaillée (nom + @compte + drapeau) y devient une colonne de pictogrammes
  // illisibles. La grille passe alors en DENSITÉ (numéro + pastilles de statut)
  // et le détail du jour s'ouvre dans un panneau, à pleine largeur.
  const compact = useIsCompact();
  const [dayKey, setDayKey] = useState<string | null>(null);

  // Rows planifiées (avec date de post) + leur statut calendrier.
  const planned = useMemo(
    () =>
      rows
        .filter((r) => r.postDate != null)
        .map((r) => ({
          row: r,
          status: calendarStatus({
            postDate: r.postDate,
            postedAt: r.postedAt,
            now,
            // Le verdict se prend dans le fuseau de la CRÉATRICE : une
            // publication du 8 au soir à New York n'est pas « en retard » parce
            // qu'il est déjà le 9 à Paris.
            timeZone: r.creatorTimezone,
          }) as Exclude<CalendarStatus, "none">,
        })),
    [rows, now],
  );

  // Filtre de statut calendrier (B) : masque les pastilles hors statut. Les stats
  // et le rappel « aujourd'hui » restent sur l'ensemble `planned` (sinon le taux
  // devient trivial : filtrer « en retard » donnerait 0 % à l'heure).
  const visible = useMemo(
    () =>
      statusFilter === "all"
        ? planned
        : planned.filter((p) => p.status === statusFilter),
    [planned, statusFilter],
  );

  // Le dénominateur vient d'`isPastPost` (convex/calendarStatus) et non d'une
  // somme écrite ici : les notifications de retard affichent le MÊME taux, et
  // deux définitions du « passé » finiraient par ne plus compter la même chose.
  /**
   * Livrables SANS DATE DE PUBLICATION — hors de `planned`, donc absents des
   * quatre compteurs. Sur Snytch : 21 sur 492, dont cinq pas encore publiés,
   * c'est-à-dire du travail qui n'apparaît dans aucune journée et ne pourra
   * donc JAMAIS devenir « en retard ». L'en-tête annonçait 492 pendant que les
   * cartes en totalisaient 471, sans que rien n'explique l'écart.
   */
  const sansDate = useMemo(() => {
    const nus = rows.filter((r) => r.postDate == null);
    return {
      total: nus.length,
      aFaire: nus.filter((r) => r.postedAt == null).length,
    };
  }, [rows]);

  const stats = useMemo(() => {
    let onTime = 0;
    let late = 0;
    let missed = 0;
    let scheduled = 0;
    let past = 0;
    for (const { status } of planned) {
      if (isPastPost(status)) past++;
      if (status === "on_time") onTime++;
      else if (status === "late") late++;
      else if (status === "missed") missed++;
      else scheduled++;
    }
    return {
      onTime,
      late,
      missed,
      scheduled,
      past,
      rate: past > 0 ? onTime / past : null,
    };
  }, [planned]);

  // Rappel ADMIN « aujourd'hui » (pendant du « je poste quoi ? » créatrice) : posts
  // planifiés aujourd'hui et PAS encore publiés (= à publier). Sur `planned` (filtres
  // créateur/format appliqués), indépendant du filtre de statut.
  const todayToPublish = useMemo(
    () =>
      planned.filter(
        ({ row }) => row.postDate != null && isSameLocalDay(row.postDate, now) && row.postedAt == null,
      ).length,
    [planned, now],
  );

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(currentMonth), {
      weekStartsOn: 1,
    });
    const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const byDay = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const item of visible) {
      const key = format(new Date(item.row.postDate!), "yyyy-MM-dd");
      const arr = map.get(key);
      if (arr) arr.push(item);
      else map.set(key, [item]);
    }
    // ORDRE INTRA-JOUR : une case se lit comme une journée — midi en haut, soir
    // en bas. Sans ce tri l'ordre suivait l'ordre d'arrivée de la liste, qui n'a
    // aucun rapport avec l'heure de publication. Les sans-créneau finissent
    // derniers (pas d'heure ⇒ pas de place dans la chronologie).
    for (const arr of map.values()) {
      arr.sort((x, y) => compareByWindowStart(x.row, y.row));
    }
    return map;
  }, [visible]);

  /** Posts du jour ouvert dans le panneau (téléphone). */
  const dayItems = dayKey ? (byDay.get(dayKey) ?? []) : [];

  const rateAlert = stats.rate != null && stats.rate < ON_TIME_THRESHOLD;
  const statusLabel =
    statusFilter === "all" ? null : tLabel(CALENDAR_STATUS_META[statusFilter].labelKey);

  return (
    <div className="space-y-4">
      {/* Rappel « aujourd'hui » — pendant admin du « je poste quoi ? » créatrice. */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm",
          todayToPublish > 0
            ? "border-primary/30 bg-primary/5 text-slate-800"
            : "border-slate-200 bg-slate-50 text-slate-500",
        )}
        data-testid="calendar-today-reminder"
      >
        {todayToPublish > 0 ? (
          <>
            <span aria-hidden>📌</span>
            <span>
              Aujourd&apos;hui :{" "}
              <span className="font-semibold text-slate-900">
                {todayToPublish}
              </span>{" "}
              post{todayToPublish > 1 ? "s" : ""} à publier
            </span>
          </>
        ) : (
          <span>Rien à publier aujourd&apos;hui.</span>
        )}
      </div>

      {/* Stats de pilotage — recalculées selon les filtres partagés. Denses sur
          téléphone : à pleine taille, les quatre cartes mangeaient un écran
          entier AVANT le calendrier, qui est pourtant le sujet de la page. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Card
          className={cn(
            rateAlert && "border-rose-300",
            stats.rate != null && !rateAlert && "border-emerald-300",
          )}
        >
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-500">
              Taux à l&apos;heure
            </div>
            <div
              className={cn(
                "mt-0.5 text-xl font-semibold sm:mt-1 sm:text-2xl",
                stats.rate == null
                  ? "text-slate-400"
                  : rateAlert
                    ? "text-rose-600"
                    : "text-emerald-600",
              )}
            >
              {stats.rate == null
                ? "—"
                : `${Math.round(stats.rate * 100)}%`}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {`${stats.onTime}/${stats.past} post${stats.past > 1 ? "s" : ""} passé${stats.past > 1 ? "s" : ""}`}
            </div>
            {/* Le taux passe au rouge sous un seuil — autant dire lequel. Sans
                cette ligne, « 65 % » portait un jugement dont la règle
                n'existait que dans une constante du fichier. */}
            <div className="text-xs text-slate-400">
              {`objectif ${Math.round(ON_TIME_THRESHOLD * 100)} %`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-500">À l&apos;heure</div>
            <div className="mt-0.5 text-xl font-semibold text-emerald-600 sm:mt-1 sm:text-2xl">
              {stats.onTime}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-500">
              En retard + manqués
            </div>
            <div className="mt-0.5 text-xl font-semibold text-rose-600 sm:mt-1 sm:text-2xl">
              {stats.late + stats.missed}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {stats.late} en retard · {stats.missed} manqué
              {stats.missed > 1 ? "s" : ""}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-medium text-slate-500">À venir</div>
            <div className="mt-0.5 text-xl font-semibold text-slate-700 sm:mt-1 sm:text-2xl">
              {stats.scheduled}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Le jour de référence est épinglé sur Paris, pas sur le fuseau du
          navigateur : les dates de post sont posées à minuit Paris et les
          notifications de retard tournent côté serveur. Dit en clair parce qu'un
          poste réglé sur un autre fuseau voyait AVANT des statuts différents —
          sans cette ligne, le décalage se découvre par un ticket. */}
      <p className="text-xs text-slate-400">
        Statuts calculés en heure de Paris.
        {sansDate.total > 0 &&
          ` ${sansDate.total} livrable${sansDate.total > 1 ? "s" : ""} sans date de publication ${sansDate.total > 1 ? "ne sont" : "n'est"} dans aucun de ces compteurs${
            sansDate.aFaire > 0
              ? ` — dont ${sansDate.aFaire} pas encore publié${sansDate.aFaire > 1 ? "s" : ""}, donc ${sansDate.aFaire > 1 ? "invisibles" : "invisible"} du calendrier`
              : ""
          }.`}
      </p>

      {/* LÉGENDE — sur les deux formats.
          Elle n'était rendue qu'en compact, au motif que la vignette large
          « porte déjà son icône ET son libellé au survol ». L'icône, oui —
          mais pas le MOT : sur la grande grille, quatre teintes et quatre
          pictogrammes se décodent une vignette à la fois, au survol, sur
          une page qui en affiche plusieurs centaines.
          Et surtout, le marqueur de PROPRIÉTÉ (qui publie : l'équipe ou la
          créatrice) n'était expliqué NULLE PART, dans aucun des deux
          formats — alors que c'est lui qui dit à qui incombe le geste. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {(
          ["on_time", "late", "missed", "scheduled"] as CalendarStatusVisual[]
        ).map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                CALENDAR_STATUS_META[s].dot,
              )}
              aria-hidden
            />
            {tLabel(CALENDAR_STATUS_META[s].labelKey)}
          </span>
        ))}
        <span className="text-slate-300" aria-hidden>
          ·
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
          <UserRoundIcon className="size-3 shrink-0 opacity-60" aria-hidden />
          compte créatrice (elle publie)
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Building2Icon className="size-3 shrink-0 opacity-60" aria-hidden />
          compte géré (tu publies)
        </span>
      </div>

      {/* Grille mensuelle */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold capitalize text-slate-900">
              {/* i18n-exempt: « MMMM yyyy » est un MASQUE date-fns, pas du texte — la langue du rendu vient de la locale passée à format(), jamais de cette chaîne. */}
              {format(currentMonth, "MMMM yyyy", { locale: fr })}
            </h2>
            <div className="flex items-center gap-1">
              {/* Cible tactile : 40 px sur téléphone (28 px au doigt, c'est un
                  changement de mois sur deux qui rate). */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-10 sm:size-7"
                aria-label="Mois précédent"
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-10 sm:size-7"
                aria-label="Mois suivant"
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="pb-1 text-center text-[11px] font-medium text-slate-400"
              >
                {w}
              </div>
            ))}
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const items = byDay.get(key) ?? [];
              const inMonth = isSameMonth(day, currentMonth);
              const today = isToday(day);

              // ── Téléphone : la case est un RÉSUMÉ cliquable ────────────────
              // Numéro + une pastille par post (couleur du statut, plafonnées à
              // quatre puis « +N »). On ne cherche plus à lire QUI publie depuis
              // la grille — c'est impossible à 46 px — mais QUAND ça coince.
              if (compact) {
                const shown = items.slice(0, 4);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={items.length === 0}
                    onClick={() => setDayKey(key)}
                    aria-label={
                      items.length === 0
                        ? `${format(day, "d MMMM", { locale: fr })} — aucun post`
                        : `${format(day, "d MMMM", { locale: fr })} — ${items.length} post${items.length > 1 ? "s" : ""}`
                    }
                    className={cn(
                      "flex min-h-14 flex-col items-center gap-1 rounded-md border p-1 transition-colors",
                      inMonth ? "bg-white" : "bg-slate-50/50",
                      today
                        ? "border-primary ring-1 ring-primary"
                        : "border-slate-100",
                      items.length > 0
                        ? "hover:bg-slate-50 active:bg-slate-100"
                        : "cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs",
                        inMonth ? "text-slate-600" : "text-slate-300",
                        today && "font-bold text-primary",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    {items.length > 0 && (
                      <span className="flex flex-wrap items-center justify-center gap-0.5">
                        {shown.map(({ row, status }) => (
                          <span
                            key={row._id}
                            className={cn(
                              "size-1.5 rounded-full",
                              CALENDAR_STATUS_META[status].dot,
                            )}
                            aria-hidden
                          />
                        ))}
                        {items.length > shown.length && (
                          <span className="text-[9px] font-medium leading-none text-slate-400">
                            +{items.length - shown.length}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              }

              return (
                <div
                  key={key}
                  className={cn(
                    "min-h-24 rounded-md border p-1",
                    inMonth ? "bg-white" : "bg-slate-50/50",
                    today ? "border-primary ring-1 ring-primary" : "border-slate-100",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 text-right text-xs",
                      inMonth ? "text-slate-500" : "text-slate-300",
                      today && "font-bold text-primary",
                    )}
                  >
                    {format(day, "d")}
                  </div>
                  {/* Vue de pilotage : on affiche TOUS les posts du jour (pas de
                      « +N » tronqué). La case grandit avec son contenu ; un jour
                      très chargé scrolle en interne au-delà d'un plafond confortable
                      (~10 posts) plutôt que d'étirer sans fin la ligne de semaine. */}
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {items.map(({ row, status }) => (
                      <CalendarPost
                        key={row._id}
                        row={row}
                        status={status}
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>


          <p className="text-xs text-slate-400">
            {visible.length} post{visible.length > 1 ? "s" : ""}
            {statusLabel ? ` « ${statusLabel} »` : " planifié"}
            {!statusLabel && visible.length > 1 ? "s" : ""} affiché
            {visible.length > 1 ? "s" : ""}{" "}
            (filtres appliqués). Les assignments sans date de publication
            n&apos;apparaissent pas.
          </p>
        </CardContent>
      </Card>

      {/* Détail d'un JOUR (téléphone) — les vignettes à pleine largeur, lisibles.
          Ouvrir une assignation ferme d'abord ce panneau : deux feuilles
          empilées se recouvrent, et on ne saurait plus laquelle ESC referme. */}
      <Sheet open={dayKey !== null} onOpenChange={(o) => !o && setDayKey(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[80vh] gap-0 p-0"
          data-testid="calendar-day-sheet"
        >
          <SheetHeader className="border-b border-slate-100 p-4">
            {/* `capitalize` mettrait une majuscule à CHAQUE mot (« Mardi 8
                Septembre ») : en français, seule la première lettre en prend une. */}
            <SheetTitle className="first-letter:uppercase">
              {dayKey
                ? format(new Date(`${dayKey}T00:00:00`), "EEEE d MMMM", {
                    locale: fr,
                  })
                : ""}
            </SheetTitle>
            <SheetDescription>
              {dayItems.length} post{dayItems.length > 1 ? "s" : ""} planifié
              {dayItems.length > 1 ? "s" : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {dayItems.map(({ row, status }) => (
              <CalendarPost
                key={row._id}
                row={row}
                status={status}
                variant="row"
                onOpen={(id) => {
                  setDayKey(null);
                  onOpen(id);
                }}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Une PASTILLE de post dans une case-jour. Conteneur relatif : le corps est un
 * bouton (ouvre le panneau), et le lien rapide vers la publication est un <a>
 * FRÈRE (un <a> ne peut pas être imbriqué dans un <button>) positionné en haut à
 * droite, avec stopPropagation pour ne pas ouvrir le panneau.
 *
 * Deux tailles, MÊME composant : `chip` dans la grille du mois (46 px de large
 * sur téléphone, d'où la compression à l'extrême) et `row` dans le panneau de
 * jour, à pleine largeur — la mission et le créneau complet y tiennent, et la
 * cible tactile atteint enfin 44 px. Le `title` est le MÊME dans les deux : c'est
 * lui qui identifie une vignette, y compris pour les tests.
 */
function CalendarPost({
  row,
  status,
  onOpen,
  variant = "chip",
}: {
  row: CalendarAssignmentRow;
  status: CalendarStatusVisual;
  onOpen: (id: Id<"assignments">) => void;
  variant?: "chip" | "row";
}) {
  const wide = variant === "row";
  const tLabel = useLabel();
  const meta = CALENDAR_STATUS_META[status];
  const managed = row.managedByAdmin === true;
  const Marker = managed ? Building2Icon : UserRoundIcon;
  const published = row.targets.find((t) => t.publishedUrl);
  const accounts = row.targets.map((t) => ({
    flag: countryFlag(t.country),
    label: atHandle(t.accountHandle) ?? t.platform,
  }));
  const creneau = formatPostWindow(row.postWindow);
  const title = `${row.creatorName} · ${rowLabel(row)} · ${tLabel(meta.labelKey)}${
    creneau !== null ? ` · créneau ${creneau}` : ""
  } · ${managed ? "compte géré (tu publies)" : "compte créatrice (elle publie)"}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpen(row._id)}
        title={title}
        className={cn(
          "flex w-full flex-col rounded border text-left font-medium leading-tight transition-colors",
          wide
            ? "min-h-11 gap-1 px-3 py-2 text-xs"
            : "gap-0.5 px-1 py-0.5 text-[10px]",
          published && (wide ? "pr-9" : "pr-4"),
          meta.chip,
        )}
      >
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              creatorDot(row.creatorId),
            )}
            aria-hidden
          />
          <meta.Icon className={cn("shrink-0", wide ? "size-3.5" : "size-3")} />
          {/* Heure de DÉBUT seule dans la grille : la vignette est étroite. Le
              créneau COMPLET tient dans le panneau de jour, où la place existe —
              c'est justement l'information qu'on venait chercher en tapant le
              jour. Rien d'affiché sans créneau : pas de tiret, pas d'espace
              réservé. */}
          {(wide ? creneau : formatWindowStart(row.postWindow)) !== null && (
            <span className="shrink-0 font-semibold tabular-nums opacity-90">
              {wide ? creneau : formatWindowStart(row.postWindow)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{row.creatorName}</span>
          {/* Marqueur GÉRÉ (équipe) vs CRÉATRICE — d'un coup d'œil, à qui incombe
              la publication (détail dans le title). */}
          <Marker
            className={cn("shrink-0 opacity-60", wide ? "size-3.5" : "size-2.5")}
            aria-hidden
          />
        </span>
        {/* La MISSION n'a pas sa place dans la grille (elle chasserait le nom),
            mais le panneau de jour se lit pour décider : « quelle campagne, sur
            quel compte ». */}
        {wide && (
          <span className="truncate pl-3 font-normal opacity-90">
            {rowLabel(row)}
          </span>
        )}
        {accounts.length > 0 && (
          <span
            className={cn(
              "flex flex-wrap items-center gap-x-1 gap-y-0 pl-3 opacity-80",
              wide && "gap-x-2",
            )}
          >
            {accounts.map((acc, i) => (
              <span key={i} className="inline-flex min-w-0 items-center gap-0.5">
                {acc.flag && <span aria-hidden>{acc.flag}</span>}
                <span className="truncate font-mono">{acc.label}</span>
              </span>
            ))}
          </span>
        )}
      </button>
      {published?.publishedUrl && (
        <a
          href={published.publishedUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Ouvrir le post ${published.platform}`}
          aria-label={`Ouvrir le post publié ${published.platform}`}
          className={cn(
            "absolute rounded text-current opacity-60 transition-opacity hover:opacity-100",
            wide
              ? "right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center"
              : "right-0.5 top-0.5 p-0.5",
          )}
        >
          <ExternalLinkIcon className={wide ? "size-4" : "size-3"} />
        </a>
      )}
    </div>
  );
}
