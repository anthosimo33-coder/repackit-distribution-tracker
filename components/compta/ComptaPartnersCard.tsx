"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { CheckCircle2Icon, ChevronRightIcon, PencilIcon, PlusIcon, UsersIcon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { partnersError, splitPayout } from "@/convex/comptaMath";
import { useComptaFormat } from "./compta-format";

type PartnersData = FunctionReturnType<typeof api.compta.getComptaPartners>;
type Payment = PartnersData["payments"][number];

/**
 * Couleur d'un associé, dans l'ordre catégoriel validé (jamais recyclé) ;
 * au-delà de quatre, un gris — le nom est toujours écrit à côté.
 */
const PARTNER_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
export const partnerColor = (index: number) => PARTNER_COLORS[index] ?? "#94a3b8";

const parseAmount = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/**
 * ASSOCIÉS — ce que chacun s'est versé (parts « Rémunération » des virements),
 * face à sa part : ce qu'il lui manque pour que tout le monde revienne aux
 * parts, les versements mois par mois, et la répartition d'un prochain
 * versement. Les calculs sont dans convex/comptaMath (partnersView,
 * splitPayout) : l'écran affiche.
 */
export function ComptaPartnersCard() {
  const t = useTranslations("admin.money.Compta.partners");
  const f = useComptaFormat();
  const data = useProjectQuery(api.compta.getComptaPartners, {});
  const treasury = useProjectQuery(api.compta.getComptaTreasury, {});
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <Card className="gap-0 py-0">
        <Skeleton className="m-5 h-32" />
      </Card>
    );
  }
  const cur = data.currency;
  const { view, partners } = data;
  const color = (id: string) => partnerColor(partners.findIndex((p) => p.id === id));
  const nameOf = (id: string | null) => partners.find((p) => p.id === id)?.name ?? null;
  const unassigned = data.payments.filter((x) => x.partnerId === null);
  const shares = partners.map((p) => f.int(p.share)).join(" / ");
  const leader = view.rows.find((r) => r.leader) ?? null;

  return (
    <Card className="gap-0 py-0" data-testid="compta-partners">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-slate-900">{t("title")}</h2>
          <p className="text-xs text-slate-500">{t("subtitle")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {partners.length === 0 ? <PlusIcon className="size-3.5" /> : <PencilIcon className="size-3.5" />}
          {partners.length === 0 ? t("setup") : t("edit")}
        </Button>
      </div>

      <div className="space-y-5 p-5">
        {partners.length === 0 ? (
          <div className="flex items-start gap-2.5 text-sm text-slate-500">
            <UsersIcon className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <p>{t("empty")}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
              <Stat
                label={t("paidTotal")}
                value={f.money(view.total, cur)}
                hint={
                  view.total > 0
                    ? view.rows.map((r) => t("shareItem", { name: r.name, pct: f.pct((r.actualShare ?? 0) / 100) })).join(" · ")
                    : t("nothingYet")
                }
                testId="compta-partners-total"
              />
              <Stat
                label={t("catchUpTitle", { shares })}
                value={f.money(view.catchUp, cur)}
                hint={
                  view.catchUp > 0
                    ? view.rows
                        .filter((r) => r.missing > 0)
                        .map((r) => t("amountItem", { name: r.name, amount: f.money(r.missing, cur) }))
                        .join(" · ")
                    : t("catchUpNone")
                }
                tone={view.catchUp > 0 ? "amber" : undefined}
                testId="compta-partners-catchup"
              />
              <Stat
                label={t("available")}
                value={treasury?.available == null ? "—" : f.signed(treasury.available, cur)}
                hint={t("availableHint")}
              />
            </div>

            <ul className="space-y-1">
              {view.rows.map((r) => {
                const mine = data.payments.filter((x) => x.partnerId === r.id);
                const isOpen = open === r.id;
                const fill = r.due > 0 ? Math.min(100, (r.paid / r.due) * 100) : 0;
                return (
                  <li key={r.id} data-testid={`compta-partner-${r.name}`}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.id)}
                      className="grid w-full items-center gap-x-4 gap-y-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50 sm:grid-cols-[11rem_minmax(0,1fr)_8rem_10rem]"
                    >
                      <span className="flex items-center gap-2.5">
                        <ChevronRightIcon className={cn("size-3.5 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-90")} />
                        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color(r.id) }} />
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">{r.name}</span>
                          <span className="block text-xs text-slate-500">{t("part", { pct: f.pct(r.share / 100) })}</span>
                        </span>
                      </span>
                      <span>
                        <span className="relative block h-3 overflow-hidden rounded bg-slate-100">
                          {fill > 0 && (
                            <span
                              className={cn("absolute inset-y-0 left-0", fill >= 100 ? "rounded" : "rounded-l")}
                              style={{ width: `${fill}%`, background: color(r.id) }}
                            />
                          )}
                          {r.missing > 0 && (
                            <span
                              className="absolute inset-y-0 right-0"
                              style={{
                                left: fill > 0 ? `calc(${fill}% + 2px)` : 0,
                                backgroundImage: `repeating-linear-gradient(135deg, color-mix(in oklab, ${color(r.id)} 35%, transparent) 0 4px, transparent 4px 8px)`,
                              }}
                            />
                          )}
                        </span>
                        <span className="mt-1 flex justify-between text-[11px] text-slate-500 tabular-nums">
                          <span>{t("paidLabel", { amount: f.money(r.paid, cur) })}</span>
                          <span>{r.leader ? t("leaderLabel") : t("dueLabel", { amount: f.money(r.due, cur) })}</span>
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="block text-sm font-semibold text-slate-900">{f.money(r.paid, cur)}</span>
                        <span className="block text-xs text-slate-500">
                          {r.actualShare === null ? "—" : t("ofPaid", { pct: f.pct(r.actualShare / 100) })}
                        </span>
                      </span>
                      <span className="sm:justify-self-end">
                        {r.missing > 0 ? (
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 tabular-nums">
                            {t("missing", { amount: f.money(r.missing, cur) })}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2Icon className="size-3.5" />
                            {t("upToDate")}
                          </span>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="mt-1 mb-2 ml-8 overflow-hidden rounded-lg border border-slate-200">
                        {mine.length === 0 ? (
                          <p className="px-3 py-2.5 text-xs text-slate-500">{t("noPayments")}</p>
                        ) : (
                          mine.map((x) => <PaymentLine key={`${x.lineId}:${x.partId}`} x={x} cur={cur} />)
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {leader && (
              <p className="text-xs text-slate-500">
                {t("levelNote", {
                  name: leader.name,
                  paid: f.money(leader.paid, cur),
                  pct: f.pct(leader.share / 100),
                  level: f.money(view.level, cur),
                })}
              </p>
            )}
            {view.unconverted > 0 && <p className="text-xs text-amber-700">{t("unconverted", { count: view.unconverted })}</p>}
          </>
        )}

        {unassigned.length > 0 && <ToAssign payments={unassigned} data={data} nameOf={nameOf} />}

        {partners.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <ByMonth data={data} cur={cur} color={color} />
            <Split data={data} cur={cur} color={color} available={treasury?.available ?? null} />
          </div>
        )}
      </div>

      <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        {editing && <PartnersForm data={data} onClose={() => setEditing(false)} />}
      </Dialog>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "amber";
  testId?: string;
}) {
  return (
    <div className="space-y-0.5 bg-white px-4 py-3" data-testid={testId}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", tone === "amber" ? "text-amber-700" : "text-slate-900")}>
        {value}
      </div>
      <div className="text-xs text-slate-500 tabular-nums">{hint}</div>
    </div>
  );
}

function PaymentLine({ x, cur }: { x: Payment; cur: string | null }) {
  const t = useTranslations("admin.money.Compta.partners");
  const f = useComptaFormat();
  return (
    <div className="grid gap-x-3 gap-y-0.5 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[4rem_6rem_minmax(0,1fr)_auto] sm:items-baseline">
      <span className="text-slate-500 tabular-nums">{f.dayShort(x.day)}</span>
      <span className="font-semibold text-slate-900 tabular-nums">
        {f.money(x.amount, x.currency)}
        {x.currency !== cur && x.converted !== null && (
          <span className="font-normal text-slate-500"> (≈ {f.money(x.converted, cur)})</span>
        )}
      </span>
      <span className="min-w-0 text-slate-700">{x.note ?? "—"}</span>
      <span className="text-slate-400 tabular-nums">
        {t("transfer", {
          amount: f.money(x.transfer.amount, x.transfer.currency),
          destination: x.transfer.destination ?? "—",
        })}
      </span>
    </div>
  );
}

/** Rémunérations sans associé : à attribuer, l'associé que nomme le motif proposé. */
function ToAssign({
  payments,
  data,
  nameOf,
}: {
  payments: Payment[];
  data: PartnersData;
  nameOf: (id: string | null) => string | null;
}) {
  const t = useTranslations("admin.money.Compta.partners");
  const f = useComptaFormat();
  const assign = useProjectMutation(api.compta.assignPayPart);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const key = (x: Payment) => `${x.lineId}:${x.partId}`;
  const picked = (x: Payment) => choice[key(x)] ?? x.suggested ?? null;
  const allSuggested = payments.every((x) => x.suggested !== null);

  async function run(list: Payment[]) {
    setBusy(true);
    try {
      for (const x of list) {
        const partnerId = picked(x);
        if (partnerId !== null) await assign({ lineId: x.lineId, partId: x.partId, partnerId });
      }
      toast.success(t("assigned"));
    } catch (e) {
      toast.error(convexErrorMessage(e, t("assignFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60" data-testid="compta-partners-to-assign">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3">
        <div>
          <p className="text-sm font-semibold text-amber-900">{t("toAssignTitle", { count: payments.length })}</p>
          <p className="text-xs text-amber-800/90">{t("toAssignSub")}</p>
        </div>
        {data.partners.length > 0 && allSuggested && (
          <Button size="sm" disabled={busy} onClick={() => run(payments)}>
            {t("assignAll")}
          </Button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-amber-100 border-t border-amber-100">
        {payments.map((x) => {
          const value = picked(x);
          return (
            <li
              key={key(x)}
              className="grid items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs sm:grid-cols-[4rem_6rem_minmax(0,1fr)_10rem_auto]"
            >
              <span className="text-amber-900/80 tabular-nums">{f.dayShort(x.day)}</span>
              <span className="font-semibold text-amber-950 tabular-nums">{f.money(x.amount, x.currency)}</span>
              <span className="min-w-0 text-amber-900">{x.note ?? "—"}</span>
              {data.partners.length > 0 ? (
                <>
                  <Select
                    value={value}
                    onValueChange={(v) => v !== null && setChoice((c) => ({ ...c, [key(x)]: v }))}
                    items={Object.fromEntries(data.partners.map((p) => [p.id, p.name]))}
                  >
                    <SelectTrigger size="sm" className="w-full bg-white" aria-label={t("assignPlaceholder")}>
                      <SelectValue placeholder={t("assignPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false}>
                      {data.partners.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white"
                    disabled={busy || value === null}
                    aria-label={t("assignTo", { name: nameOf(value) ?? "—" })}
                    onClick={() => run([x])}
                  >
                    {t("assign")}
                  </Button>
                </>
              ) : (
                <span className="text-amber-800/80 sm:col-span-2">{t("assignNeedsPartners")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Versements par mois (mois du virement), un associé par colonne. */
function ByMonth({ data, cur, color }: { data: PartnersData; cur: string | null; color: (id: string) => string }) {
  const t = useTranslations("admin.money.Compta.partners");
  const f = useComptaFormat();
  const attributed = data.payments.filter((x) => x.partnerId !== null && x.converted !== null);
  const months = [...new Set(attributed.map((x) => x.day.slice(0, 7)))].sort();
  const cell = (month: string | null, partnerId: string | null) =>
    attributed
      .filter((x) => (month === null || x.day.startsWith(month)) && (partnerId === null || x.partnerId === partnerId))
      .reduce((s, x) => s + (x.converted ?? 0), 0);
  const show = (n: number) => (n === 0 ? <span className="text-slate-300">—</span> : f.money(n, cur));
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="px-3 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-slate-900">{t("byMonth")}</h3>
        <p className="text-xs text-slate-500">{t("byMonthSub")}</p>
      </div>
      {months.length === 0 ? (
        <p className="border-t border-slate-100 px-3 py-3 text-xs text-slate-500">{t("nothingYet")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums" data-testid="compta-partners-by-month">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50/70 text-slate-500">
                <th className="px-3 py-1.5 text-left font-medium">{t("month")}</th>
                {data.partners.map((p) => (
                  <th key={p.id} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                    <span className="mr-1.5 inline-block size-2 rounded-[2px]" style={{ background: color(p.id) }} />
                    {p.name}
                  </th>
                ))}
                <th className="px-3 py-1.5 text-right font-medium">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m} className="border-b border-slate-100 text-slate-700">
                  <td className="px-3 py-1.5 text-left">{f.monthName(m)}</td>
                  {data.partners.map((p) => (
                    <td key={p.id} className="px-3 py-1.5 text-right">
                      {show(cell(m, p.id))}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right">{show(cell(m, null))}</td>
                </tr>
              ))}
              <tr className="font-semibold text-slate-900">
                <td className="px-3 py-1.5 text-left">{t("total")}</td>
                {data.partners.map((p) => (
                  <td key={p.id} className="px-3 py-1.5 text-right">
                    {f.money(cell(null, p.id), cur)}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">{f.money(cell(null, null), cur)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Répartir un prochain versement : le rattrapage d'abord, puis le reste selon les parts. */
function Split({
  data,
  cur,
  color,
  available,
}: {
  data: PartnersData;
  cur: string | null;
  color: (id: string) => string;
  available: number | null;
}) {
  const t = useTranslations("admin.money.Compta.partners");
  const f = useComptaFormat();
  const [amount, setAmount] = useState("");
  const value = parseAmount(amount);
  const valid = Number.isFinite(value) && value > 0;
  const rows = data.view.rows;
  const split = valid ? splitPayout(rows, value) : [];
  return (
    <div className="rounded-lg border border-slate-200 p-3" data-testid="compta-partners-split">
      <h3 className="text-sm font-semibold text-slate-900">{t("splitTitle")}</h3>
      <p className="text-xs text-slate-500">{t("splitSub")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={amount}
          inputMode="decimal"
          placeholder={f.money(2000, cur)}
          aria-label={t("splitAmount")}
          onChange={(e) => setAmount(e.target.value)}
          className="w-40 text-right font-semibold tabular-nums"
        />
        {available !== null && available > 0 && (
          <span className="text-xs text-slate-500">{t("splitOf", { amount: f.money(available, cur) })}</span>
        )}
      </div>
      {valid && (
        <div className="mt-3 space-y-1.5 text-xs">
          {rows.map((r) => {
            const got = split.find((s) => s.id === r.id)?.amount ?? 0;
            const catchUp = Math.min(got, r.missing);
            return (
              <div key={r.id} className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-baseline gap-2">
                <span className="size-2.5 translate-y-px rounded-[3px]" style={{ background: color(r.id) }} />
                <span className="text-slate-700">
                  {r.name}
                  {catchUp > 0 && (
                    <span className="text-slate-500"> · {t("splitCatchUp", { amount: f.money(catchUp, cur) })}</span>
                  )}
                </span>
                <span className="font-semibold text-slate-900 tabular-nums" data-testid={`compta-split-${r.name}`}>
                  {f.money(got, cur)}
                </span>
              </div>
            );
          })}
          <p className="border-t border-slate-100 pt-1.5 text-slate-500 tabular-nums">
            {t("splitAfter", {
              list: rows
                .map((r) => t("amountItem", { name: r.name, amount: f.money(r.paid + (split.find((s) => s.id === r.id)?.amount ?? 0), cur) }))
                .join(" · "),
            })}
          </p>
        </div>
      )}
    </div>
  );
}

type DraftPartner = { id?: string; name: string; share: string };

/** Les associés et leurs parts : des noms distincts, 100 % au total. */
function PartnersForm({ data, onClose }: { data: PartnersData; onClose: () => void }) {
  const t = useTranslations("admin.money.Compta.partners.dialog");
  const f = useComptaFormat();
  const save = useProjectMutation(api.compta.saveComptaPartners);
  const [rows, setRows] = useState<DraftPartner[]>(() =>
    data.partners.length > 0
      ? data.partners.map((p) => ({ id: p.id, name: p.name, share: String(p.share).replace(".", ",") }))
      : [{ name: "", share: "" }],
  );
  const [busy, setBusy] = useState(false);
  const parsed = rows.map((r, i) => ({ id: r.id ?? `new${i}`, name: r.name, share: parseAmount(r.share) }));
  const total = Math.round(parsed.reduce((s, r) => s + (Number.isFinite(r.share) ? r.share : 0), 0) * 100) / 100;
  const error = partnersError(parsed);
  const update = (i: number, patch: Partial<DraftPartner>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit() {
    setBusy(true);
    try {
      await save({
        partners: rows.map((r, i) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), share: parsed[i].share })),
      });
      toast.success(t("saved"));
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <div className="grid grid-cols-[0.75rem_minmax(0,1fr)_7rem_2rem] gap-2 px-1 text-[11px] font-medium text-slate-500">
          <span />
          <span>{t("name")}</span>
          <span className="text-right">{t("share")}</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <Fragment key={r.id ?? `new${i}`}>
            <div className="grid grid-cols-[0.75rem_minmax(0,1fr)_7rem_2rem] items-center gap-2">
              <span className="size-2.5 rounded-[3px]" style={{ background: partnerColor(i) }} />
              <Input value={r.name} maxLength={60} aria-label={t("name")} onChange={(e) => update(i, { name: e.target.value })} />
              <div className="relative">
                <Input
                  value={r.share}
                  inputMode="decimal"
                  aria-label={t("shareOf", { name: r.name || "—" })}
                  onChange={(e) => update(i, { share: e.target.value })}
                  className="pr-6 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-slate-400">%</span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("remove")}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <XIcon className="size-3.5 text-slate-400" />
              </Button>
            </div>
          </Fragment>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length >= 10}
          onClick={() => setRows((rs) => [...rs, { name: "", share: "" }])}
        >
          <PlusIcon className="size-3.5" />
          {t("add")}
        </Button>
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
          <span className="text-slate-600">{t("total")}</span>
          <span
            className={cn("font-semibold tabular-nums", error === "total" ? "text-amber-700" : "text-emerald-700")}
            data-testid="compta-partners-form-total"
          >
            {error === "total"
              ? t("totalOff", { pct: f.pct(total / 100) })
              : t("totalOk", { pct: f.pct(total / 100) })}
          </span>
        </div>
        <p className="text-xs text-slate-500">{t("removeHint")}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button onClick={submit} disabled={busy || error !== null}>
          {t("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
