"use client";

import { useState } from "react";
import Link from "next/link";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useMyContracts,
  useMyPayments,
  useMyTerms,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { ContractFilesList } from "@/components/portal/ContractFilesList";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  bonusLadder,
  fixePerVideo,
  termsPosition,
  termsRules,
  type Terms,
  type TermsPosition,
  type TermsRule,
} from "@/lib/creator-terms";
import { formatMoney, formatMoneyWhole } from "@/lib/format-rate";
import { portalHref } from "@/lib/view-as";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { cn } from "@/lib/utils";
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  FlameIcon,
  LayersIcon,
  ShieldIcon,
  TrendingUpIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * « MON CONTRAT » — le barème de la créatrice, relisible à tout moment : fixe,
 * vues, bonus par vidéo, les règles qui vont avec, et le PDF signé.
 *
 * Le barème vient de `creatorTerms` (celui qui la paie) ; sa position dans le
 * cycle vient du MÊME breakdown que « Mes paiements ». Seuls les blocs que son
 * contrat contient sont rendus : un CPM à 0 n'est pas une ligne « 0 € pour
 * 1 000 vues », c'est une absence.
 *
 * Écran RÉUTILISÉ en observation (sous-page d'argent, cf MONEY_SUBS).
 */

const RULE_ICON: Record<TermsRule, LucideIcon> = {
  platformsAdd: LayersIcon,
  window30: CalendarIcon,
  warmupNoBonus: FlameIcon,
  highestTierOnly: TrendingUpIcon,
  tiersAdd: TrendingUpIcon,
  capPerVideo: ShieldIcon,
  paidEvery30: WalletIcon,
};

/** Un montant de contrat : sans centimes quand il est rond (« 700 € », « 11,67 € »). */
function useMoney(currency: string | null) {
  const loc = useIntlLocale();
  return (n: number) =>
    Number.isInteger(n) ? formatMoneyWhole(n, currency, loc) : formatMoney(n, currency, loc);
}

function Block({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-2 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function FixeBlock({ terms, position }: { terms: Terms; position: TermsPosition | null }) {
  const t = useTranslations("portal.contrat");
  const loc = useIntlLocale();
  const money = useMoney(terms.currency);
  const done = position?.fixe.videoCount ?? 0;
  const pct = Math.min(100, Math.round((done / Math.max(1, terms.nbVideosCible)) * 100));
  return (
    <Block label={t("fixe.label")} testId="terms-fixe">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {money(terms.montantFixe)}
        </span>
        <span className="text-sm text-slate-500">
          {t("fixe.forVideos", { count: terms.nbVideosCible })}
        </span>
      </div>
      <p className="text-sm text-slate-500">
        {t("fixe.perVideo", { amount: money(Math.round(fixePerVideo(terms) * 100) / 100) })}
      </p>
      {terms.seuilVuesFixe > 0 && (
        <p className="text-sm text-slate-500">
          {t("fixe.seuil", { views: terms.seuilVuesFixe.toLocaleString(loc) })}
        </p>
      )}
      {position && (
        <div className="space-y-1 pt-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between gap-3 text-xs tabular-nums text-slate-500">
            <span>{t("fixe.progress", { done, target: terms.nbVideosCible })}</span>
            <span>
              {position.fixe.fixeBloque
                ? t("fixe.locked", {
                    done: position.fixe.groupViews.toLocaleString(loc),
                    target: terms.seuilVuesFixe.toLocaleString(loc),
                  })
                : t("fixe.earned", { amount: formatMoney(position.fixe.fixed, terms.currency, loc) })}
            </span>
          </div>
        </div>
      )}
    </Block>
  );
}

function CpmBlock({ terms }: { terms: Terms }) {
  const t = useTranslations("portal.contrat");
  const money = useMoney(terms.currency);
  return (
    <Block label={t("cpm.label")} testId="terms-cpm">
      <p className="text-2xl font-semibold tabular-nums text-slate-900">
        {t("cpm.rate", { amount: money(terms.tauxCPM) })}
      </p>
      <p className="text-sm text-slate-500">
        {t("cpm.cap", { amount: money(terms.plafondParVideo) })}
      </p>
    </Block>
  );
}

function VideoBonusBlock({
  terms,
  position,
  bestTitle,
}: {
  terms: Terms;
  position: TermsPosition | null;
  bestTitle: string | null;
}) {
  const t = useTranslations("portal.contrat");
  const loc = useIntlLocale();
  const money = useMoney(terms.currency);
  const grid = terms.videoBonus!;
  const best = position?.bestVideo ?? null;
  const ladder = bonusLadder(grid, best?.views ?? null);
  return (
    <Block label={t("bonus.label")} testId="terms-video-bonus">
      <ol className="space-y-1">
        {ladder.rows.map((r) => (
          <li
            key={r.seuilVues}
            data-state={r.state}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm tabular-nums",
              r.state === "done" && "bg-emerald-50 text-emerald-800",
              r.state === "next" && "border border-primary/40 text-slate-900",
              r.state === "todo" && "bg-slate-50 text-slate-500",
            )}
          >
            <span className="flex items-center gap-1.5">
              {r.state === "done" && <CheckIcon className="size-3.5" />}
              {t("bonus.tier", { views: r.seuilVues.toLocaleString(loc) })}
              {r.state === "next" && ladder.toNext !== null && (
                <span className="text-slate-500">
                  · {t("bonus.toNext", { views: ladder.toNext.toLocaleString(loc) })}
                </span>
              )}
            </span>
            <span className="font-medium">{money(r.montant)}</span>
          </li>
        ))}
      </ol>
      <p className="pt-1 text-xs text-slate-500" data-testid="terms-best-video">
        {best
          ? bestTitle
            ? t("bonus.best", { title: bestTitle, views: best.views.toLocaleString(loc) })
            : t("bonus.bestNoTitle", { views: best.views.toLocaleString(loc) })
          : t("bonus.none")}
      </p>
    </Block>
  );
}

export default function ContratScreen() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const { current: project } = useCreatorProject();
  const base = usePortalBase();
  const terms = useMyTerms(project.projectId);
  const payments = useMyPayments(project.projectId);
  const contracts = useMyContracts(project.projectId);
  const [now] = useState(() => Date.now());

  // Cycle EN COURS — même choix que « Mes paiements ». Un cycle déjà payé n'a
  // plus de breakdown par barème : pas de position plutôt qu'une fausse.
  const cycle =
    payments?.find((p) => now >= p.cycleStart && now < p.cycleEnd) ?? payments?.[0] ?? null;
  const pricing = terms?.pricing ?? null;
  const live = cycle && cycle.status !== "paid" ? cycle : null;
  const position: TermsPosition | null =
    pricing === null
      ? null
      : live
        ? termsPosition(pricing, live.pricingBreakdown)
        : {
            fixe: { videoCount: 0, fixed: 0, groupViews: 0, fixeBloque: pricing.seuilVuesFixe > 0 },
            bestVideo: null,
            otherTerms: false,
          };
  const bestTitle =
    position?.bestVideo && live
      ? (live.bonusVideos.find((v) => v.assignmentId === position.bestVideo!.assignmentId)
          ?.title ?? null)
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {t("contrat.title")}
        </h1>
        <p className="text-sm text-slate-500">{t("contrat.subtitle")}</p>
      </header>

      {terms === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : pricing === null ? (
        <Card data-testid="terms-none">
          <CardContent className="py-6 text-sm text-slate-500">{t("contrat.noTerms")}</CardContent>
        </Card>
      ) : (
        <>
          {position?.otherTerms && (
            <p
              data-testid="terms-other"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              {t("contrat.otherTerms")}
            </p>
          )}
          {pricing.montantFixe > 0 && <FixeBlock terms={pricing} position={position} />}
          {pricing.tauxCPM > 0 && <CpmBlock terms={pricing} />}
          {pricing.videoBonus && (
            <VideoBonusBlock terms={pricing} position={position} bestTitle={bestTitle} />
          )}
          {pricing.hasCumulTiers && (
            <Link
              href={portalHref(base, "/progression")}
              data-testid="terms-cumul-tiers"
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm hover:bg-slate-50"
            >
              <span className="font-medium text-slate-900">{t("contrat.cumul.label")}</span>
              <span className="inline-flex items-center gap-1 text-slate-500">
                {t("contrat.cumul.link")}
                <ArrowRightIcon className="size-3.5" />
              </span>
            </Link>
          )}
          <Block label={t("contrat.rules.title")} testId="terms-rules">
            <ul className="space-y-1.5">
              {termsRules(pricing).map((r) => {
                const Icon = RULE_ICON[r];
                return (
                  <li key={r} data-rule={r} className="flex gap-2 text-sm text-slate-700">
                    <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
                    <span>
                      {r === "capPerVideo"
                        ? t("contrat.rules.capPerVideo", {
                            amount: formatMoneyWhole(pricing.plafondParVideo, pricing.currency, loc),
                          })
                        : t(`contrat.rules.${r}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Block>
        </>
      )}

      <Block label={t("profil.contractTitle")} testId="terms-files">
        <ContractFilesList contracts={contracts} />
      </Block>
    </div>
  );
}
