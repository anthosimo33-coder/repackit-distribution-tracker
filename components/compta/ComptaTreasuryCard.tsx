"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HourglassIcon,
  InfoIcon,
  LandmarkIcon,
  PiggyBankIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { useComptaFormat, type ComptaFormat } from "./compta-format";

type Treasury = FunctionReturnType<typeof api.compta.getComptaTreasury>;
type Account = Treasury["accounts"][number];

const NEW = "__new__";
const parseAmount = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
const pct = (part: number, whole: number) => `${Math.max(0, Math.min(100, (part / whole) * 100))}%`;

/**
 * TRÉSORERIE — ce qui est disponible aujourd'hui : Whop (calculé depuis le grand
 * livre) + les comptes dont on RELÈVE le solde − l'argent mis de côté. Jarvia ne
 * lit aucune banque : un relevé vieillit, et le bloc le dit.
 */
export function ComptaTreasuryCard() {
  const t = useTranslations("admin.money.Compta.treasury");
  const f = useComptaFormat();
  const data = useProjectQuery(api.compta.getComptaTreasury, {});
  const [reading, setReading] = useState<{ accountId: string } | null>(null);
  const [provision, setProvision] = useState(false);
  const [now] = useState(() => Date.now());
  const cur = data?.currency ?? null;

  if (data === undefined) {
    return (
      <Card className="gap-0 py-0">
        <Skeleton className="m-5 h-40" />
      </Card>
    );
  }
  const whop = data.whop.total ?? 0;
  const accountsSum = data.accounts.reduce((s, a) => s + (a.counted ? (a.estimated ?? 0) : 0), 0);
  const setAside = data.setAside.remaining ?? 0;
  // La barre ne mesure que de l'argent PRÉSENT : un solde négatif (Whop débiteur,
  // découvert) n'y a pas de place, et sans rien de positif elle disparaît.
  const onWhop = Math.max(whop, 0);
  const onAccounts = Math.max(accountsSum, 0);
  const barTotal = onWhop + onAccounts;
  const asideBar = Math.min(setAside, barTotal);

  return (
    <Card className="gap-0 py-0" data-testid="compta-treasury">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-slate-900">{t("title")}</h2>
          <p className="text-xs text-slate-500">{t("subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setReading({ accountId: data.accounts[0]?._id ?? NEW })}>
          <RefreshCwIcon className="size-3.5" />
          {t("readBalance")}
        </Button>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-slate-500">{t("available")}</div>
            <div className="text-4xl font-semibold tracking-tight tabular-nums text-slate-900" data-testid="compta-treasury-available">
              {data.available === null ? "—" : f.money(data.available, cur)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {data.inCash === null
                ? t("noRate")
                : t("inCash", { cash: f.money(data.inCash, cur), aside: f.money(setAside, cur) })}
            </div>
          </div>
          {barTotal > 0 && (
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="h-full bg-primary" style={{ width: pct(Math.max(onWhop - Math.max(asideBar - onAccounts, 0), 0), barTotal) }} />
              <div className="h-full border-l-2 border-white bg-violet-300" style={{ width: pct(Math.max(onAccounts - asideBar, 0), barTotal) }} />
              <div
                className="h-full border-l-2 border-white bg-sky-300 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(255,255,255,.55)_4px_7px)]"
                style={{ width: pct(asideBar, barTotal) }}
              />
            </div>
          )}
          <ul className="space-y-1 text-[11px] text-slate-500">
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />{t("legendWhop")}</li>
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-violet-300" />{t("legendAccounts")}</li>
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-sky-300" />{t("legendAside")}</li>
          </ul>
          {data.staleCount > 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800" data-testid="compta-treasury-stale">
              <AlertTriangleIcon className="mt-px size-3 shrink-0" />
              {t("staleWarning", { count: data.staleCount, days: data.staleDays })}
            </p>
          )}
          {data.accounts.length === 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
              <InfoIcon className="mt-px size-3 shrink-0" />
              {t("noAccount")}
            </p>
          )}
        </div>

        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          <Row
            icon={<WalletIcon className="size-4 text-primary" />}
            title={t("whop")}
            amount={data.whop.total === null ? "—" : f.money(data.whop.total, cur)}
            meta={
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2Icon className="size-3" />
                {data.whop.lastSyncAt === null ? t("whopNever") : t("whopLive", { ago: f.ago(data.whop.lastSyncAt, now) })}
              </span>
            }
          >
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {data.whop.byCurrency.map((b) => (
                <span key={b.currency} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums text-slate-600">
                  {f.money(b.amount, b.currency)}
                  {b.currency !== cur && b.converted !== null && <span className="text-slate-400"> ≈ {f.money(b.converted, cur)}</span>}
                </span>
              ))}
            </div>
            {data.whop.lastTransfer && (
              <p className="mt-1 text-[11px] text-slate-400">
                {t("lastTransfer", {
                  date: f.dayShort(data.whop.lastTransfer.day),
                  amount: f.money(data.whop.lastTransfer.amount, data.whop.lastTransfer.currency),
                })}
              </p>
            )}
          </Row>

          {data.accounts.map((a) => (
            <AccountRow key={a._id} a={a} cur={cur} f={f} onRead={() => setReading({ accountId: a._id })} />
          ))}

          <button
            type="button"
            onClick={() => setReading({ accountId: NEW })}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-primary hover:bg-slate-50"
          >
            <PlusIcon className="size-3.5" />
            {t("addAccount")}
          </button>

          <Row
            icon={<PiggyBankIcon className="size-4 text-sky-500" />}
            title={t("aside")}
            amount={data.setAside.remaining === null ? "—" : f.signed(-data.setAside.remaining, cur)}
            meta={
              <span className="text-slate-500">
                {data.setAside.provisioned === null
                  ? t("noRate")
                  : t("asideMeta", {
                      provisioned: f.money(data.setAside.provisioned, cur),
                      used: f.money(data.setAside.used, cur),
                    })}
              </span>
            }
            action={
              <Button size="sm" variant="outline" onClick={() => setProvision(true)}>
                {t("markPaid")}
              </Button>
            }
            testId="compta-treasury-aside"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-3">
        {data.toRecover !== null && data.toRecover > 0 ? (
          <p className="flex items-start gap-1.5 text-xs text-orange-800">
            <HourglassIcon className="mt-px size-3.5 shrink-0 text-orange-600" />
            <span>{t("toRecover", { amount: f.money(data.toRecover, cur) })}</span>
          </p>
        ) : (
          <span />
        )}
        <p className="flex max-w-md items-start gap-1.5 text-[11px] text-slate-400">
          <InfoIcon className="mt-px size-3 shrink-0" />
          {t("footnote")}
        </p>
      </div>

      <Dialog open={reading !== null} onOpenChange={(o) => !o && setReading(null)}>
        {reading && (
          <ReadingForm key={reading.accountId} data={data} initial={reading.accountId} onClose={() => setReading(null)} />
        )}
      </Dialog>
      <Dialog open={provision} onOpenChange={(o) => !o && setProvision(false)}>
        {provision && <ProvisionForm data={data} onClose={() => setProvision(false)} />}
      </Dialog>
    </Card>
  );
}

function Row({
  icon,
  title,
  amount,
  meta,
  action,
  muted,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  amount: React.ReactNode;
  meta: React.ReactNode;
  action?: React.ReactNode;
  muted?: boolean;
  testId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-2 px-4 py-3", muted && "bg-slate-50/60")}
      data-testid={testId}
    >
      <div className="pt-0.5">{icon}</div>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn("text-sm font-medium", muted ? "text-slate-500" : "text-slate-900")}>{title}</span>
          <span className="text-base font-semibold tabular-nums text-slate-900">{amount}</span>
        </div>
        <div className="text-[11px]">{meta}</div>
        {children}
      </div>
      <div className="pl-2">{action}</div>
    </div>
  );
}

function AccountRow({ a, cur, f, onRead }: { a: Account; cur: string | null; f: ComptaFormat; onRead: () => void }) {
  const t = useTranslations("admin.money.Compta.treasury");
  const read = (
    <Button size="sm" variant="outline" onClick={onRead} aria-label={t("readAccount", { name: a.name })}>
      {t("read")}
    </Button>
  );
  if (a.reading === null) {
    return (
      <Row
        icon={<LandmarkIcon className="size-4 text-slate-300" />}
        title={a.name}
        amount={<span className="text-sm font-normal text-slate-400">{t("neverRead")}</span>}
        meta={<span className="text-slate-400">{t("neverReadMeta")}</span>}
        action={read}
        muted
        testId={`compta-account-${a.name}`}
      />
    );
  }
  return (
    <Row
      icon={<LandmarkIcon className="size-4 text-violet-500" />}
      title={a.name}
      amount={a.estimated === null ? "—" : f.money(a.estimated, cur)}
      meta={
        <span className={cn("inline-flex items-center gap-1", a.stale ? "text-amber-700" : "text-slate-500")}>
          {a.stale && <AlertTriangleIcon className="size-3" />}
          {t("readOn", { date: f.dayShort(a.reading.day), days: a.ageDays ?? 0 })}
        </span>
      }
      action={read}
      testId={`compta-account-${a.name}`}
    >
      <p className="mt-1 text-[11px] tabular-nums text-slate-500">
        {t("readingPlus", {
          reading: f.money(a.reading.amount, a.currency),
          since: a.since === null ? "—" : f.money(a.since, cur),
        })}
        {a.destinations.length > 0 ? (
          <span className="text-slate-400"> · {t("receives", { list: a.destinations.join(", ") })}</span>
        ) : (
          <span className="text-slate-400"> · {t("noDestination")}</span>
        )}
      </p>
    </Row>
  );
}

// ─── Fenêtre « Relever un solde » ───────────────────────────────────────────

function ReadingForm({ data, initial, onClose }: { data: Treasury; initial: string; onClose: () => void }) {
  const t = useTranslations("admin.money.Compta.treasury");
  const f = useComptaFormat();
  const save = useProjectMutation(api.compta.saveAccountReading);
  const removeReading = useProjectMutation(api.compta.deleteAccountReading);
  const removeAccount = useProjectMutation(api.compta.deleteComptaAccount);
  const [accountId, setAccountId] = useState(initial);
  const account = data.accounts.find((a) => a._id === accountId) ?? null;
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(data.currency ?? data.currencies[0] ?? "eur");
  const [day, setDay] = useState(data.today);
  const [amount, setAmount] = useState("");
  const [destinations, setDestinations] = useState<string[]>(account?.destinations ?? []);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const value = parseAmount(amount);
  const invalid =
    amount.trim() === "" || !Number.isFinite(value) || day === "" || day > data.today || (account === null && name.trim() === "");

  function pick(id: string) {
    setAccountId(id);
    setDestinations(data.accounts.find((a) => a._id === id)?.destinations ?? []);
    setConfirmDelete(false);
  }

  async function run(fn: () => Promise<unknown>, ok: string, close = true) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      if (close) onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  const accountCurrency = account?.currency ?? currency;
  return (
    <DialogContent className="sm:max-w-lg" initialFocus={false}>
      <DialogHeader>
        <DialogTitle>{t("readTitle")}</DialogTitle>
        <DialogDescription>{t("readDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-600">{t("account")}</Label>
          <Select
            value={accountId}
            onValueChange={(v) => v !== null && pick(v)}
            items={{ ...Object.fromEntries(data.accounts.map((a) => [a._id, a.name])), [NEW]: t("newAccount") }}
          >
            <SelectTrigger className="w-full" aria-label={t("account")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {data.accounts.map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  {a.name}
                </SelectItem>
              ))}
              <SelectItem value={NEW}>{t("newAccount")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {account === null && (
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">{t("accountName")}</Label>
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("accountNamePlaceholder")} aria-label={t("accountName")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">{t("currency")}</Label>
              <Select
                value={currency}
                onValueChange={(v) => v !== null && setCurrency(v)}
                items={Object.fromEntries(data.currencies.map((c) => [c, c.toUpperCase()]))}
              >
                <SelectTrigger className="w-full" aria-label={t("currency")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  {data.currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("day")}</Label>
            <Input type="date" value={day} max={data.today} onChange={(e) => setDay(e.target.value)} aria-label={t("day")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("balance")}</Label>
            <div className="relative">
              <Input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                className="pr-11 text-right tabular-nums"
                aria-label={t("balance")}
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-slate-400 uppercase">
                {accountCurrency}
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-600">{t("destinations")}</Label>
          {data.destinations.length === 0 ? (
            <p className="text-xs text-slate-400">{t("noWhopDestination")}</p>
          ) : (
            <div className="grid gap-1.5 rounded-lg border border-slate-200 p-2.5 text-sm sm:grid-cols-2">
              {data.destinations.map((d) => {
                const taken = d.accountId !== null && d.accountId !== accountId;
                const owner = taken ? data.accounts.find((a) => a._id === d.accountId)?.name : null;
                return (
                  <label key={d.name} className={cn("flex items-center gap-2", taken && "opacity-50")}>
                    <Checkbox
                      checked={destinations.includes(d.name)}
                      disabled={taken}
                      onCheckedChange={(c) =>
                        setDestinations((ds) => (c ? [...ds, d.name] : ds.filter((x) => x !== d.name)))
                      }
                      aria-label={d.name}
                    />
                    <span className="min-w-0 truncate text-slate-700">{d.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {owner ? t("takenBy", { name: owner }) : t("transfersCount", { count: d.count })}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-slate-400">{t("destinationsHint")}</p>
        </div>
        {account !== null && account.history.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">{t("history")}</Label>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
              {account.history.map((h) => (
                <li key={h._id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="tabular-nums text-slate-500">{f.day(h.day)}</span>
                  <span className="ml-auto tabular-nums text-slate-800">{f.money(h.amount, account.currency)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("deleteReading", { date: f.day(h.day) })}
                    disabled={busy}
                    onClick={() => run(() => removeReading({ readingId: h._id as Id<"comptaAccountReadings"> }), t("readingDeleted"), false)}
                  >
                    <XIcon className="size-3.5 text-slate-400" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <DialogFooter>
        {account !== null &&
          (confirmDelete ? (
            <Button
              variant="destructive"
              className="mr-auto"
              disabled={busy}
              onClick={() => run(() => removeAccount({ accountId: account._id }), t("accountDeleted"))}
            >
              <Trash2Icon className="size-3.5" />
              {t("deleteAccountConfirm", { name: account.name })}
            </Button>
          ) : (
            <Button variant="outline" className="mr-auto text-slate-500" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2Icon className="size-3.5" />
              {t("deleteAccount")}
            </Button>
          ))}
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          disabled={invalid || busy}
          data-testid="compta-reading-save"
          onClick={() =>
            run(
              () =>
                save({
                  ...(account !== null ? { accountId: account._id } : { newAccount: { name: name.trim(), currency } }),
                  destinations,
                  day,
                  amount: value,
                }),
              t("readingSaved"),
            )
          }
        >
          {t("saveReading")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Fenêtre « Marquer payé » (mis de côté) ─────────────────────────────────

function ProvisionForm({ data, onClose }: { data: Treasury; onClose: () => void }) {
  const t = useTranslations("admin.money.Compta.treasury");
  const f = useComptaFormat();
  const record = useProjectMutation(api.compta.recordProvisionUse);
  const remove = useProjectMutation(api.compta.deleteProvisionUse);
  const cur = data.currency;
  const [day, setDay] = useState(data.today);
  const [amount, setAmount] = useState(
    data.setAside.remaining !== null && data.setAside.remaining > 0
      ? data.setAside.remaining.toFixed(2).replace(".", ",")
      : "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const value = parseAmount(amount);
  const invalid = !(value > 0) || day === "" || day > data.today;

  async function run(fn: () => Promise<unknown>, ok: string, close = true) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      if (close) onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-md" initialFocus={false}>
      <DialogHeader>
        <DialogTitle>{t("paidTitle")}</DialogTitle>
        <DialogDescription>
          {t("paidDescription", { amount: data.setAside.remaining === null ? "—" : f.money(data.setAside.remaining, cur) })}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("paidDay")}</Label>
            <Input type="date" value={day} max={data.today} onChange={(e) => setDay(e.target.value)} aria-label={t("paidDay")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("paidAmount")}</Label>
            <div className="relative">
              <Input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                className="pr-11 text-right tabular-nums"
                aria-label={t("paidAmount")}
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-slate-400 uppercase">
                {cur}
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-600">{t("paidNote")}</Label>
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t("paidNotePlaceholder")} aria-label={t("paidNote")} />
        </div>
        {data.setAside.uses.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">{t("paidHistory")}</Label>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
              {data.setAside.uses.map((u) => (
                <li key={u._id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="tabular-nums text-slate-500">{f.day(u.day)}</span>
                  <span className="min-w-0 truncate text-slate-600">{u.note ?? ""}</span>
                  <span className="ml-auto tabular-nums text-slate-800">{f.money(u.amount, u.currency)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("deletePaid", { date: f.day(u.day) })}
                    disabled={busy}
                    onClick={() => run(() => remove({ useId: u._id }), t("paidDeleted"), false)}
                  >
                    <XIcon className="size-3.5 text-slate-400" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          disabled={invalid || busy}
          data-testid="compta-provision-save"
          onClick={() =>
            run(() => record({ day, amount: value, ...(note.trim() ? { note: note.trim() } : {}) }), t("paidSaved"))
          }
        >
          {t("markPaid")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
