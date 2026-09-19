"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  DoorOpenIcon,
  FlameIcon,
  GraduationCapIcon,
  Loader2Icon,
  UserPlusIcon,
  WalletIcon,
  ZapOffIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject, useProjectPath } from "@/components/project/ProjectProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { creatorStatusBadge } from "@/lib/creator-status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/lib/format";
import { isWarmupLate } from "@/lib/ops-digest";
import { resolveCreatorKind } from "@/convex/roles";
import {
  getEffectiveStatus,
  getEffectiveWarmupDuration,
} from "@/lib/compte-status";
import {
  verdictOf,
  likeRateTone,
  saveRateTone,
  accountStateOf,
  rateOf,
  type PostSignal,
  type Verdict,
  type RateTone,
  type AccountState,
} from "@/convex/decisions";
import { savesAvailability } from "@/convex/decisionThresholds";
import { type ConversionDisplayRow } from "@/convex/conversionAttribution";
import { formatMoney } from "@/lib/format-rate";
import { usePermissions } from "@/components/project/use-permissions";
import { POST_WINDOW_PRESETS } from "@/convex/postWindow";
import { GraduateHookDialog } from "@/components/admin/GraduateHookDialog";
import { AssignScriptCampaignDialog } from "@/components/admin/AssignScriptCampaignDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";

const DAY_MS = 86_400_000;

type DashboardDecisions = FunctionReturnType<
  typeof api.dashboardDecisions.decisionDashboard
>;
type Post48h = DashboardDecisions["posts48h"][number];

/** Créneau pré-rempli de « Programmer la frappe » : le soir, 21 h-23 h. */
const SOIR = POST_WINDOW_PRESETS.find((p) => p.id === "soir")!.window;

/**
 * Minuit LOCAL du lendemain — même convention que le calendrier d'assignation
 * (les postDate de prod sont toutes à minuit heure du poste admin, UTC+1).
 */
function tomorrowMidnightLocal(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Dashboard d'accueil orienté ACTION — agrège des queries DÉJÀ existantes
 * (listAssignments, listComptes, listCreators) côté client : chaque carte ne
 * fait que filtrer/compter l'existant (cf lib/warmup, lib/compte-status).
 * Toutes les cartes sont cliquables et mènent à la page concernée.
 *
 * ⚠️ EXCEPTION ASSUMÉE — les deux blocs FINANCIERS sont agrégés SERVEUR :
 *   - carte « à payer »  → `payments.getDueTotal` (un nombre) ;
 *   - section « Ce que ça a rapporté » → `conversionSync.readConversionAllTime`
 *     rend désormais les lignes DÉJÀ mises en forme.
 * Ils lisaient auparavant `listPayments` et les lignes brutes d'attribution,
 * c'est-à-dire que tous les cycles de paie du projet et toutes les refs
 * mesurées arrivaient dans le navigateur pour afficher un total et une liste.
 * Ne PAS les ramener côté client : un écran qui n'affiche pas une donnée ne
 * doit pas la recevoir (cf AUDIT_ROLE_MANAGER.md, F1/F2).
 */

/** Ancienneté en UNITÉ + COMPTE : la phrase vit dans `admin.dashboard.age.*`. */
function relativeAge(ts: number, now: number): { unit: "now" | "d" | "h" | "min"; count: number } {
  const diff = now - ts;
  if (diff < 60_000) return { unit: "now", count: 0 };
  const days = Math.floor(diff / DAY_MS);
  if (days >= 1) return { unit: "d", count: days };
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return { unit: "h", count: hours };
  return { unit: "min", count: Math.floor(diff / 60_000) };
}

export function ActionDashboard() {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.ActionDashboard");
  const projectPath = useProjectPath();
  // Paie créatrices → devise du projet ($). Absente → montant sans symbole.
  const { payCurrency, accountValidation } = useProject().project;
  // « Maintenant » figé au mount (lazy init pur — cf react-hooks/purity, même
  // pattern que MetricChart). Suffisant pour un instantané de dashboard.
  const [now] = useState(() => Date.now());
  // ⚠️ TOUTES CES LECTURES SONT GARDÉES PAR UN BLOC, et le Dashboard est l'écran
  // où TOUT LE MONDE atterrit. Appelées sans condition, celles dont le manager
  // n'a pas le bloc LÈVENT — et c'est sa page d'accueil qui tombe, donc son
  // impression que « l'app ne marche pas ». #156 avait posé `skipUnless` sur les
  // deux lectures d'ARGENT ; les quatre autres portent des blocs COCHÉS PAR
  // DÉFAUT, ce qui a suffi à masquer le défaut tant qu'aucun manager n'avait été
  // configuré autrement. Décocher une seule case le réveillait.
  const droits = usePermissions();
  const voitAssignments = droits.has("assignments.manage");
  const voitComptes = droits.has("accounts.manage");
  const voitCreateurs = droits.has("creators.read");
  const voitDecisions = droits.has("content.analytics");
  const assignments = useProjectQuery(
    api.assignments.listAssignments,
    droits.skipUnless("assignments.manage", {}),
  );
  const comptes = useProjectQuery(
    api.comptes.listComptes,
    droits.skipUnless("accounts.manage", {}),
  );
  // Carte 3 — le TOTAL DÛ, agrégé serveur. Le dashboard lisait `listPayments`
  // et sommait côté client : tous les cycles de paie du projet traversaient le
  // réseau (montants par créatrice, lignes, ventilation du barème, coordonnées
  // bancaires) pour n'afficher qu'un nombre. Même ensemble, même ordre, même
  // arithmétique — cf convex/payments.getDueTotal.
  const due = useProjectQuery(
    api.payments.getDueTotal,
    droits.skipUnless("payments.manage", {}),
  );
  const creators = useProjectQuery(
    api.creators.listCreators,
    droits.skipUnless("creators.read", {}),
  );

  // Les deux sections décisionnelles lisent UNE query d'assemblage ; toute la
  // logique (seuils, détections) vit dans les modules purs testés.
  const decisions = useProjectQuery(
    api.dashboardDecisions.decisionDashboard,
    droits.skipUnless("content.analytics", {}),
  );
  // Conversion par créatrice (ref snytch.co) — la veille, collectée à 23h50.
  const conversion = useProjectQuery(
    api.conversionSync.readConversionAllTime,
    droits.skipUnless("business.read", {}),
  );

  // Dialogues des trois actions : graduer (modale existante), désactiver un
  // hook mort (confirmation), programmer une frappe (modale d'assignation
  // pré-remplie créatrice + Soir 21-23h + demain).
  const [graduating, setGraduating] = useState<Id<"scriptBricks"> | null>(null);
  const [deactivating, setDeactivating] = useState<{
    brickId: Id<"scriptBricks">;
    content: string;
  } | null>(null);
  const [strikeCreator, setStrikeCreator] = useState<Id<"creators"> | null>(
    null,
  );

  // « On attend » ne veut dire quelque chose que pour une lecture qu'on a le
  // droit de faire : une query SKIPPÉE reste `undefined` pour toujours, et la
  // tester sans son bloc fige l'écran sur son squelette — un dashboard qui ne
  // charge jamais, ce qui se lit comme une panne plutôt que comme une
  // restriction.
  const attend = (accorde: boolean, valeur: unknown) =>
    accorde && valeur === undefined;
  const loading =
    attend(voitAssignments, assignments) ||
    attend(voitComptes, comptes) ||
    attend(droits.has("payments.manage"), due) ||
    attend(voitCreateurs, creators) ||
    attend(voitDecisions, decisions);

  const data = useMemo(() => {
    if (
      attend(voitAssignments, assignments) ||
      attend(voitComptes, comptes) ||
      attend(droits.has("payments.manage"), due) ||
      attend(voitCreateurs, creators)
    ) {
      return null;
    }
    // Carte 1 — vidéos en attente de revue.
    const submitted = (assignments ?? [])
      .filter((a) => a.status === "video_submitted")
      .sort((a, b) => a.createdAt - b.createdAt);

    // Carte 2 — comptes en warmup avec des jours manqués. Prédicat PARTAGÉ avec
    // le digest quotidien (lib/ops-digest) ; les comptes de CLIPPEUR en sortent
    // (pas de checks quotidiens — même correction que côté digest).
    const creatorById = new Map((creators ?? []).map((c) => [c._id, c]));
    const estCompteDeClippeur = (creatorId: Id<"creators"> | undefined) =>
      creatorId !== undefined &&
      resolveCreatorKind(creatorById.get(creatorId)?.kind) === "clipper";
    const warmupLate = (comptes ?? []).filter((c) =>
      estCompteDeClippeur(c.creatorId)
        ? false
        : isWarmupLate(
            {
              effectiveStatus: getEffectiveStatus(c),
              warmupStartedAt: c.warmupStartedAt,
              dailyChecks: c.warmupProtocol?.dailyChecks ?? [],
              targetDays: c.targetDays,
            },
            now,
          ),
    );

    // Carte 2 bis — warmups TERMINÉS qui attendent une validation admin (régime
    // STRICT du projet uniquement, cf rendu). Sous le gate strict (#98) ces comptes ne publient pas tant qu'ils ne sont pas
    // repassés en « actif » : chaque jour de délai annule un jour de chauffe
    // gagné, et jusqu'ici seul un badge dans la liste le signalait.
    //
    // `warmupDone` est SERVI par le serveur (listComptes) — on ne le recalcule
    // pas ici, pour la même raison que la durée.
    const warmupReady = (comptes ?? []).filter(
      (c) => getEffectiveStatus(c) === "warmup" && c.warmupDone,
    );

    // Carte 3 — total DÛ = tous les cycles non payés. Calculé SERVEUR sur le
    // même ensemble et dans le même ordre que le total de /paiements (les deux
    // passent par `collectProjectPaymentRows`).
    // `null` quand le bloc n'est pas accordé : la carte n'est alors pas rendue.
    const dueTotal = due?.dueTotal ?? null;

    return {
      submitted,
      warmupLate,
      warmupReady,
      dueTotal,
      totalCreators: (creators ?? []).length,
    };
  }, [assignments, comptes, due, creators, now]);

  if (loading || data === null) return <ActionSkeleton />;

  const { submitted, warmupLate, warmupReady, dueTotal, totalCreators } = data;

  // État vide : ni créateur ni soumission → message d'accueil (pas des cartes à
  // zéro qui semblent cassées).
  //
  // ⚠️ Conditionné au bloc `creators.read` : sans lui, `totalCreators` vaut 0
  // parce qu'on n'a pas LE DROIT de compter, pas parce qu'il n'y a personne.
  // « Invite tes premiers créateurs » serait alors un mensonge, et il enverrait
  // la personne sur un écran qu'elle ne peut pas ouvrir.
  if (voitCreateurs && totalCreators === 0 && submitted.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserPlusIcon className="size-6" />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-medium text-slate-900">
              {tr("inviteTesPremiersCreateursPour")}
            </h2>
            <p className="text-sm text-slate-500">
              {tr("uneFoisDesCreateursAjoutes")}
            </p>
          </div>
          <Link
            href={projectPath("/createurs")}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <UserPlusIcon className="size-4" />
            {tr("ajouterUnCreateur")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rangée de cartes-action cliquables — une par geste qui ATTEND
          quelqu'un. « Deadlines 7 j » n'en était pas une : une échéance à venir
          ne demande rien aujourd'hui, et son compteur restait haut en
          permanence (63 sur ce projet), ce qui n'oriente vers aucune décision.
          Le planning se lit dans Assignments, qui est fait pour ça. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Une carte n'est rendue QUE si son bloc l'est. Sans ça elle
            afficherait « 0 » là où la vraie réponse est « tu n'as pas ce
            droit », et mènerait à un écran refusé. Même traitement que la carte
            d'argent, posé en #156. */}
        {voitAssignments && (
          <ActionCard
            href={projectPath("/validation")}
            icon={CheckCircle2Icon}
            label={tr("aValider")}
            value={String(submitted.length)}
            hint={tr("soumissionsEnAttente")}
            accent
          />
        )}
        {voitComptes && (
          <ActionCard
            href={projectPath("/comptes")}
            icon={FlameIcon}
            label={tr("warmupsEnRetard")}
            value={String(warmupLate.length)}
            hint={tr("comptesAvecJoursManques")}
            warn={warmupLate.length > 0}
          />
        )}
        {/* Seulement en régime STRICT : en souple, un warmup terminé publie
            déjà — annoncer des comptes « en attente » serait faux. */}
        {voitComptes && accountValidation === "strict" && (
          <ActionCard
            href={projectPath("/comptes")}
            icon={CheckCircle2Icon}
            label={tr("warmupsAValider")}
            value={String(warmupReady.length)}
            hint={tr("chauffeFinieEnAttente")}
            accent={warmupReady.length > 0}
          />
        )}
        {/* Carte d'ARGENT : rendue seulement avec le bloc. La query est skippée
            en amont, donc `dueTotal` est `null` ici — et la carte mènerait de
            toute façon à un écran refusé. */}
        {dueTotal !== null && (
          <ActionCard
            href={projectPath("/paiements")}
            icon={WalletIcon}
            label={tr("du")}
            value={formatMoney(dueTotal, payCurrency, loc)}
            hint={tr("cyclesNonPayes")}
          />
        )}
      </div>

      {/*
        « À décider » — le cœur de la refonte : une ligne par DÉCISION, jamais
        une tâche d'exécution (celles-ci vivent dans leurs pages, atteignables
        par les 4 cartes du haut). Détections servies par decisionDashboard,
        seuils dans convex/decisionThresholds.ts.
      */}
      {decisions !== undefined && (
        <Section title={tr("aDecider")}>
          <DecideList
            decisions={decisions}
            onStrike={(creatorId) => setStrikeCreator(creatorId)}
            onGraduate={(brickId) => setGraduating(brickId)}
            onDeactivate={(brickId, content) =>
              setDeactivating({ brickId, content })
            }
          />
        </Section>
      )}

      {/* « Posts des dernières 48 h » — remplace les cumuls à vie : le rythme
          réel, groupé par créatrice, delta 24 h en évidence. Le cumul reste
          accessible via « Voir tout ». */}
      {decisions !== undefined && (
        <Section
          title={tr("postsDesDernieres48H")}
          action={
            voitCreateurs
              ? { label: tr("voirTout"), href: projectPath("/createurs") }
              : undefined
          }
        >
          <Recent48h
            posts={decisions.posts48h}
            alarms={decisions.alarms}
            now={now}
          />
        </Section>
      )}

      {/* « Ce que ça a rapporté » — visiteurs et ventes attribués par la ref
          snytch.co/<créatrice>, la veille. L'attribution repose ENTIÈREMENT sur
          le chemin court (pas de referrer in-app TikTok) : une créatrice sans
          ref est un état à part, jamais un zéro. */}
      {droits.has("business.read") && (
        <Section title={tr("ceQueCaARapporte")}>
          <ConversionSection data={conversion} />
        </Section>
      )}

      <GraduateHookDialog
        brickId={graduating}
        open={graduating !== null}
        onOpenChange={(o) => !o && setGraduating(null)}
      />
      <DeactivateHookDialog
        target={deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
      />
      {/* « Programmer la frappe » : la modale d'assignation EXISTANTE, sur la
          campagne des ouvertures prouvées, pré-remplie créatrice + Soir 21-23h
          + demain. Le bouton est masqué si la campagne n'existe pas. */}
      {decisions?.provenCampaign != null && strikeCreator !== null && (
        <AssignScriptCampaignDialog
          open
          onOpenChange={(o) => !o && setStrikeCreator(null)}
          campaignId={decisions.provenCampaign.id}
          campaignName={decisions.provenCampaign.name}
          strike={{
            creatorId: strikeCreator,
            plage: SOIR,
            postDate: tomorrowMidnightLocal(now),
          }}
        />
      )}
    </div>
  );
}

// ─── Section « À décider » ───────────────────────────────────────────────────

function DecideList({
  decisions,
  onStrike,
  onGraduate,
  onDeactivate,
}: {
  decisions: DashboardDecisions;
  onStrike: (creatorId: Id<"creators">) => void;
  onGraduate: (brickId: Id<"scriptBricks">) => void;
  onDeactivate: (brickId: Id<"scriptBricks">, content: string) => void;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.DecideList");
  const { openDoors, graduations, deadHooks, alarms, provenCampaign } = decisions;
  const total =
    openDoors.length + graduations.length + deadHooks.length + alarms.length;

  if (total === 0) {
    return (
      <EmptyRow
        icon={CheckCircle2Icon}
        label={tr("rienADeciderCeSoir")}
      />
    );
  }

  return (
    <div className="space-y-1">
      {openDoors.length > 0 && (
        <>
          <GroupHeader
            icon={DoorOpenIcon}
            label={tr("portesOuvertes")}
            count={openDoors.length}
            tone="text-violet-700"
          />
          <div className="divide-y divide-slate-100">
            {openDoors.map((d) => (
              <WorklistRow
                key={d.post.publicationId}
                title={`${d.post.compte}${d.post.creatorName ? ` — ${d.post.creatorName}` : ""}`}
                subtitle={[
                  `${formatNumber(d.post.vues, loc)} vues`,
                  `${formatPercent(d.likeRate, undefined, loc)} likes`,
                  `${formatNumber(d.post.saves ?? 0, loc)} saves`,
                  tr("abonnes", { count: formatNumber(d.post.followersDelta ?? 0, loc) }),
                ].join(" · ")}
                action={
                  d.post.creatorId !== null && provenCampaign !== null ? (
                    <InlineAction
                      icon={DoorOpenIcon}
                      label={tr("programmerLaFrappe")}
                      busy={false}
                      onClick={() => onStrike(d.post.creatorId as Id<"creators">)}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>
        </>
      )}

      {graduations.length > 0 && (
        <>
          <GroupHeader
            icon={GraduationCapIcon}
            label={tr("aGraduer")}
            count={graduations.length}
            tone="text-primary"
          />
          <div className="divide-y divide-slate-100">
            {graduations.map((g) => (
              <WorklistRow
                key={g.brickId}
                title={g.content}
                subtitle={[
                  `meilleur run ${formatNumber(g.best.vues, loc)} vues`,
                  `${formatPercent(rateOf(g.best.likes, g.best.vues) ?? 0, undefined, loc)} likes`,
                  g.best.saves !== null
                    ? `${formatPercent(rateOf(g.best.saves, g.best.vues) ?? 0, undefined, loc)} saves`
                    : "saves —",
                  `${g.runs} run${g.runs > 1 ? "s" : ""}`,
                ].join(" · ")}
                action={
                  <InlineAction
                    icon={GraduationCapIcon}
                    label={tr("graduer")}
                    busy={false}
                    onClick={() => onGraduate(g.brickId)}
                  />
                }
              />
            ))}
          </div>
        </>
      )}

      {deadHooks.length > 0 && (
        <>
          <GroupHeader
            icon={ZapOffIcon}
            label={tr("hooksMorts")}
            count={deadHooks.length}
            tone="text-slate-500"
          />
          <div className="divide-y divide-slate-100">
            {deadHooks.map((h) => (
              <WorklistRow
                key={h.brickId}
                title={h.content}
                subtitle={tr("runsPubliesMeilleurVuesAucun", { runs: h.runs, count: formatNumber(h.bestViews, loc), campaignName: h.campaignName })}
                action={
                  <InlineAction
                    icon={ZapOffIcon}
                    label={tr("desactiver")}
                    busy={false}
                    onClick={() => onDeactivate(h.brickId, h.content)}
                  />
                }
              />
            ))}
          </div>
        </>
      )}

      {alarms.length > 0 && (
        <>
          <GroupHeader
            icon={AlertTriangleIcon}
            label={tr("alarmesCompte")}
            count={alarms.length}
            tone="text-rose-700"
          />
          <div className="divide-y divide-slate-100">
            {alarms.map((a) => (
              <WorklistRow
                key={a.compte}
                title={`${a.compte}${a.creatorName ? ` — ${a.creatorName}` : ""}`}
                subtitle={tr("postsConsecutifsSousLesSeuils", { streak: a.streak })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Confirmation de DÉSACTIVATION d'un hook mort. Même mutation que la bascule de
 * la page campagne (updateBrick) : aucune logique nouvelle, juste une porte de
 * confirmation — le geste retire le hook de toutes les rotations futures.
 */
function DeactivateHookDialog({
  target,
  onOpenChange,
}: {
  target: { brickId: Id<"scriptBricks">; content: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.dashboard.DeactivateHookDialog");
  const update = useProjectMutation(api.scripts.updateBrick);
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    if (!target) return;
    setBusy(true);
    try {
      await update({ id: target.brickId, active: false });
      toast.success(tr("hookDesactiveIlSortDes"));
      onOpenChange(false);
    } catch (e) {
      toast.error(showError(e, tr("desactivationImpossible")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("desactiverCeHook")}</DialogTitle>
          <DialogDescription>
            {tr("ilSortDesRotationsAutomatiques")}
          </DialogDescription>
        </DialogHeader>
        {target && (
          <blockquote className="rounded-md border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            {target.content}
          </blockquote>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("annuler")}
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ZapOffIcon className="size-4" />
            )}
            {tr("desactiver")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Section « Posts des dernières 48 h » ────────────────────────────────────

function Recent48h({
  posts,
  alarms,
  now,
}: {
  posts: Post48h[];
  alarms: DashboardDecisions["alarms"];
  now: number;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.Recent48h");
  // Repli par créatrice — état LOCAL, défaut déplié (l'écran sert à lire, le
  // repli sert à ranger les créatrices déjà vues ce soir).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const alarmedComptes = useMemo(
    () => new Set(alarms.map((a) => a.compte)),
    [alarms],
  );

  const groups = useMemo(() => {
    const byCreator = new Map<string, { label: string; posts: Post48h[] }>();
    for (const p of posts) {
      // Un post sans créatrice rattachée est groupé par COMPTE : l'information
      // reste visible au lieu de disparaître dans un bucket fourre-tout.
      const key = p.creatorId ?? `compte:${p.compte}`;
      const g = byCreator.get(key) ?? {
        label: p.creatorName ?? p.compte,
        posts: [],
      };
      g.posts.push(p);
      byCreator.set(key, g);
    }
    return [...byCreator.entries()].sort(
      (a, b) =>
        b[1].posts.reduce((s, p) => s + p.vues, 0) -
        a[1].posts.reduce((s, p) => s + p.vues, 0),
    );
  }, [posts]);

  if (posts.length === 0) {
    return (
      <EmptyRow
        icon={CalendarClockIcon}
        label={tr("aucunPostPublieDansLes")}
      />
    );
  }

  return (
    <div className="space-y-1">
      {groups.map(([key, g]) => {
        const vues48 = g.posts.reduce((s, p) => s + p.vues, 0);
        // Delta d'abonnés PAR COMPTE (dédupliqué) puis sommé ; tous null →
        // « collecte… » (il faut deux relevés nocturnes, cf computeFollowersDelta).
        const parCompte = new Map<string, number | null>();
        for (const p of g.posts) parCompte.set(p.compte, p.followersDelta);
        const deltas = [...parCompte.values()].filter(
          (d): d is number => d !== null,
        );
        const followers = deltas.length > 0
          ? deltas.reduce((s, d) => s + d, 0)
          : null;
        const alarmed = [...parCompte.keys()].some((c) => alarmedComptes.has(c));
        const state = accountStateOf(g.posts, alarmed);
        const isCollapsed = collapsed.has(key);

        return (
          <div key={key} className="border-t border-slate-100 first:border-t-0">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              className="flex w-full items-center gap-2 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="size-4 shrink-0 text-slate-400" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 text-slate-400" />
              )}
              <span className="truncate text-sm font-medium text-slate-900">
                {g.label}
              </span>
              <AccountStateBadge state={state} />
              <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500">
                {tr("postJVues", { count: g.posts.length, value: formatNumber(Math.round((g.posts.length / 2) * 10) / 10, loc), count2: formatNumber(vues48, loc) })}{" "}
                {followers !== null ? (
                  <span className={followers >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {followers >= 0 ? "+" : ""}
                    {tr("abonnes", { count: formatNumber(followers, loc) })}
                  </span>
                ) : (
                  <span
                    className="italic text-slate-400"
                    title={tr("leDeltaDAbonnesDemande")}
                  >
                    {tr("abonnesCollecte")}
                  </span>
                )}
              </span>
            </button>
            {!isCollapsed && (
              <div className="divide-y divide-slate-50 pb-1 pl-6">
                {g.posts.map((p) => (
                  <PostRow key={p.publicationId} post={p} now={now} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "16/08" — jour Paris d'un relevé, pour dater une valeur qui n'est pas d'aujourd'hui. */
function shortParisDay(ms: number, locale: string = "fr-FR"): string {
  return new Date(ms).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
  });
}

function PostRow({ post: p, now }: { post: Post48h; now: number }) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.PostRow");
  const tAge = useTranslations("admin.dashboard.age");
  const likeRate = rateOf(p.likes, p.vues);
  const savesState = savesAvailability(p.saves, p.plateforme);
  const saveRate = savesState === "measured" ? rateOf(p.saves, p.vues) : null;
  // Le relevé qui porte les chiffres affichés n'est pas forcément d'aujourd'hui
  // (le sync tourne à 23h30). On le DATE plutôt que de masquer la valeur : une
  // donnée datée vaut mieux qu'un tiret. Rien à dater si le relevé est du jour.
  const sourceDay =
    p.snapshotAt !== null && shortParisDay(p.snapshotAt, loc) !== shortParisDay(now, loc)
      ? shortParisDay(p.snapshotAt, loc)
      : null;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-slate-900">
            {p.label || tr("sansTitre")}
          </span>
          <TypeBadge type={p.type} />
        </div>
        <div className="truncate text-xs text-slate-400">
          {p.compte} · {tAge("label", relativeAge(p.postedAt, now))}
        </div>
      </div>
      <Metric
        value={formatNumber(p.vues, loc)}
        label={sourceDay ? tr("vuesAu", { sourceDay: sourceDay }) : tr("vues")}
        title={sourceDay ? tr("dernierReleveLeA23h30", { sourceDay: sourceDay }) : undefined}
      />
      {/* LA colonne du tableau : un post qui monte vs un post qui s'éteint. */}
      <div className="w-20 shrink-0 text-right">
        {p.delta24h !== null ? (
          <div className="text-sm font-semibold tabular-nums text-slate-900">
            +{formatNumber(p.delta24h, loc)}
          </div>
        ) : (
          <div
            className="text-sm italic text-slate-400"
            title={tr("pasEncoreDeuxRelevesEspaces")}
          >
            —
          </div>
        )}
        <div className="text-[10px] text-slate-400">Δ 24 h</div>
      </div>
      <RateCell rate={likeRate} tone={likeRateTone(likeRate)} label={tr("likes")} />
      {savesState === "collecting" ? (
        // RÉSERVÉ aux posts qui n'ont AUCUN relevé portant des saves. Un post
        // dont le dernier relevé date d'hier affiche sa valeur DATÉE (ci-dessous),
        // pas cet état.
        <div className="w-16 shrink-0 text-right">
          <div
            className="text-xs italic text-slate-400"
            title={tr("aucunReleveAvecSavesPour")}
          >
            {tr("collecte")}
          </div>
          <div className="text-[10px] text-slate-400">{tr("saves")}</div>
        </div>
      ) : (
        <RateCell
          rate={saveRate}
          tone={savesState === "unavailable" ? "unknown" : saveRateTone(saveRate)}
          label={sourceDay && savesState === "measured" ? tr("savesAu", { sourceDay: sourceDay }) : tr("saves")}
          title={
            savesState === "measured" && p.saves !== null
              ? sourceDay
                ? tr("savesCountAu", { count: p.saves, views: formatNumber(p.saves, loc), sourceDay })
                : tr("savesCount", { count: p.saves, views: formatNumber(p.saves, loc) })
              : undefined
          }
        />
      )}
      <VerdictBadge verdict={verdictOf(p, now)} />
    </div>
  );
}

function Metric({
  value,
  label,
  title,
}: {
  value: string;
  label: string;
  title?: string;
}) {
  return (
    <div className="w-16 shrink-0 text-right" title={title}>
      <div className="text-xs tabular-nums text-slate-600">{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

const RATE_TONE_CLASS: Record<RateTone, string> = {
  bad: "text-rose-600",
  neutral: "text-slate-600",
  good: "text-emerald-600",
  unknown: "text-slate-400",
};

function RateCell({
  rate,
  tone,
  label,
  title,
}: {
  rate: number | null;
  tone: RateTone;
  label: string;
  title?: string;
}) {
  const loc = useIntlLocale();
  return (
    <div className="w-16 shrink-0 text-right" title={title}>
      <div className={cn("text-xs tabular-nums", RATE_TONE_CLASS[tone])}>
        {rate === null ? "—" : formatPercent(rate, undefined, loc)}
      </div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

// Libellés dans `admin.dashboard.verdict.*`.
const VERDICT_DISPLAY = {
  pending: { key: "pending", className: "text-slate-400 italic" },
  "open-door": { key: "openDoor", className: "text-violet-700 font-medium" },
  rising: { key: "rising", className: "text-emerald-700 font-medium" },
  fading: { key: "fading", className: "text-slate-400" },
  below: { key: "below", className: "text-rose-600" },
} as const satisfies Record<Verdict, { key: string; className: string }>;

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const tv = useTranslations("admin.dashboard.verdict");
  const d = VERDICT_DISPLAY[verdict];
  return (
    <span className={cn("w-24 shrink-0 text-right text-xs", d.className)}>
      {tv(d.key)}
    </span>
  );
}

// Libellés dans `admin.dashboard.postType.*`.
const TYPE_DISPLAY: Record<string, { key: string; className: string }> = {
  prouve: { key: "prouve", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  lab: { key: "lab", className: "border-sky-200 bg-sky-50 text-sky-700" },
  warmup: { key: "warmup", className: "border-amber-200 bg-amber-50 text-amber-700" },
  promo: { key: "promo", className: "border-violet-200 bg-violet-50 text-violet-700" },
};

function TypeBadge({ type }: { type: string }) {
  const tt = useTranslations("admin.dashboard.postType");
  const d = TYPE_DISPLAY[type] ?? TYPE_DISPLAY.promo;
  return (
    <Badge variant="outline" className={cn("shrink-0 text-[10px]", d.className)}>
      {tt(d.key as "prouve")}
    </Badge>
  );
}

// Libellés dans `admin.dashboard.accountState.*`.
const ACCOUNT_STATE_DISPLAY: Record<
  AccountState,
  { key: "window" | "cruise" | "alarm"; className: string }
> = {
  window: { key: "window", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  cruise: { key: "cruise", className: "border-slate-200 bg-slate-50 text-slate-600" },
  alarm: { key: "alarm", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

function AccountStateBadge({ state }: { state: AccountState }) {
  const ts = useTranslations("admin.dashboard.accountState");
  const d = ACCOUNT_STATE_DISPLAY[state];
  return (
    <Badge variant="outline" className={cn("shrink-0", d.className)}>
      {ts(d.key)}
    </Badge>
  );
}

/** En-tête d'un groupe de la file (libellé + compteur, teinté par urgence). */
function GroupHeader({
  icon: Icon,
  label,
  count,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-1.5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide">
      <Icon className={cn("size-3.5", tone)} />
      <span className={tone}>{label}</span>
      <span className="font-normal text-slate-400">({count})</span>
    </div>
  );
}

/** Bouton d'action INLINE d'une ligne de file (relance, paiement). */
function InlineAction({
  icon: Icon,
  label,
  busy,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="xs"
      className="h-7 gap-1 px-2"
      onClick={onClick}
      disabled={busy}
    >
      {busy ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <Icon className="size-3" />
      )}
      {label}
    </Button>
  );
}

/**
 * Ligne de la file : contexte à gauche, actions à droite. Toujours au moins un
 * accès direct à la surface concernée (« agir sans naviguer au hasard »), plus
 * une action inline quand elle existe (relancer, marquer payé).
 */
function WorklistRow({
  title,
  subtitle,
  href,
  hrefLabel,
  action,
  primary,
}: {
  title: string;
  subtitle: string;
  /** Lien de navigation — optionnel : une ligne de DÉCISION n'a qu'une action. */
  href?: string;
  hrefLabel?: string;
  action?: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900">
          {title}
        </div>
        <div className="truncate text-xs text-slate-500">{subtitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {action}
        {href !== undefined && hrefLabel !== undefined && (
          <Link
            href={href}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              primary
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-slate-200 text-slate-700 hover:bg-slate-50",
            )}
          >
            {hrefLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
  accent,
  warn,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="transition-colors group-hover:border-primary/40 group-hover:bg-primary/[0.03]">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                accent
                  ? "bg-primary/10 text-primary"
                  : warn
                    ? "bg-amber-50 text-amber-600"
                    : "bg-slate-100 text-slate-500",
              )}
            >
              <Icon className="size-4" />
            </span>
            <ArrowRightIcon className="size-4 text-slate-300 transition-colors group-hover:text-primary" />
          </div>
          <div
            className={cn(
              "mt-3 text-3xl font-bold tabular-nums",
              accent ? "text-primary" : "text-slate-900",
            )}
          >
            {value}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
          <div className="text-xs text-slate-400">{hint}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </h2>
          {action && (
            <Link
              href={action.href}
              className="text-xs font-medium text-primary hover:underline"
            >
              {action.label}
            </Link>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
      <Icon className="size-4" />
      {label}
    </div>
  );
}

function ActionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

// ─── Section « Ce que ça a rapporté » (conversion par créatrice) ─────────────

type ConversionData = FunctionReturnType<
  typeof api.conversionSync.readConversionAllTime
>;

/** Horodatage → "30/08 à 12h30" (Paris) — la fraîcheur d'une colonne se lit à
 *  l'heure, pas à la journée. */
function frDateTime(ms: number, locale: string = "fr-FR"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(ms))
    .replace(", ", " à ");
}

/** "YYYY-MM-DD" → "18/07/2026". */
function frDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function ConversionSection({ data }: { data: ConversionData | undefined }) {
  const tr = useTranslations("admin.dashboard.ConversionSection");
  const projectPath = useProjectPath();
  if (data === undefined) return <Skeleton className="h-24" />;
  if (data === null) {
    return (
      <EmptyRow
        icon={CalendarClockIcon}
        label={tr("pasEncoreDeDonneesPremiere")}
      />
    );
  }

  // Tout est DÉJÀ mis en forme par le serveur (convex/conversionSync) : lignes
  // affichées, totaux, conflits de refs, plages et attributions douteuses. Le
  // composant ne dérive plus rien — il n'a donc plus besoin des lignes brutes
  // par ref, ni de la liste des créatrices, ni de celle des influenceuses.
  const d = data.display;
  const conflicts = data.conflicts;
  const spanByRef = new Map(Object.entries(data.spans));
  const suspectRefs = new Set(data.suspectRefs);

  return (
    <div className="space-y-1">
      {conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <strong>
            {tr("refPorteeParPlusieursPersonnes", { count: conflicts.length })}
          </strong>{" "}{tr("chacuneAfficheLesMemesChiffres")}{" "}
          {conflicts
            .map((c) => `« ${c.ref} » : ${c.holders.join(", ")}`)
            .join(" · ")}
        </div>
      )}
      <div className="text-xs text-slate-400">
        {tr("depuisLeJourCollecteAttribution", { date: frDate(data.firstDate), collectedDays: data.collectedDays })}
      </div>
      {/* DEUX CADENCES dans le même tableau, écrites plutôt que sues. Les
          visiteurs viennent d'un relevé PostHog quotidien de 23 h ; les ventes
          sont lues en direct sur Whop, synchronisé toutes les heures. Sans cette
          ligne, une colonne arrêtée à la veille et une colonne à l'heure se
          lisent comme si elles décrivaient le même instant. */}
      <div className="text-xs text-slate-400">
        <span className="text-slate-500">{tr("visiteursEtInscrits")}</span>{" "}
        {data.visitorsThroughDate === null
          ? tr("enAttenteDuPremierReleve")
          : tr("arretesAuReleveQuotidienDe", { date: frDate(data.visitorsThroughDate) })}{" "}
        ·{" "}
        <span className="text-slate-500">{tr("ventesEtRevenu")}</span>{" "}
        {data.salesSyncMs === null
          ? tr("enAttenteDeLaSynchro")
          : tr("aJourSynchroWhopDu", { date: frDateTime(data.salesSyncMs) })}
      </div>
      <div className="divide-y divide-slate-100">
        {d.rows.map((row) => (
          <ConversionRow
            key={
              row.kind === "creator" || row.kind === "no-ref"
                ? `cr:${row.creatorId}`
                : `ref:${row.ref}`
            }
            row={row}
            span={row.kind === "no-ref" ? undefined : spanByRef.get(row.ref)}
            suspect={row.kind !== "no-ref" && suspectRefs.has(row.ref)}
            href={
              row.kind === "no-ref"
                ? projectPath(`/createurs/${row.creatorId}`)
                : undefined
            }
          />
        ))}
        {d.unattributed !== null && (
          <div className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1 text-sm text-slate-500">
              {tr("sansSource")}
              <div className="text-xs text-slate-400">
                {tr("traficEtVentesNonAttribues")}
              </div>
            </div>
            <ConversionCells
              visitors={d.unattributed.visitors}
              signups={d.unattributed.signups}
              sales={d.unattributed.sales}
              revenue={d.unattributed.revenue}
              currency={d.unattributed.currency}
            />
          </div>
        )}
        {/* DEUX totaux. Un seul, sous une liste où presque personne n'a de
            chiffre, laisserait croire à une attribution qui n'existe pas : en
            all-time l'essentiel du revenu n'est rattaché à aucune ref. Le
            « Total » reste la somme de TOUT, donc réconciliable avec Whop. */}
        <div className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1 text-sm font-medium text-slate-700">
            {tr("totalAttribue")}
            <div className="text-xs text-slate-400">
              {tr("refsRattacheesAQuelquUn")}
            </div>
          </div>
          <ConversionCells
            visitors={d.attributed.visitors}
            signups={d.attributed.signups}
            sales={d.attributed.sales}
            revenue={d.attributed.revenue}
            currency={d.attributed.currency}
          />
        </div>
        <div className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
            {tr("total")}
            <div className="text-xs font-normal text-slate-400">
              {tr("orphelinesEtSansSourceComprises")}
            </div>
          </div>
          <ConversionCells
            visitors={d.total.visitors}
            signups={d.total.signups}
            sales={d.total.sales}
            revenue={d.total.revenue}
            currency={d.total.currency}
          />
        </div>
      </div>
    </div>
  );
}

function ConversionRow({
  row,
  href,
  span,
  suspect,
}: {
  row: ConversionDisplayRow;
  href?: string;
  /** Plage réelle des données de cette ref — « 146 visiteurs » sur 2 jours ou
   *  sur 41 ne se lit pas pareil en all-time. */
  span?: { first: string; last: string };
  /** Données antérieures à l'existence de la créatrice → attribution douteuse. */
  suspect?: boolean;
}) {
  const tr = useTranslations("admin.dashboard.ConversionRow");
  if (row.kind === "no-ref") {
    // PAS un zéro : sans ref dans la bio, l'attribution est aveugle sur elle.
    // Le lien mène à sa fiche, où la ref se configure.
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm text-slate-500">{row.creatorName}</span>
        </div>
        {href !== undefined ? (
          <Link
            href={href}
            className="text-xs italic text-amber-700 hover:underline"
            title={tr("lAttributionReposeEntierementSur")}
          >
            {tr("pasDeRefConfiguree")}
          </Link>
        ) : (
          <span className="text-xs italic text-amber-700">
            {tr("pasDeRefConfiguree")}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium text-slate-900">
          {row.kind === "creator"
            ? row.creatorName
            : row.kind === "influencer"
              ? row.name
              : row.ref}
        </span>
        <span className="ml-1.5 text-xs text-slate-400">/{row.ref}</span>
        {/* Une créatrice PARTIE garde son historique à son nom — le badge dit la
            différence, avec le vocabulaire de la fiche et de la table Créateurs
            (lib/creator-status), pas un marqueur inventé ici. */}
        {row.kind === "creator" && row.status === "churned" && (
          <Badge
            variant="outline"
            className={`ml-1.5 align-middle text-[10px] ${creatorStatusBadge("churned").className}`}
          >
            {tr("statutParti")}
          </Badge>
        )}
        {row.kind === "influencer" && (
          <div className="text-xs text-slate-400">{tr("influenceuse")}</div>
        )}
        {row.kind === "ref-only" && (
          <div className="text-xs text-slate-400">
            {tr("refRattacheeAPersonne")}
          </div>
        )}
        {span !== undefined && (
          <div className="text-xs text-slate-400">
            {span.first === span.last
              ? tr("le", { date: frDate(span.first) })
              : tr("duAu", { date: frDate(span.first), date2: frDate(span.last) })}
          </div>
        )}
        {suspect === true && (
          <div
            className="text-xs italic text-amber-700"
            title={tr("cetteRefPorteDesConversions")}
          >
            {tr("donneesAnterieuresASonArrivee")}
          </div>
        )}
      </div>
      <ConversionCells
        visitors={row.visitors}
        signups={row.signups}
        sales={row.sales}
        revenue={row.revenue}
        currency={row.currency}
      />
    </div>
  );
}

/** Cellules chiffrées — « — » = source jamais collectée ce jour, pas un zéro. */
function ConversionCells({
  visitors,
  signups,
  sales,
  revenue,
  currency,
}: {
  visitors: number | null;
  signups: number | null;
  sales: number | null;
  revenue: number | null;
  currency: string | null;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.ConversionCells");
  return (
    <>
      <Metric
        value={visitors === null ? "—" : formatNumber(visitors, loc)}
        label={tr("visiteurs")}
      />
      <Metric
        value={signups === null ? "—" : formatNumber(signups, loc)}
        label={tr("signups")}
      />
      <Metric value={sales === null ? "—" : formatNumber(sales, loc)} label={tr("ventes")} />
      <div className="w-20 shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-slate-900">
          {revenue === null ? "—" : formatMoney(revenue, currency ?? undefined, loc)}
        </div>
        <div className="text-[10px] text-slate-400">{tr("revenu")}</div>
      </div>
    </>
  );
}
