"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { PaymentInfoNudge } from "@/components/portal/PaymentInfoNudge";
import { useMyPayments, useMyBonusStatus } from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { portalHref } from "@/lib/view-as";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format-rate";
import { formatDate } from "@/lib/format";
import { formatCycleRange } from "@/lib/pay-cycle";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { useTranslations } from "next-intl";

/**
 * « Mes paiements / gains » — écran RÉUTILISÉ par le portail créateur normal ET
 * le mode admin « voir l'espace d'un créateur ». Écran PUREMENT en lecture
 * (aucune mutation) → identique dans les deux modes, seules les données sont
 * scopées (useMyPayments / useMyBonusStatus : getMy* en normal, queries admin
 * scopées projet en view-as).
 */

type Payment = FunctionReturnType<typeof api.payments.getMyPayments>[number];

const DAY_MS = 86_400_000;
const fmtViews = (n: number, locale: string) => n.toLocaleString(locale);

/**
 * Paliers de bonus (cumul de vues À VIE) — motivant : cumul, jauge vers le
 * prochain palier, et mur des récompenses débloquées (cash + nature).
 */
function BonusTierPanel({
  projectId,
  currency,
}: {
  projectId: Id<"projects">;
  currency?: string | null;
}) {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const status = useMyBonusStatus(projectId);
  const base = usePortalBase();
  if (!status || (status.tiers.length === 0 && status.natureUnlocked.length === 0))
    return null;
  const next = status.nextTier;
  const prevSeuil = [...status.crossed]
    .map((t) => t.seuilVues)
    .sort((a, b) => b - a)[0] ?? 0;
  const span = next ? next.seuilVues - prevSeuil : 1;
  const done = next ? status.cumulViews - prevSeuil : 1;
  const pct = next ? Math.max(0, Math.min(100, Math.round((done / span) * 100))) : 100;
  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-amber-900">
            🏆 Paliers de récompense
          </span>
          <span
            className="text-sm font-medium tabular-nums text-amber-800"
            data-testid="cumul-views"
          >
            {fmtViews(status.cumulViews, loc)} vues cumulées
          </span>
        </div>
        {next ? (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-amber-100">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-amber-800">
              Plus que{" "}
              <span className="font-semibold tabular-nums">
                {fmtViews(status.viewsToNext ?? 0, loc)}
              </span>{" "}
              vues avant{" "}
              <span className="font-semibold">
                {next.rewardType === "cash"
                  ? `${formatMoney(next.montant ?? 0, currency, loc)}`
                  : next.libelle}
              </span>
              .
            </p>
          </div>
        ) : (
          <p className="text-xs text-amber-800">
            {t("progression.allUnlocked")}
          </p>
        )}
        {(status.cashUnlockedTotal > 0 || status.natureUnlocked.length > 0) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {status.cashUnlockedTotal > 0 && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                + {formatMoney(status.cashUnlockedTotal, currency, loc)} débloqués
              </span>
            )}
            {status.natureUnlocked.map((r, i) => (
              <span
                key={i}
                className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700"
              >
                🎁 {r.libelle}
              </span>
            ))}
          </div>
        )}
        <Link
          href={portalHref(base, "/progression")}
          className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-amber-900 underline underline-offset-4 hover:text-amber-700"
        >{t("paiements.seeProgress")}<ArrowRightIcon className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

const KIND_TAG = {
  base: { labelKey: "paiements.kind.base", className: "bg-slate-200 text-slate-600" },
  bonus: { labelKey: "paiements.kind.bonus", className: "bg-indigo-50 text-indigo-600" },
  fixed: { labelKey: "paiements.kind.fixed", className: "bg-emerald-50 text-emerald-600" },
  cpm: { labelKey: "paiements.kind.cpm", className: "bg-sky-50 text-sky-600" },
  bonus_tier: { labelKey: "paiements.kind.bonus_tier", className: "bg-amber-50 text-amber-600" },
  // Chantier pricing talent/clippeur — quatre modèles, quatre étiquettes.
  clip: { labelKey: "paiements.kind.clip", className: "bg-violet-50 text-violet-600" },
  retainer: { labelKey: "paiements.kind.retainer", className: "bg-teal-50 text-teal-600" },
} as const;

function KindTag({
  kind,
}: {
  kind:
    | "base"
    | "bonus"
    | "fixed"
    | "cpm"
    | "bonus_tier"
    | "clip"
    | "retainer";
}) {
  const tag = KIND_TAG[kind] ?? KIND_TAG.base;
  const tt = useTranslations("portal");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase",
        tag.className,
      )}
    >
      {tt(tag.labelKey)}
    </span>
  );
}

/**
 * Aperçu PRICING temps réel d'une période non payée : fixe acquis (X/cible
 * vidéos → Y$ sur montantFixe), CPM accumulé (sur les vues), bonus, total.
 */
function PricingBreakdown({
  b,
  currency,
}: {
  b: Payment["pricingBreakdown"];
  currency?: string | null;
}) {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  if (b.total <= 0 && b.perPricing.length === 0) return null;
  // Un cycle peut mélanger DEUX barèmes (un pricing édité en place laisse des
  // vidéos figées sur l'ancien) : on rend alors une ligne PAR barème, sinon le
  // libellé du premier groupe décrirait un total qui en couvre deux.
  const groupes = b.perPricing;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("paiements.liveDetail")}</p>
      {groupes.length === 0 ? (
        <Row label={t("paiements.fixe")} amount={b.fixedTotal} currency={currency} />
      ) : (
        groupes.map((g) => (
          <Row
            key={`${g.pricingId}:${g.montantFixe}:${g.nbVideosCible}`}
            label={`Fixe — ${g.videoCount}/${g.nbVideosCible} vidéos publiées`}
            sub={`sur ${formatMoney(g.montantFixe, currency, loc)}`}
            amount={g.fixed}
            currency={currency}
          />
        ))
      )}
      <Row label={t("paiements.cpmAccum")} amount={b.cpmTotal} currency={currency} />
      {b.bonusTierCashTotal > 0 &&
        (b.bonusTierCashUnlocks.length > 0 ? (
          // Une ligne par palier cash débloqué sur ce cycle (cohérent avec la
          // paie : Σ montants = bonusTierCashTotal, sous-total inchangé).
          b.bonusTierCashUnlocks.map((u, i) => (
            <Row
              key={i}
              label={`Bonus palier ${fmtViews(u.seuilVues, loc)} vues`}
              amount={u.montant}
              currency={currency}
            />
          ))
        ) : (
          // Cycle gelé (payé) → détail par palier indisponible : ligne agrégée.
          <Row
            label={t("paiements.bonusTiers")}
            amount={b.bonusTierCashTotal}
            currency={currency}
          />
        ))}
      <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-semibold">
        <span>{t("paiements.subtotal")}</span>
        <span className="tabular-nums" data-testid="pricing-total">
          {formatMoney(b.total, currency, loc)}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  sub,
  amount,
  currency,
}: {
  label: string;
  sub?: string;
  amount: number;
  currency?: string | null;
}) {
  const loc = useIntlLocale();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 text-slate-600">
        {label}
        {sub ? <span className="text-slate-400"> {sub}</span> : null}
      </span>
      <span className="shrink-0 tabular-nums text-slate-900">
        {formatMoney(amount, currency, loc)}
      </span>
    </div>
  );
}

function LineItems({ p, currency }: { p: Payment; currency?: string | null }) {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  return (
    <ul className="divide-y divide-slate-100">
      {p.lineItems.map((li, i) => (
        <li
          key={i}
          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <KindTag kind={li.kind} />
            <span className="truncate text-slate-700">{li.label}</span>
          </span>
          <span className="shrink-0 tabular-nums text-slate-900">
            {formatMoney(li.amount, currency, loc)}
          </span>
        </li>
      ))}
      <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold">
        <span>{t("paiements.total")}</span>
        <span className="tabular-nums">{formatMoney(p.totalDue, currency, loc)}</span>
      </li>
    </ul>
  );
}

function PastPeriod({ p, currency }: { p: Payment; currency?: string | null }) {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <ChevronRightIcon
            className={cn(
              "size-4 shrink-0 text-slate-400 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="font-medium text-slate-900">
            {formatCycleRange(p.cycleStart, p.cycleEnd, loc)}
          </span>
          {p.status === "paid" ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Payé{p.paidAt ? ` le ${formatDate(p.paidAt, loc)}` : ""}
            </span>
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{t("paiements.pending")}</span>
          )}
        </span>
        <span className="shrink-0 tabular-nums font-medium text-slate-900">
          {formatMoney(p.totalDue, currency, loc)}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          <LineItems p={p} currency={currency} />
        </div>
      )}
    </Card>
  );
}

export default function PaiementsScreen() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const { current: currentProject } = useCreatorProject();
  // Devise de la paie créatrices (projects.payCurrency, $ Snytch ; null → sans
  // symbole), passée aux sous-composants (un hook ne court qu'en corps de composant).
  const payCurrency = currentProject.payCurrency;
  const payments = useMyPayments(currentProject.projectId);

  const loading = payments === undefined;
  const list = payments ?? [];
  // Ancre temporelle stable au montage (relative time déterministe au render).
  const [now] = useState(() => Date.now());
  // Cycle J+30 EN COURS = celui qui contient maintenant (sinon le plus récent).
  const current =
    list.find((p) => now >= p.cycleStart && now < p.cycleEnd) ?? list[0] ?? null;
  const past = list.filter((p) => p !== current);
  const dueNow = current?.totalDue ?? 0;
  // « Prochaine paie » = FIN du cycle courant (plus de « 10 du mois »).
  const nextTs = current?.cycleEnd ?? null;
  const days =
    nextTs !== null ? Math.max(0, Math.ceil((nextTs - now) / DAY_MS)) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t("paiements.title")}</h1>

      {/* QW3 — coordonnées de paiement manquantes alors que des gains sont dus. */}
      <PaymentInfoNudge projectId={currentProject.projectId} />

      <BonusTierPanel projectId={currentProject.projectId} currency={payCurrency} />

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {/* Montant dû (période en cours) + prochaine date de paie */}
          <Card>
            <CardContent className="space-y-1 py-7 text-center">
              <p className="text-sm text-slate-500">
                {current
                  ? t("paiements.dueForCycle", { range: formatCycleRange(current.cycleStart, current.cycleEnd, loc) })
                  : t("paiements.dueThisCycle")}
              </p>
              <p
                className="text-4xl font-semibold tabular-nums text-slate-900"
                data-testid="due-now"
              >
                {formatMoney(dueNow, payCurrency, loc)}
              </p>
              {nextTs !== null && days !== null ? (
                <p className="text-sm text-slate-500">
                  {dueNow > 0
                    ? `Payé dans ${days} jour${days > 1 ? "s" : ""} (le ${formatDate(nextTs, loc)})`
                    : `Prochaine paie le ${formatDate(nextTs, loc)}`}
                </p>
              ) : (
                <p className="text-sm text-slate-500">{t("paiements.firstPayHint")}</p>
              )}
            </CardContent>
          </Card>

          {/* Détail — période en cours : aperçu pricing temps réel (nouveau
              modèle) + lineItems legacy éventuelles. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t("paiements.currentCycle")}</h2>
            {!current ||
            (current.lineItems.length === 0 &&
              current.pricingBreakdown.total <= 0) ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-slate-500">{t("paiements.noVideoCycle")}</CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                <PricingBreakdown b={current.pricingBreakdown} currency={payCurrency} />
                {current.lineItems.length > 0 && (
                  <Card>
                    <CardContent className="p-0">
                      <LineItems p={current} currency={payCurrency} />
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </section>

          {/* Historique des périodes passées (repliées) */}
          {past.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t("paiements.history")}</h2>
              <div className="space-y-2">
                {past.map((p) => (
                  <PastPeriod key={p.key} p={p} currency={payCurrency} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
