"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  managerPayAllPeriods,
  managerPayByCreator,
  managerPeriodStatus,
  roundCents,
  sumManagerPayRows,
  type ManagerPeriodStatus,
} from "@/convex/managerCpm";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { formatMoney } from "@/lib/format-rate";
import { formatMoneyDate, formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { cn } from "@/lib/utils";

type Payload = NonNullable<FunctionReturnType<typeof api.managerPay.getMyManagerPay>>;

const ALL = "all";

/**
 * RELEVÉ DE RÉMUNÉRATION D'UN MANAGER — partagé par son écran (« Ma
 * rémunération ») et par la carte du superadmin (« Rôles et droits »). Les deux
 * lisent le même payload serveur et le rendent ici : un chiffre ne peut pas
 * différer selon qui le regarde.
 *
 * L'écran ADDITIONNE des montants déjà calculés par le serveur (une ligne par
 * créatrice × mois) ; il ne multiplie jamais un CPM par des vues.
 *
 * `admin` présent (superadmin seul) ⇒ boutons « Marquer payé » et « Annuler ».
 * Le manager voit les mêmes statuts, sans les gestes. Le serveur refuse ces
 * gestes à tout autre que le superadmin, bouton ou pas.
 */
export function ManagerPayReport({
  data,
  admin,
}: {
  data: Payload;
  admin?: { membershipId: Id<"memberships">; managerLabel: string };
}) {
  const tr = useTranslations("admin.money.ManagerPayReport");
  const loc = useIntlLocale();
  const [period, setPeriod] = useState<string>(ALL);

  const periods = useMemo(
    () => managerPayAllPeriods(data.rows, data.payouts),
    [data.rows, data.payouts],
  );
  const statuses = useMemo(
    () => periods.map((p) => managerPeriodStatus(data.rows, data.payouts, p)),
    [periods, data.rows, data.payouts],
  );
  const selected = period === ALL ? null : period;
  const totals = sumManagerPayRows(data.rows, selected);
  const scoped = statuses.filter((s) => selected === null || s.period === selected);
  const due = roundCents(scoped.reduce((s, x) => s + x.due, 0));
  const paid = roundCents(scoped.reduce((s, x) => s + x.paid, 0));
  const remaining = roundCents(scoped.reduce((s, x) => s + Math.max(0, x.remaining), 0));
  const byCreator = managerPayByCreator(data.rows, selected);
  const nameOf = new Map(data.creators.map((c) => [c.creatorId as string, c.name]));
  const creatorOf = new Map(data.creators.map((c) => [c.creatorId as string, c]));

  const money = (n: number) => formatMoney(n, data.currency, loc);
  const cpmLabel = (cpm: number) => tr("cpmValeur", { cpm: money(cpm) });
  // Le taux d'AUJOURD'HUI, et depuis quand s'il a changé : les vidéos d'avant
  // restent à l'ancien taux, le relevé doit permettre de le relire.
  const cpmCell = (creatorId: string) => {
    const c = creatorOf.get(creatorId);
    if (!c) return "—";
    const last = c.history[c.history.length - 1];
    const prev = c.history[c.history.length - 2];
    const date = last?.from != null ? formatMoneyDate(last.from, loc) : null;
    return (
      <>
        <span className="block">
          {c.cpm > 0 ? cpmLabel(c.cpm) : tr("cpmArrete", { date: date ?? "—" })}
        </span>
        {c.cpm > 0 && date && (
          <span className="block text-[11px] text-slate-400">
            {prev
              ? tr("cpmDepuis", { date, ancien: money(prev.cpm) })
              : tr("cpmDepuisSeul", { date })}
          </span>
        )}
      </>
    );
  };
  const monthLabel = (p: string) => {
    const [y, m] = p.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(loc, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  };

  // Les créatrices sans aucune vidéo sur la période restent listées : un taux
  // posé qui ne rapporte rien doit se voir, pas disparaître.
  const creatorRows = [
    ...byCreator,
    ...data.creators
      .filter((c) => !byCreator.some((b) => b.creatorId === c.creatorId))
      .map((c) => ({
        creatorId: c.creatorId as string,
        videos: 0,
        payableViews: 0,
        totalViews: 0,
        amount: 0,
      })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{tr("periode")}</span>
        <Select value={period} onValueChange={(v) => v && setPeriod(v)}>
          <SelectTrigger className="h-8 w-52" aria-label={tr("periode")}>
            <SelectValue>
              {period === ALL ? tr("toutesPeriodes") : monthLabel(period)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={ALL}>{tr("toutesPeriodes")}</SelectItem>
            {periods.map((p) => (
              <SelectItem key={p} value={p}>
                {monthLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label={tr("remuneration")} value={money(due)} strong />
        <Stat label={tr("dejaVerse")} value={money(paid)} />
        <Stat
          label={tr("resteAPayer")}
          value={money(remaining)}
          tone={remaining > 0 ? "amber" : "default"}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("creatrice")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{tr("videos")}</TableHead>
                <TableHead className="text-right">{tr("vuesPayees")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  {tr("vuesTotales")}
                </TableHead>
                <TableHead className="hidden text-right sm:table-cell">{tr("cpm")}</TableHead>
                <TableHead className="text-right">{tr("montant")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creatorRows.map((r) => (
                <TableRow key={r.creatorId}>
                  <TableCell className="max-w-32 truncate font-medium sm:max-w-48">
                    {nameOf.get(r.creatorId) ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatNumber(r.videos, loc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.payableViews, loc)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums text-slate-500 sm:table-cell">
                    {formatNumber(r.totalViews, loc)}
                  </TableCell>
                  <TableCell className="hidden text-right text-slate-500 sm:table-cell">
                    {cpmCell(r.creatorId)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(r.amount)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-slate-50">
                <TableCell className="font-semibold">{tr("total")}</TableCell>
                <TableCell className="hidden text-right font-semibold tabular-nums sm:table-cell">
                  {formatNumber(totals.videos, loc)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNumber(totals.payableViews, loc)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums text-slate-500 sm:table-cell">
                  {formatNumber(totals.totalViews, loc)}
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                <TableCell className="text-right font-semibold tabular-nums">
                  {money(totals.amount)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {periods.length > 0 && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {tr("parMois")}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("mois")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{tr("vuesPayees")}</TableHead>
                  <TableHead className="text-right">{tr("montant")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{tr("verse")}</TableHead>
                  <TableHead className="text-right">{tr("statut")}</TableHead>
                  {admin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((st) => (
                  <MonthRow
                    key={st.period}
                    st={st}
                    views={sumManagerPayRows(data.rows, st.period).payableViews}
                    label={monthLabel(st.period)}
                    money={money}
                    admin={admin}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.payouts.length > 0 && (
        <PayoutHistory data={data} monthLabel={monthLabel} money={money} admin={admin} />
      )}

      {totals.videos === 0 && (
        <p className="text-sm text-slate-500">{tr("aucuneVideo")}</p>
      )}
      <p className="text-xs leading-relaxed text-slate-500">{tr("explication")}</p>
      <p className="text-xs leading-relaxed text-slate-500">{tr("explicationVersements")}</p>
    </div>
  );
}

/** Une ligne de mois : dû, versé, statut, et le geste « Marquer payé ». */
function MonthRow({
  st,
  views,
  label,
  money,
  admin,
}: {
  st: ManagerPeriodStatus;
  views: number;
  label: string;
  money: (n: number) => string;
  admin?: { membershipId: Id<"memberships">; managerLabel: string };
}) {
  const tr = useTranslations("admin.money.ManagerPayReport");
  const loc = useIntlLocale();
  const payer = useProjectMutation(api.managerPay.markManagerPeriodPaid);
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState(false);
  // Le mois en cours et le précédent peuvent encore gagner des vues (fenêtre de
  // 30 jours) : on le dit AVANT de payer, pas après.
  const now = new Date();
  const ouvertEncore =
    st.period >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);

  async function go() {
    if (!admin) return;
    setBusy(true);
    try {
      await payer({
        membershipId: admin.membershipId,
        period: st.period,
        expectedAmount: st.remaining,
      });
      toast.success(tr("versementEnregistre", { montant: money(st.remaining), mois: label }));
      setOuvert(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("echecVersement")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="capitalize">{label}</TableCell>
      <TableCell className="hidden text-right tabular-nums sm:table-cell">
        {formatNumber(views, loc)}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">{money(st.due)}</TableCell>
      <TableCell className="hidden text-right tabular-nums text-slate-500 sm:table-cell">
        {money(st.paid)}
      </TableCell>
      <TableCell className="text-right">
        <StatusBadge st={st} money={money} />
      </TableCell>
      {admin && (
        <TableCell className="text-right">
          {st.remaining > 0 && (
            <Button size="sm" variant="outline" onClick={() => setOuvert(true)}>
              {tr("marquerPaye")}
            </Button>
          )}
          <AlertDialog open={ouvert} onOpenChange={setOuvert}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {tr("confirmTitre", { montant: money(st.remaining), mois: label })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {tr("confirmCorps", { manager: admin.managerLabel })}
                  {ouvertEncore && <> {tr("confirmMoisOuvert")}</>}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>{tr("annuler")}</AlertDialogCancel>
                <AlertDialogAction onClick={go} disabled={busy}>
                  {tr("confirmer")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TableCell>
      )}
    </TableRow>
  );
}

function StatusBadge({
  st,
  money,
}: {
  st: ManagerPeriodStatus;
  money: (n: number) => string;
}) {
  const tr = useTranslations("admin.money.ManagerPayReport");
  if (st.state === "paid") {
    return (
      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
        {tr("etatPaye")}
      </Badge>
    );
  }
  if (st.state === "overpaid") {
    return (
      <Badge variant="outline" className="border-slate-300 text-slate-600">
        {tr("etatTropPercu", { montant: money(-st.remaining) })}
      </Badge>
    );
  }
  if (st.state === "partial") {
    return (
      <Badge variant="outline" className="border-amber-300 text-amber-700">
        {tr("etatReste", { montant: money(st.remaining) })}
      </Badge>
    );
  }
  if (st.remaining === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <Badge variant="outline" className="border-amber-300 text-amber-700">
      {tr("etatAPayer")}
    </Badge>
  );
}

/** L'historique des versements — avec « Annuler » pour le superadmin. */
function PayoutHistory({
  data,
  monthLabel,
  money,
  admin,
}: {
  data: Payload;
  monthLabel: (p: string) => string;
  money: (n: number) => string;
  admin?: { membershipId: Id<"memberships">; managerLabel: string };
}) {
  const tr = useTranslations("admin.money.ManagerPayReport");
  const loc = useIntlLocale();
  const annuler = useProjectMutation(api.managerPay.cancelManagerPayout);
  const [aAnnuler, setAAnnuler] = useState<Payload["payouts"][number] | null>(null);

  async function go() {
    if (!aAnnuler) return;
    try {
      await annuler({ payoutId: aAnnuler._id });
      toast.success(tr("versementAnnule"));
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("echecAnnulation")));
    } finally {
      setAAnnuler(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {tr("versements")}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("date")}</TableHead>
              <TableHead>{tr("mois")}</TableHead>
              <TableHead className="text-right">{tr("montant")}</TableHead>
              {admin && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payouts.map((p) => (
              <TableRow key={p._id} className={cn(p.cancelled && "text-slate-400")}>
                <TableCell className="tabular-nums">{formatMoneyDate(p.paidAt, loc)}</TableCell>
                <TableCell className="capitalize">{monthLabel(p.period)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className={cn(p.cancelled && "line-through")}>{money(p.amount)}</span>
                  {p.cancelled && <span className="ml-2 text-xs">{tr("annule")}</span>}
                </TableCell>
                {admin && (
                  <TableCell className="text-right">
                    {!p.cancelled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-500"
                        onClick={() => setAAnnuler(p)}
                      >
                        {tr("annuler")}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <AlertDialog open={aAnnuler !== null} onOpenChange={(o) => !o && setAAnnuler(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tr("annulerTitre", {
                  montant: aAnnuler ? money(aAnnuler.amount) : "",
                  mois: aAnnuler ? monthLabel(aAnnuler.period) : "",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>{tr("annulerCorps")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("garder")}</AlertDialogCancel>
              <AlertDialogAction onClick={go}>{tr("annulerVersement")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  strong,
  tone = "default",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "amber";
}) {
  return (
    <Card>
      <CardContent className="space-y-1 px-3 py-3 sm:px-4 sm:py-4">
        <div className="truncate text-xs text-slate-500">{label}</div>
        <div
          className={cn(
            strong
              ? "text-lg font-semibold tabular-nums sm:text-2xl"
              : "text-lg font-medium tabular-nums sm:text-xl",
            tone === "amber" ? "text-amber-700" : "text-slate-900",
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
