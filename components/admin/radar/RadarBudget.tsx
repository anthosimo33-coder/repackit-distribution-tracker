"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { usePermissions } from "@/components/project/use-permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { formatRelative } from "@/components/admin/radar/radar-format";
import { formatMoney } from "@/lib/format-rate";
import {
  CAP_CHOICES,
  DAYS_PER_MONTH,
  POSTES,
  POSTE_KEYS,
  SC_PACK_CREDITS,
  budgetState,
  envelopeCredits,
  envelopeUsd,
  plannedUsd,
  type BudgetSettings,
  type PosteKey,
} from "@/convex/radarSignalsMath";

type BudgetData = FunctionReturnType<typeof api.radarSignals.getRadarBudget>;

/**
 * NOUVEAU RADAR — Budget : ce que la veille coûte chaque mois, ce qu'on achète
 * avec, et ce qui s'arrête en premier quand le plafond approche. Les règles
 * sont celles des tâches (convex/radarSignalsMath) : ce que l'écran projette,
 * c'est ce que la collecte fera.
 */
export function RadarBudget() {
  const data = useProjectQuery(api.radarSignals.getRadarBudget, {});
  if (data === undefined) return <Skeleton className="h-[640px] w-full" />;
  // Le brouillon repart des réglages enregistrés quand ils changent.
  return <BudgetEditor key={JSON.stringify(data.budget)} data={data} />;
}

function BudgetEditor({ data }: { data: BudgetData }) {
  const tr = useTranslations("admin.ops.RadarBudget");
  const k = (key: string) => key as Parameters<typeof tr>[0];
  const loc = useIntlLocale();
  const droits = usePermissions();
  const showError = useConvexError();
  const save = useProjectMutation(api.radarSignals.saveRadarBudget);
  const [draft, setDraft] = useState<BudgetSettings>(data.budget);
  const [saving, setSaving] = useState(false);
  const canEdit = droits.has("project.settings");
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.budget);

  // La devise vient de la donnée (celle où ScrapeCreators facture), le format du
  // formateur central : « 4,00 $ », jamais « 4,00 $US ».
  const money = (x: number) => formatMoney(x, data.currency, loc);
  const int = (x: number) => new Intl.NumberFormat(loc).format(Math.round(x));

  // Projection avec le BROUILLON, sur la dépense réelle du mois.
  const usage = POSTE_KEYS.map((p) => ({ poste: p, credits: data.state.byPoste[p].credits }));
  const st = budgetState(draft, usage);
  const planned = plannedUsd(draft);
  const spentPct = Math.min(100, (st.spentUsd / draft.capUsd) * 100);
  const plannedOver = planned > draft.capUsd;
  const posteOf = (p: PosteKey) => draft.postes.find((x) => x.key === p)!;
  const setPoste = (p: PosteKey, patch: Partial<{ qty: number; on: boolean }>) =>
    setDraft((d) => ({ ...d, postes: d.postes.map((x) => (x.key === p ? { ...x, ...patch } : x)) }));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const c = d.cutOrder.slice();
      [c[i], c[i + by]] = [c[i + by], c[i]];
      return { ...d, cutOrder: c };
    });
  const totalCredits = POSTE_KEYS.reduce((sum, p) => sum + envelopeCredits(draft, p), 0);
  const perDay = totalCredits / DAYS_PER_MONTH;
  const daysLeft = data.jobs.creditsRemaining !== null && perDay > 0 ? Math.floor(data.jobs.creditsRemaining / perDay) : null;

  async function onSave() {
    setSaving(true);
    try {
      await save({ capUsd: draft.capUsd, postes: draft.postes, cutOrder: draft.cutOrder, alert80: draft.alert80 });
      toast.success(tr("enregistre"));
    } catch (err) {
      toast.error(showError(err, tr("enregistrementImpossible")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="min-w-0 flex-[999_1_560px] space-y-4">
        {/* État de la collecte */}
        {!data.jobs.keyPresent ? (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {tr("cleAbsente")}
          </p>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {tr("etatCollecte", {
              decouverte: formatRelative(data.jobs.lastDiscoveryAt, loc),
              courbe: formatRelative(data.jobs.lastCurveAt, loc),
            })}
            {data.jobs.creditsRemaining !== null && (
              <>
                {" "}
                {tr("creditsRestants", { n: int(data.jobs.creditsRemaining) })}
                {daysLeft !== null && ` ${tr("joursDeCollecte", { n: daysLeft })}`}
              </>
            )}
            {data.jobs.lastError && <span className="mt-1 block text-red-700">{tr("derniereErreur", { erreur: data.jobs.lastError })}</span>}
          </p>
        )}

        {/* Plafond */}
        <section aria-labelledby="radar-plafond" className="space-y-3 rounded-xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="radar-plafond" className="text-base font-semibold">{tr("plafondMensuel")}</h2>
            <div role="radiogroup" aria-labelledby="radar-plafond" className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {CAP_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.capUsd === c}
                  disabled={!canEdit}
                  onClick={() => setDraft((d) => ({ ...d, capUsd: c }))}
                  className={cn("min-h-10 min-w-16 rounded-md px-3 font-semibold", draft.capUsd === c ? "bg-slate-900 text-white" : "text-slate-700")}
                >
                  {money(c)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight" data-testid="radar-budget-depense">{money(st.spentUsd)}</span>
            <span className="text-slate-500">{tr("depenseCeMois", { plafond: money(draft.capUsd) })}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className={cn("h-3", st.capReached ? "bg-red-700" : st.over80 ? "bg-orange-500" : "bg-slate-900")} style={{ width: `${spentPct}%` }} />
          </div>
          <p className="text-sm text-slate-700">
            {tr("prevu", { prevu: money(planned) })}
            {" · "}
            {tr("projection", { projection: money(st.projectedUsd) })}
          </p>
          <p className={cn("text-sm font-semibold", plannedOver ? "text-red-700" : "text-green-800")} data-testid="radar-budget-verdict">
            {plannedOver ? tr("depassePlafond", { ecart: money(planned - draft.capUsd) }) : tr("margeRestante", { marge: money(draft.capUsd - planned) })}
          </p>
          {st.cut.length > 0 && (
            <p className="text-sm text-orange-800">{tr("postesCoupes", { postes: st.cut.map((p) => tr(k(`poste.${p}.titre`))).join(", ") })}</p>
          )}
        </section>

        {/* Postes */}
        <section aria-labelledby="radar-postes" className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex flex-wrap justify-between gap-2 border-b border-slate-200 px-5 py-4">
            <h2 id="radar-postes" className="text-base font-semibold">{tr("ceQuOnAchete")}</h2>
            <span className="text-sm text-slate-500">{tr("prixDuCredit", { prix: money(data.pricePerCredit * 1000) })}</span>
          </div>
          {POSTES.map((def) => {
            const p = posteOf(def.key);
            const active = def.live && p.on;
            const credits = envelopeCredits(draft, def.key);
            return (
              <div key={def.key} className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-slate-100 px-5 py-3.5 first:border-t-0", !active && "opacity-60")}>
                <div className="min-w-0 flex-[1_1_260px]">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    {tr(k(`poste.${def.key}.titre`))}
                    {!def.live && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{tr("pasEncoreBranche")}</span>}
                  </div>
                  <div className="text-[13px] text-slate-500">{tr(k(`poste.${def.key}.aide`))}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={tr("baisser", { poste: tr(k(`poste.${def.key}.titre`)) })}
                    disabled={!canEdit || !active || p.qty <= 0}
                    onClick={() => setPoste(def.key, { qty: Math.max(0, p.qty - def.step) })}
                    className="size-10 rounded-lg border border-slate-300 bg-white text-lg disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-32 text-center tabular-nums">
                    <strong>{int(p.qty)}</strong> <span className="text-[13px] text-slate-500">{tr(k(`poste.${def.key}.unite`))}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={tr("augmenter", { poste: tr(k(`poste.${def.key}.titre`)) })}
                    disabled={!canEdit || !active || p.qty >= def.max}
                    onClick={() => setPoste(def.key, { qty: Math.min(def.max, p.qty + def.step) })}
                    className="size-10 rounded-lg border border-slate-300 bg-white text-lg disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                <div className="w-36 text-right">
                  <div className="font-bold tabular-nums">{active ? money(envelopeUsd(draft, def.key)) : tr("coupe")}</div>
                  <div className="text-xs tabular-nums text-slate-500">{def.dollars ? tr("plafondIa") : tr("creditsParMois", { n: int(credits) })}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  aria-label={tr(active ? "couper" : "rallumer", { poste: tr(k(`poste.${def.key}.titre`)) })}
                  disabled={!canEdit || !def.live}
                  onClick={() => setPoste(def.key, { on: !p.on })}
                  className="inline-flex min-h-11 items-center px-1 disabled:opacity-40"
                >
                  <span className={cn("relative inline-block h-[22px] w-10 rounded-full", active ? "bg-slate-900" : "bg-slate-300")}>
                    <span className={cn("absolute top-[3px] size-4 rounded-full bg-white transition-all", active ? "left-[21px]" : "left-[3px]")} />
                  </span>
                </button>
              </div>
            );
          })}
        </section>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className="min-h-11 rounded-lg bg-slate-900 px-5 font-semibold text-white disabled:opacity-50"
            >
              {saving ? tr("enregistrement") : tr("enregistrerLeBudget")}
            </button>
            {dirty && (
              <button type="button" onClick={() => setDraft(data.budget)} className="min-h-11 px-2 text-sm font-semibold text-slate-600 underline">
                {tr("annulerLesModifications")}
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{tr("reserveAuxReglages")}</p>
        )}
      </div>

      <aside className="min-w-0 flex-[1_1_340px] space-y-4">
        <section aria-labelledby="radar-donne" className="space-y-2 rounded-xl border border-slate-200 p-5">
          <h2 id="radar-donne" className="text-base font-semibold">{tr("ceQueCaDonne")}</h2>
          {[
            [tr("videosAuCrible"), int(posteOf("search").on ? posteOf("search").qty * 30 * DAYS_PER_MONTH : 0)],
            [tr("videosSuivies"), int(posteOf("curve").on ? posteOf("curve").qty * DAYS_PER_MONTH : 0)],
            [tr("creditsParMoisTotal"), tr("creditsEtPacks", { credits: int(totalCredits), packs: (totalCredits / SC_PACK_CREDITS).toLocaleString(loc, { maximumFractionDigits: 2 }) })],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-sm first:border-t-0 first:pt-0">
              <span className="text-slate-700">{label}</span>
              <span className="text-right font-bold tabular-nums">{value}</span>
            </div>
          ))}
        </section>

        <section aria-labelledby="radar-coupure" className="space-y-3 rounded-xl border border-slate-200 p-5">
          <h2 id="radar-coupure" className="text-base font-semibold">{tr("quandLePlafondApproche")}</h2>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={draft.alert80}
              disabled={!canEdit}
              onChange={() => setDraft((d) => ({ ...d, alert80: !d.alert80 }))}
              className="size-[18px] accent-slate-900"
            />
            <span>{tr("alerte80")}</span>
          </label>
          <p className="text-xs text-slate-500">{data.alertHere ? tr("alerteIci") : tr("alerteAilleurs")}</p>
          <p className="text-sm text-slate-600">{tr("ordreDeCoupure")}</p>
          <ol className="space-y-1.5">
            {draft.cutOrder.map((p, i) => (
              <li key={p} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <span className="flex size-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold">{i + 1}</span>
                <span className="flex-1">{tr(k(`poste.${p}.titre`))}</span>
                <button
                  type="button"
                  aria-label={tr("monter", { poste: tr(k(`poste.${p}.titre`)) })}
                  disabled={!canEdit || i === 0}
                  onClick={() => move(i, -1)}
                  className="flex size-9 items-center justify-center rounded-md border border-slate-300 disabled:opacity-40"
                >
                  <ArrowUpIcon className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={tr("descendre", { poste: tr(k(`poste.${p}.titre`)) })}
                  disabled={!canEdit || i === draft.cutOrder.length - 1}
                  onClick={() => move(i, 1)}
                  className="flex size-9 items-center justify-center rounded-md border border-slate-300 disabled:opacity-40"
                >
                  <ArrowDownIcon className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="radar-jours" className="space-y-2 rounded-xl border border-slate-200 p-5">
          <h2 id="radar-jours" className="text-base font-semibold">{tr("depenseParJour")}</h2>
          {data.days.length === 0 ? (
            <p className="text-sm text-slate-500">{tr("aucuneDepense")}</p>
          ) : (
            <ul className="space-y-1">
              {data.days.map((d) => (
                <li key={d.day} className="flex justify-between text-sm tabular-nums">
                  <span>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(loc, { day: "numeric", month: "short" })}</span>
                  <span>
                    {tr("creditsCourt", { n: int(d.credits) })} · {money(d.credits * data.pricePerCredit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
