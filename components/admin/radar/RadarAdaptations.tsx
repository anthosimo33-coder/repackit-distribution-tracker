"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useConvexError } from "@/lib/use-convex-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatPlannedDay } from "@/convex/calendarStatus";
import { formatCount, formatOutlierRatio } from "@/components/admin/radar/radar-format";
import { ACCENT_LINK } from "@/components/admin/radar/radar-ui";

type Data = FunctionReturnType<typeof api.radarAdaptations.listAdaptations>;
type Todo = Data["todo"][number];
type Linked = Data["doing"][number];

const DAY_FMT: Intl.DateTimeFormatOptions = { day: "numeric", month: "numeric" };

/**
 * RADAR — TES ADAPTATIONS (Aujourd'hui) : les vidéos « à adapter », reliées à la
 * campagne qui les reprend, puis ce que nos publications en disent — jugées
 * comme le Pilote, à 72 h (convex/radarAdaptations). Rien tant qu'aucune vidéo
 * n'est « à adapter ».
 */
export function RadarAdaptations() {
  const tr = useTranslations("admin.ops.RadarAdaptations");
  const d = useProjectQuery(api.radarAdaptations.listAdaptations, {});
  if (!d || d.todo.length + d.doing.length + d.results.length === 0) return null;

  const columns: { id: string; title: string; n: number; body: ReactNode; empty: string }[] = [
    { id: "todo", title: tr("aAdapter"), n: d.todo.length, empty: tr("aAdapterVide"), body: d.todo.map((x) => <TodoItem key={x.signalId} x={x} campaigns={d.campaigns} />) },
    { id: "doing", title: tr("enTournage"), n: d.doing.length, empty: tr("enTournageVide"), body: d.doing.map((x) => <DoingItem key={x.signalId} x={x} />) },
    { id: "results", title: tr("resultats"), n: d.results.length, empty: tr("resultatsVide"), body: d.results.map((x) => <ResultItem key={x.signalId} x={x} />) },
  ];

  return (
    <section aria-labelledby="radar-adaptations" className="flex flex-col gap-6" data-testid="radar-adaptations">
      <div className="flex max-w-3xl flex-col gap-1">
        <h2 id="radar-adaptations" className="text-lg font-semibold">
          {tr("titre")}
        </h2>
        <p className="text-sm leading-relaxed text-slate-500">{tr("aide")}</p>
      </div>
      <div className="grid items-start gap-x-10 gap-y-10 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        {columns.map((c) => (
          <section key={c.id} aria-labelledby={`radar-adaptations-${c.id}`} className="flex flex-col" data-testid={`radar-adaptations-${c.id}`}>
            <h3 id={`radar-adaptations-${c.id}`} className="flex items-baseline gap-2 border-b-2 border-slate-900 pb-3 text-sm font-semibold">
              {c.title}
              <span className="font-medium tabular-nums text-slate-400">{c.n}</span>
            </h3>
            {c.n === 0 ? <p className="py-4 text-sm text-slate-500">{c.empty}</p> : <ul className="flex flex-col">{c.body}</ul>}
          </section>
        ))}
      </div>
    </section>
  );
}

/** « 68× · @handle · FollowSpy » : d'où vient la vidéo. */
function Source({ x }: { x: Todo }) {
  const loc = useIntlLocale();
  return (
    <span className="text-[13px] text-slate-500">
      {formatOutlierRatio(x.score, loc)} ·{" "}
      <a href={x.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
        @{x.handle}
      </a>
      {x.app && ` · ${x.app}`}
    </span>
  );
}

function TodoItem({ x, campaigns }: { x: Todo; campaigns: Data["campaigns"] }) {
  const tr = useTranslations("admin.ops.RadarAdaptations");
  const link = useProjectMutation(api.radarAdaptations.linkAdaptation);
  const showError = useConvexError();
  const [saving, setSaving] = useState(false);
  const relier = async (campaignId: string) => {
    setSaving(true);
    try {
      await link({ signalId: x.signalId, campaignId: campaignId as Id<"scriptCampaigns"> });
    } catch (e) {
      toast.error(showError(e, tr("echec")));
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className="flex flex-col gap-2 border-b border-slate-100 py-4" data-testid="radar-adaptation">
      <span className="text-[15px] font-semibold leading-snug text-slate-900">{x.hook}</span>
      <Source x={x} />
      {campaigns.length === 0 ? (
        <span className="text-[13px] text-slate-500">{tr("aucuneCampagne")}</span>
      ) : (
        <Select value={null} items={Object.fromEntries(campaigns.map((c) => [c.id, c.name]))} onValueChange={(v) => v && void relier(v as string)} disabled={saving}>
          <SelectTrigger className="mt-1 h-auto min-h-9 w-full min-w-0 max-w-xs whitespace-normal py-1.5 text-left" aria-label={tr("relierAria", { handle: x.handle })}>
            <SelectValue>
              <span className="min-w-0 text-sm text-slate-500">{tr("relier")}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="min-w-0 break-words">{c.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </li>
  );
}

/** Le nom de la campagne, d'où elle vient, et « Délier ». */
function LinkedHead({ x }: { x: Linked }) {
  const tr = useTranslations("admin.ops.RadarAdaptations");
  const link = useProjectMutation(api.radarAdaptations.linkAdaptation);
  const showError = useConvexError();
  return (
    <>
      <span className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 text-[15px] font-semibold leading-snug text-slate-900" data-testid="radar-adaptation-campagne">
          {x.campaign.name}
        </span>
        <button
          type="button"
          onClick={() => void link({ signalId: x.signalId, campaignId: null }).catch((e: unknown) => toast.error(showError(e, tr("echec"))))}
          className={cn("shrink-0 text-[13px]", ACCENT_LINK)}
          aria-label={tr("delierAria", { campagne: x.campaign.name })}
        >
          {tr("delier")}
        </button>
      </span>
      <span className="text-[13px] leading-relaxed text-slate-500">{tr("dApres", { hook: x.hook })}</span>
      <Source x={x} />
    </>
  );
}

function DoingItem({ x }: { x: Linked }) {
  const tr = useTranslations("admin.ops.RadarAdaptations");
  const loc = useIntlLocale();
  const day = (t: number) => formatPlannedDay(t, loc, DAY_FMT);
  const r = x.result;
  return (
    <li className="flex flex-col gap-2 border-b border-slate-100 py-4" data-testid="radar-adaptation">
      <LinkedHead x={x} />
      <span className="text-[13px] font-medium text-slate-900" data-testid="radar-adaptation-etat">
        {x.missions === 0
          ? tr("aucuneMission")
          : x.firstDay !== null && x.lastDay !== null && x.firstDay !== x.lastDay
            ? tr("missionsDuAu", { n: x.missions, du: day(x.firstDay), au: day(x.lastDay) })
            : x.firstDay !== null
              ? tr("missionsLe", { n: x.missions, le: day(x.firstDay) })
              : tr("missions", { n: x.missions })}
        {r.published > 0 && ` · ${tr("publiees", { n: r.published })}`}
        {r.nextResultAt !== null && ` · ${tr("resultatsVers", { le: day(r.nextResultAt) })}`}
      </span>
    </li>
  );
}

function ResultItem({ x }: { x: Linked }) {
  const tr = useTranslations("admin.ops.RadarAdaptations");
  const key = (k: string) => k as Parameters<typeof tr>[0];
  const loc = useIntlLocale();
  const r = x.result;
  const rows: [string, string, boolean?][] = [
    [tr("publieesLabel"), String(r.published)],
    [tr("gagnantesLabel"), tr("surMesurees", { wins: r.wins, n: r.measured }), true],
    [tr("medianeLabel"), r.medianRatio !== null ? formatOutlierRatio(r.medianRatio, loc) : r.medianViews !== null ? tr("vues", { n: formatCount(r.medianViews, loc) }) : "—"],
    [tr("chezConcurrent"), formatOutlierRatio(x.score, loc)],
  ];
  return (
    <li className="flex flex-col gap-3 border-b border-slate-100 py-4" data-testid="radar-adaptation">
      <span className="flex flex-col gap-2">
        <LinkedHead x={x} />
      </span>
      <span
        className={cn("text-sm font-semibold", r.verdict === "marche" ? "text-slate-900" : "text-slate-500")}
        data-testid="radar-adaptation-verdict"
      >
        {r.verdict === "marche" && <span className="mr-2 inline-block size-2 rounded-full bg-primary align-middle" aria-hidden />}
        {tr(key(`verdict.${r.verdict}`))}
      </span>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value, strong]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className={cn("text-right tabular-nums", strong ? "font-semibold text-slate-900" : "text-slate-700")}>{value}</dd>
          </div>
        ))}
      </dl>
      {r.nextResultAt !== null && <span className="text-[13px] text-slate-500">{tr("suiteVers", { le: formatPlannedDay(r.nextResultAt, loc, DAY_FMT) })}</span>}
    </li>
  );
}
