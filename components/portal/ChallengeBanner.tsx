"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useMyChallenges, useMyComptes } from "@/components/portal/creator-data";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  ChevronDownIcon,
  InfoIcon,
  Loader2Icon,
  PlusIcon,
  TrophyIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format-rate";
import { useIntlLocale } from "@/lib/use-intl-locale";
import type { Id } from "@/convex/_generated/dataModel";
import { winnerSlots, type WinnerRule } from "@/convex/challengeScore";

/**
 * LE BLOC DÉFI — la première chose qu'une participante voit en haut de son
 * espace.
 *
 * ── Placement ────────────────────────────────────────────────────────────────
 * Sous `TodayPostBanner`, au-dessus du reste. Un retard caché sous un défi reste
 * un retard : `CatchUpBanner` et le post du jour gardent la priorité, parce
 * qu'ils demandent une action qui n'attend pas. Le défi, lui, est une
 * opportunité — il mérite d'être VU, pas de couvrir une échéance.
 *
 * ── Ce que ce bloc dit, et dans cet ordre ────────────────────────────────────
 * 1. ce qu'il y a à gagner et pour qui ;
 * 2. où elle en est (barre + score + reste à faire) ;
 * 3. combien de temps il reste ;
 * 4. le classement nominatif ;
 * 5. quand ses vues ont été relevées, et quand elles le seront à nouveau.
 *
 * Le point 5 n'est pas un détail d'ingénierie exposé par paresse : sans lui, une
 * créatrice qui vient de faire 20 000 vues et voit sa barre immobile croit que
 * l'app est cassée. Dire « relevé une fois par jour » à l'avance transforme un
 * bug apparent en règle du jeu.
 *
 * ── i18n ─────────────────────────────────────────────────────────────────────
 * TOUTES les chaînes viennent des catalogues. Le serveur ne rend que des faits :
 * il ne sait pas dans quelle langue écrire (pas de requête, pas d'en-tête).
 */

const HOUR_MS = 3_600_000;

export function ChallengeBanner() {
  const t = useTranslations("portal.challenge");
  const locale = useIntlLocale();
  const { current } = useCreatorProject();
  const challenges = useMyChallenges(current.projectId);

  if (challenges === undefined || challenges.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="challenge-banner">
      {challenges.map((c) => (
        <ChallengeCard key={c._id} c={c} locale={locale} t={t} />
      ))}
    </div>
  );
}

type Challenge = NonNullable<ReturnType<typeof useMyChallenges>>[number];

function ChallengeCard({
  c,
  locale,
  t,
}: {
  c: Challenge;
  locale: string;
  t: ReturnType<typeof useTranslations<"portal.challenge">>;
}) {
  const { current } = useCreatorProject();
  // « Annuler » existe déjà au catalogue (portal.declare) : une 34e clé pour le
  // même mot ferait diverger deux traductions du même bouton.
  const tDeclare = useTranslations("portal.declare");
  const comptes = useMyComptes(current.projectId);
  // `useMutation` de convex/react et NON `useProjectMutation` : ce dernier lit
  // `ProjectProvider`, absent du portail créateur (qui a son propre
  // `CreatorProjectProvider`). Le projet voyage donc en ARGUMENT, comme partout
  // ailleurs côté portail (cf AssignmentActions). Sans ça, le bloc fait planter
  // le dashboard — constaté à l'aperçu, pas au typage.
  const submit = useMutation(api.challengePortal.startChallengeVideo);
  const [showRules, setShowRules] = useState(false);
  // REPLIÉ par défaut, délibérément : ce qu'elle doit voir d'abord, c'est SON
  // score et le temps qu'il reste — pas la place des autres. Le classement est
  // à un clic, il n'est pas la première chose qu'on lui met sous les yeux.
  const [showBoard, setShowBoard] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Ancre temporelle STABLE au montage (`Date.now()` au render est impur).
  const [now] = useState(() => Date.now());

  const nf = new Intl.NumberFormat(locale);
  const df = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
  });
  // ⚠️ Fuseau ÉPINGLÉ sur Paris : le relevé a lieu à 23h30 heure de Paris, et
  // c'est cette heure-là qu'on annonce. Laisser le navigateur choisir
  // afficherait 22h30 à une créatrice à Londres pour le même événement.
  const tf = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });

  const pct = Math.round(c.myProgress * 100);
  const slots = winnerSlots(c.winnerRule as WinnerRule);
  const placesLeft = Number.isFinite(slots)
    ? Math.max(0, slots - c.winnersCount)
    : null;
  const available = (comptes ?? []).filter((a) => a.disponible);
  const canSubmit = !c.over && available.length > 0;

  const hoursToNext = Math.floor((c.nextSyncAt - now) / HOUR_MS);
  const syncTime = tf.format(new Date(c.nextSyncAt));

  async function handleSubmit() {
    const first = available[0];
    if (!first) return;
    setBusy(true);
    try {
      await submit({
        projectId: current.projectId,
        challengeId: c._id as Id<"challenges">,
        targets: [
          { platform: first.plateforme, accountId: first._id as Id<"comptes"> },
        ],
      });
      toast.success(t("submit"));
      setConfirmOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "—"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border shadow-sm",
        c.iWon
          ? "border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-50"
          : "border-slate-900/10 bg-gradient-to-br from-slate-900 to-slate-800 text-white",
      )}
      data-testid="challenge-card"
    >
      <div className="space-y-4 p-5">
        {/* 1 — ce qu'il y a à gagner */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                c.iWon ? "bg-amber-200 text-amber-900" : "bg-white/15 text-white",
              )}
            >
              <TrophyIcon className="size-3" />
              {t("title")}
            </div>
            <h2
              className={cn(
                "text-lg font-semibold leading-tight",
                c.iWon ? "text-slate-900" : "text-white",
              )}
            >
              {c.name}
            </h2>
            <p
              className={cn(
                "text-sm",
                c.iWon ? "text-slate-600" : "text-white/70",
              )}
            >
              {c.mode === "single"
                ? t("goalSingle", { target: nf.format(c.targetViews) })
                : t("goalCumulative", { target: nf.format(c.targetViews) })}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={cn(
                "text-sm font-semibold",
                c.iWon ? "text-amber-700" : "text-amber-300",
              )}
            >
              {c.reward.type === "cash"
                ? t("rewardCash", {
                    amount: formatMoney(
                      c.reward.amount ?? 0,
                      current.payCurrency,
                      locale,
                    ),
                  })
                : t("rewardNature", { libelle: c.reward.libelle ?? "—" })}
            </p>
            {/* Le montant est PAR GAGNANTE. On le dit dès qu'il peut y en avoir
                plusieurs : sans ça, « 200 $ » se lit comme une enveloppe à
                partager. */}
            {slots !== 1 && (
              <p
                className={cn(
                  "text-[11px]",
                  c.iWon ? "text-slate-500" : "text-white/50",
                )}
              >
                {t("perWinner")}
              </p>
            )}
          </div>
        </div>

        {/* ── L'ISSUE, quand il y en a une ──────────────────────────────────
            Cinq états possibles, et aucun ne doit laisser l'écran muet :
              1. elle a gagné → on le lui dit, en grand ;
              2. terminé sans aucune gagnante → « rien n'est versé », dit
                 explicitement : le silence laisserait croire à un oubli ;
              3. terminé avec des gagnantes qui ne sont pas elle → le nombre,
                 sans commentaire (le classement juste en dessous dit qui) ;
              4. en cours, des places prises mais pas toutes → il en reste, et
                 c'est l'information qui la fait continuer ;
              5. en cours, rien de joué → rien à annoncer, la barre parle.
            Un `iWon` seul aurait couvert 1 et laissé 2, 3 et 4 sans mot. */}
        {c.iWon ? (
          <p
            className="rounded-lg bg-amber-200/60 px-3 py-2 text-sm font-semibold text-amber-900"
            data-testid="challenge-i-won"
          >
            {t("iWon")}
          </p>
        ) : c.over ? (
          <p
            className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80"
            data-testid="challenge-over"
          >
            {c.winnersCount === 0
              ? t("overNoWinner")
              : t("overOthersWon", { count: c.winnersCount })}
          </p>
        ) : c.winnersCount > 0 ? (
          <p
            className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80"
            data-testid="challenge-others-won"
          >
            {t("othersWon", { count: c.winnersCount })}
          </p>
        ) : null}

        {/* 2 — où elle en est */}
        <div className="space-y-1.5">
          <div className="flex items-end justify-between gap-3">
            <p
              className={cn(
                "text-2xl font-bold tabular-nums",
                c.iWon ? "text-slate-900" : "text-white",
              )}
              data-testid="challenge-my-score"
            >
              {t("myScore", { score: nf.format(c.myScore) })}
            </p>
            <p
              className={cn(
                "text-xs",
                c.iWon ? "text-slate-500" : "text-white/60",
              )}
            >
              {c.myViewsToTarget === 0
                ? t("reached")
                : t("toGo", { views: nf.format(c.myViewsToTarget) })}
            </p>
          </div>
          <div
            className={cn(
              "h-2.5 w-full overflow-hidden rounded-full",
              c.iWon ? "bg-amber-200/50" : "bg-white/15",
            )}
          >
            <div
              className={cn(
                "h-full rounded-full transition-all",
                c.myViewsToTarget === 0 ? "bg-emerald-400" : "bg-amber-400",
              )}
              style={{ width: `${pct}%` }}
              data-testid="challenge-progress"
            />
          </div>
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs",
              c.iWon ? "text-slate-500" : "text-white/60",
            )}
          >
            <span>{t("videos", { count: c.myVideoCount })}</span>
            <span>·</span>
            {/* 3 — le temps restant */}
            <span>
              {c.over
                ? t("ended")
                : c.deadline - now < 86_400_000
                  ? t("endsToday")
                  : t("ends", { date: df.format(new Date(c.deadline)) })}
            </span>
            {placesLeft !== null && (
              <>
                <span>·</span>
                <span>{t("placesLeft", { left: placesLeft })}</span>
              </>
            )}
          </div>
        </div>

        {/* 5 — la fraîcheur des chiffres, annoncée AVANT qu'elle s'en étonne */}
        <p
          className={cn(
            "text-[11px]",
            c.iWon ? "text-slate-400" : "text-white/45",
          )}
          data-testid="challenge-sync-line"
        >
          {/* Un défi TERMINÉ n'attend plus rien : annoncer « prochain relevé
              dans 4 h » y serait du bruit, et laisserait croire que le
              résultat peut encore bouger. On garde la date du DERNIER relevé —
              c'est celle qui a arrêté les compteurs. */}
          {c.over
            ? c.lastSyncAt === null
              ? null
              : t("syncLineOver", {
                  date: df.format(new Date(c.lastSyncAt)),
                  time: tf.format(new Date(c.lastSyncAt)),
                })
            : c.lastSyncAt === null
            ? t("syncNever", { time: syncTime })
            : hoursToNext < 1
              ? t("syncLineSoon", {
                  date: df.format(new Date(c.lastSyncAt)),
                  time: tf.format(new Date(c.lastSyncAt)),
                })
              : t("syncLine", {
                  date: df.format(new Date(c.lastSyncAt)),
                  time: tf.format(new Date(c.lastSyncAt)),
                  hours: hoursToNext,
                })}
        </p>

        {/* Action */}
        <div className="flex flex-wrap items-center gap-2">
          {canSubmit && (
            <Button
              size="sm"
              className="bg-white text-slate-900 hover:bg-white/90"
              onClick={() => setConfirmOpen(true)}
              data-testid="challenge-submit"
            >
              <PlusIcon className="mr-1.5 size-4" />
              {t("submit")}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setShowBoard((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline",
              c.iWon ? "text-slate-600" : "text-white/80",
            )}
            data-testid="challenge-toggle-board"
          >
            {t("leaderboard")}
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", showBoard && "rotate-180")}
            />
          </button>
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline",
              c.iWon ? "text-slate-600" : "text-white/80",
            )}
            data-testid="challenge-toggle-rules"
          >
            <InfoIcon className="size-3.5" />
            {t("tiebreakTitle")}
          </button>
        </div>

        {!c.over && available.length === 0 && (
          <p
            className={cn(
              "text-xs",
              c.iWon ? "text-slate-500" : "text-white/60",
            )}
          >
            {t("noAccount")}
          </p>
        )}

        {/* 4 — le classement nominatif */}
        {showBoard && (
          <ol className="space-y-1" data-testid="challenge-leaderboard">
            {c.ranking.map((r) => (
              <li
                key={r.creatorId}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm",
                  r.isMe
                    ? c.iWon
                      ? "bg-amber-200/50 font-semibold text-slate-900"
                      : "bg-white/15 font-semibold text-white"
                    : c.iWon
                      ? "text-slate-600"
                      : "text-white/75",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 tabular-nums opacity-60">
                    {r.rank}
                  </span>
                  <span className="truncate">{r.name}</span>
                  {r.isMe && <span className="opacity-60">({t("you")})</span>}
                  {r.won && (
                    <TrophyIcon className="size-3.5 shrink-0 text-amber-400" />
                  )}
                </span>
                <span className="shrink-0 tabular-nums">
                  {nf.format(r.score)}
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* La règle de départage, dans SES mots, avant qu'elle en ait besoin */}
        {showRules && (
          <div
            className={cn(
              "space-y-2 rounded-lg p-3 text-xs leading-relaxed",
              c.iWon ? "bg-slate-100 text-slate-600" : "bg-black/25 text-white/75",
            )}
            data-testid="challenge-rules"
          >
            <p
              className={cn(
                "font-semibold",
                c.iWon ? "text-slate-800" : "text-white",
              )}
            >
              {t("tiebreakTitle")}
            </p>
            <p>{t("tiebreakIntro", { time: syncTime })}</p>
            <p
              className={cn(
                "font-semibold",
                c.iWon ? "text-slate-800" : "text-white",
              )}
            >
              {t("tiebreakRule")}
            </p>
            <p>{t("tiebreakWhy")}</p>
            <p className="pt-1">
              {c.winnerRule.kind === "first"
                ? t("winnersFirst")
                : c.winnerRule.kind === "topN"
                  ? t("winnersTopN", { n: c.winnerRule.n })
                  : t("winnersAll")}
            </p>
            <p>
              {c.mode === "single"
                ? t("modeSingleHelp")
                : t("modeCumulativeHelp")}
            </p>
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.name}</DialogTitle>
            <DialogDescription>{t("submitHelp")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {tDeclare("cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={busy}>
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {t("submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
