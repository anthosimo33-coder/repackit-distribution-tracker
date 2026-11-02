"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { domToPng } from "modern-screenshot";
import { toast } from "sonner";
import { DownloadIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { parisDayKey } from "@/convex/comptaMath";
import { useProject, useProjectSlug } from "@/components/project/ProjectProvider";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { buildComptaRecap, netShares, previousPeriod, type ComptaRecap, type RecapRow } from "@/lib/compta-recap";
import { useComptaFormat, type ComptaFormat } from "./compta-format";
import type { ComptaOverview } from "./ComptaPage";

type Treasury = FunctionReturnType<typeof api.compta.getComptaTreasury>;

/** Largeur de l'image (px CSS) ; exportée ×2. */
const SHEET_WIDTH = 1200;
const PREVIEW_SCALE = 0.5;
/** Couleurs FIXES : une image partagée est toujours claire. Palette catégorielle validée (dataviz). */
const C = {
  page: "#f4f3ef",
  card: "#fcfcfb",
  border: "#e4e2dc",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#85837d",
  result: "#2a78d6",
  creators: "#eb6834",
  scans: "#1baf7a",
  other: "#eda100",
} as const;
// i18n-exempt: pile de polices CSS, pas un texte d'interface
const FONT = '-apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/**
 * RÉCAP À PARTAGER — une période de la Compta (un mois ou plusieurs), en image
 * pour l'équipe : CA, net, résultat, où est allé le net, la trésorerie du jour
 * et des points à retenir, pré-remplis depuis les chiffres et modifiables. Les
 * chiffres sont ceux de l'onglet (lib/compta-recap somme ses lignes) ; aucune
 * créatrice ni paie d'associé n'y est nommée.
 */
export function ComptaRecapDialog({
  open,
  onOpenChange,
  data,
  defaultMonth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ComptaOverview;
  defaultMonth: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <RecapBody data={data} defaultMonth={defaultMonth} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function RecapBody({ data, defaultMonth, onClose }: { data: ComptaOverview; defaultMonth: string; onClose: () => void }) {
  const t = useTranslations("admin.money.Compta.recap");
  const f = useComptaFormat();
  const months = data.rows.map((r) => r.month);
  const [from, setFrom] = useState(defaultMonth);
  const [to, setTo] = useState(defaultMonth);
  // La trésorerie est celle d'AUJOURD'HUI : proposée d'office seulement quand
  // la période finit sur le dernier mois de l'exercice affiché.
  const [withTreasury, setWithTreasury] = useState(defaultMonth >= months[Math.max(0, months.length - 2)]);

  const n = months.indexOf(to) - months.indexOf(from) + 1;
  const prevFirst = previousPeriod(from, Math.max(1, n))[0];
  const needPrevYear = prevFirst.slice(0, 4) !== String(data.year);
  const prevYear = useProjectQuery(api.compta.getComptaOverview, needPrevYear ? { year: data.year - 1 } : "skip");
  const treasury = useProjectQuery(api.compta.getComptaTreasury, withTreasury ? {} : "skip");

  const ready = (!needPrevYear || prevYear !== undefined) && (!withTreasury || treasury !== undefined);
  const rows: RecapRow[] = [...(prevYear?.rows ?? []), ...data.rows];
  const recap = ready ? buildComptaRecap(rows, from, to) : null;
  const cur = data.currency;
  const shownTreasury = withTreasury && treasury && treasury.available !== null ? treasury : null;

  return (
    <DialogContent className="sm:max-w-3xl" initialFocus={false}>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-end gap-3">
        <MonthSelect label={t("from")} value={from} months={months} f={f} onChange={(m) => { setFrom(m); if (m > to) setTo(m); }} />
        <MonthSelect label={t("to")} value={to} months={months.filter((m) => m >= from)} f={f} onChange={setTo} />
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <Checkbox checked={withTreasury} onCheckedChange={(v) => setWithTreasury(v === true)} />
          {t("withTreasury")}
        </label>
      </div>

      {recap === null ? (
        <p className="py-10 text-center text-sm text-slate-500">{t("loading")}</p>
      ) : (
        <RecapEditor
          // Une autre période, d'autres points : l'éditeur repart des points calculés.
          key={`${from}|${to}|${shownTreasury ? "t" : "-"}`}
          recap={recap}
          treasury={shownTreasury}
          cur={cur}
          onClose={onClose}
        />
      )}
    </DialogContent>
  );
}

function MonthSelect({
  label,
  value,
  months,
  f,
  onChange,
}: {
  label: string;
  value: string;
  months: string[];
  f: ComptaFormat;
  onChange: (m: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-slate-600">{label}</Label>
      <Select
        value={value}
        onValueChange={(v) => v !== null && onChange(v)}
        items={Object.fromEntries(months.map((m) => [m, f.month(m)]))}
      >
        <SelectTrigger className="w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          {months.map((m) => (
            <SelectItem key={m} value={m}>
              {f.month(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Les formats de l'image : montants entiers, espaces insécables lisibles en gros corps. */
function useSheetFormat(cur: string | null) {
  const f = useComptaFormat();
  // L'espace fine insécable (U+202F) des milliers disparaît presque en 44 px gras.
  const fix = (s: string) => s.replace(/\u202f/g, "\u00a0");
  // Un montant négatif porte le signe moins typographique, jamais un tiret.
  const money = (n: number) => (n < 0 ? `−${fix(f.whole(-n, cur))}` : fix(f.whole(n, cur)));
  const signed = money;
  const delta = (n: number) => (n > 0 ? `+${money(n)}` : signed(n));
  const period = (from: string, to: string) => {
    if (from === to) return f.month(from);
    const head = from.slice(0, 4) === to.slice(0, 4) ? f.month(from).replace(from.slice(0, 4), "").trim() : f.month(from);
    return `${head} – ${f.month(to)}`;
  };
  const longDay = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(f.locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return { money, signed, delta, period, longDay, f };
}

function RecapEditor({
  recap,
  treasury,
  cur,
  onClose,
}: {
  recap: ComptaRecap;
  treasury: Treasury | null;
  cur: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.money.Compta.recap");
  const s = useSheetFormat(cur);
  const slug = useProjectSlug();
  const exportRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<string[]>(() => autoPoints(recap, treasury, t, s));
  const [busy, setBusy] = useState(false);

  async function onDownload() {
    const node = exportRef.current;
    if (!node) return;
    setBusy(true);
    try {
      const url = await domToPng(node, {
        width: SHEET_WIDTH,
        height: node.offsetHeight,
        scale: 2,
        font: false,
        backgroundColor: C.page,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `compta-${slug}-${recap.from}${recap.to !== recap.from ? `_${recap.to}` : ""}.png`;
      a.click();
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label className="text-xs text-slate-600">{t("pointsTitle")}</Label>
          <span className="text-[11px] text-slate-400">{t("pointsHint")}</span>
        </div>
        {points.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <Textarea
              value={p}
              rows={2}
              aria-label={t("pointLabel", { n: i + 1 })}
              onChange={(e) => setPoints((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
              className="min-h-0 text-sm"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("removePoint", { n: i + 1 })}
              onClick={() => setPoints((cur) => cur.filter((_, j) => j !== i))}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setPoints((cur) => [...cur, ""])}>
          <PlusIcon className="size-3.5" />
          {t("addPoint")}
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-slate-600">{t("preview")}</Label>
        <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50">
          <div style={{ width: SHEET_WIDTH * PREVIEW_SCALE }} className="mx-auto">
            <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left", width: SHEET_WIDTH }} aria-hidden>
              <RecapSheet recap={recap} treasury={treasury} points={points} s={s} />
            </div>
          </div>
        </div>
      </div>

      {/* L'image exportée : la même feuille, à taille réelle, hors de l'écran. */}
      <div aria-hidden style={{ position: "fixed", left: -20_000, top: 0, pointerEvents: "none" }}>
        <div ref={exportRef} data-testid="compta-recap-sheet">
          <RecapSheet recap={recap} treasury={treasury} points={points} s={s} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("close")}
        </Button>
        <Button onClick={onDownload} disabled={busy} data-testid="compta-recap-download">
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
          {t("download")}
        </Button>
      </DialogFooter>
    </>
  );
}

type SheetFormat = ReturnType<typeof useSheetFormat>;
type Translate = ReturnType<typeof useTranslations<"admin.money.Compta.recap">>;

/** Les points pré-remplis : ce qui a fait bouger le résultat, ce qui reste dû, les alertes litige. */
function autoPoints(recap: ComptaRecap, treasury: Treasury | null, t: Translate, s: SheetFormat): string[] {
  const out: string[] = [];
  const prev = recap.previous;
  if (prev) {
    const diff = recap.result - prev.result;
    const drivers = recap.drivers.map((d) => {
      const up = d.effect > 0;
      switch (d.key) {
        case "net":
          return t(up ? "driverNetUp" : "driverNetDown", { amount: s.delta(d.effect) });
        case "creators":
          return t(up ? "driverCreatorsDown" : "driverCreatorsUp", { amount: s.delta(-d.effect) });
        case "scans":
          return t(up ? "driverScansDown" : "driverScansUp", { amount: s.delta(-d.effect) });
        case "other":
          return t(up ? "driverOtherDown" : "driverOtherUp", { amount: s.delta(-d.effect) });
      }
    });
    out.push(
      t("autoResult", {
        direction: diff < 0 ? "down" : diff > 0 ? "up" : "flat",
        prev: s.period(prev.from, prev.to),
        before: s.signed(prev.result),
        after: s.signed(recap.result),
        drivers: drivers.length > 0 ? t("autoResultDrivers", { list: drivers.join(t("and")) }) : "",
      }),
    );
  }
  if (treasury && treasury.creatorsDue.converted !== null && treasury.creatorsDue.converted > 0) {
    out.push(t("autoCreatorsDue", { amount: s.money(treasury.creatorsDue.converted) }));
  }
  if (recap.alertFees.count > 0) {
    out.push(
      t("autoAlerts", {
        count: recap.alertFees.count,
        amount: s.money(recap.alertFees.amount),
        prev: prev ? s.period(prev.from, prev.to) : "none",
        prevAmount: prev ? s.money(prev.alertFees.amount) : "",
      }),
    );
  }
  return out;
}

/** « **gras** reste » → le passage entre doubles astérisques en gras. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <b key={i} style={{ fontWeight: 650 }}>
            {p}
          </b>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function RecapSheet({
  recap,
  treasury,
  points,
  s,
}: {
  recap: ComptaRecap;
  treasury: Treasury | null;
  points: string[];
  s: SheetFormat;
}) {
  const t = useTranslations("admin.money.Compta.recap");
  const tc = useTranslations("admin.money.Compta.categories");
  const { project } = useProject();
  const [today] = useState(() => parisDayKey(Date.now()));
  const title = s.period(recap.from, recap.to);
  const prev = recap.previous;
  const prevLabel = prev ? s.period(prev.from, prev.to) : "";
  const shares = netShares(recap);
  const color = { result: C.result, creators: C.creators, scans: C.scans, other: C.other };
  const scansDetail =
    recap.scanSource === "paid"
      ? t("legendScansPaid")
      : recap.scanSource === "estimate"
        ? t("legendScansEstimate")
        : recap.scanSource === "mixed"
          ? t("legendScansMixed")
          : "";
  const legend = [
    { key: "result" as const, name: t("legendResult"), detail: t("legendResultDetail"), amount: recap.result },
    { key: "creators" as const, name: t("legendCreators"), detail: t("legendCreatorsDetail"), amount: recap.creators },
    { key: "scans" as const, name: t("legendScans"), detail: scansDetail, amount: recap.scans },
    {
      key: "other" as const,
      name: t("legendOther"),
      detail:
        recap.otherByCategory.length > 0
          ? t("legendOtherDetail", {
              list: recap.otherByCategory
                .slice(0, 3)
                .map((c) => `${tc(c.category).toLocaleLowerCase(s.f.locale)} ${s.money(c.amount)}`)
                .join(", "),
            })
          : "",
      amount: recap.other,
    },
  ];
  const shareOf = (key: string) => shares.find((x) => x.key === key)?.share ?? null;
  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 20 } as const;

  return (
    <div style={{ width: SHEET_WIDTH, background: C.page, color: C.ink, fontFamily: FONT, padding: 56, WebkitFontSmoothing: "antialiased" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: C.muted }}>
          {t("eyebrow", { project: project.name })}
        </div>
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-.02em", marginTop: 6 }}>
          {title.charAt(0).toLocaleUpperCase(s.f.locale) + title.slice(1)}
        </div>
        <div style={{ fontSize: 17, color: C.ink2, marginTop: 8 }}>
          {t(recap.inProgress ? "subtitleInProgress" : "subtitle", { date: s.longDay(today) })}
        </div>
        {recap.incomplete && <div style={{ fontSize: 15, color: "#9a5b00", marginTop: 6 }}>{t("incomplete")}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
        <Kpi label={t("kpiGross")} value={s.money(recap.gross)} note={recap.grossChange !== null && prev ? t("kpiGrossNote", { change: recap.grossChange > 0 ? `+${recap.grossChange}` : String(recap.grossChange).replace("-", "−"), prev: prevLabel, amount: s.money(prev.gross) }) : ""} />
        <Kpi label={t("kpiNet")} value={s.money(recap.net)} note={t("kpiNetNote", { amount: s.signed(recap.deductions) })} />
        <Kpi
          hero
          label={t("kpiResult")}
          value={s.signed(recap.result)}
          note={
            recap.margin === null
              ? prev
                ? t("kpiResultPrevOnly", { prev: prevLabel, amount: s.signed(prev.result) })
                : ""
              : prev
                ? t("kpiResultNotePrev", { margin: recap.margin, prev: prevLabel, amount: s.signed(prev.result) })
                : t("kpiResultNote", { margin: recap.margin })
          }
        />
      </div>

      <div style={{ ...card, padding: "40px 44px", marginTop: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 650, marginBottom: 22 }}>{t("netTitle", { amount: s.money(recap.net) })}</div>
        {shares.length > 0 && (
          <div style={{ display: "flex", height: 44, gap: 2, borderRadius: 4, overflow: "hidden" }}>
            {shares.map((x) => (
              <div key={x.key} style={{ width: `${x.share}%`, height: "100%", background: color[x.key] }} />
            ))}
          </div>
        )}
        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 40px" }}>
          {legend.map((l) => {
            const share = shareOf(l.key);
            return (
              <div key={l.key} style={{ display: "grid", gridTemplateColumns: "16px 1fr auto", alignItems: "baseline", gap: 12 }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, background: color[l.key], transform: "translateY(1px)" }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{l.name}</div>
                  {l.detail && <div style={{ fontSize: 14.5, color: C.muted, marginTop: 3 }}>{l.detail}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{s.signed(l.amount)}</div>
                  {share !== null && (
                    <div style={{ fontSize: 14.5, color: C.ink2, fontWeight: 500, marginTop: 3 }}>{t("share", { n: Math.round(share) })}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {recap.result < 0 && (
          <div style={{ fontSize: 15, color: C.ink2, marginTop: 18 }}>{t("legendNegative", { amount: s.money(-recap.result) })}</div>
        )}
      </div>

      {treasury && treasury.inCash !== null && treasury.available !== null && (
        <div style={{ ...card, padding: "40px 44px", marginTop: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 650, marginBottom: 22 }}>
            {t("treasuryTitle", { date: s.longDay(treasury.today) })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 14, alignItems: "stretch" }}>
            <CashBox
              label={t("cash")}
              value={s.money(treasury.inCash)}
              note={[
                ...(treasury.whop.total !== null ? [`Whop ${s.money(treasury.whop.total)}`] : []),
                ...treasury.accounts.filter((a) => a.counted && a.estimated !== null).map((a) => `${a.name} ${s.money(a.estimated!)}`),
              ].join(" · ")}
            />
            <Op>−</Op>
            <CashBox
              label={t("reserved")}
              value={s.money((treasury.setAside.remaining ?? 0) + (treasury.creatorsDue.converted ?? 0))}
              note={t("reservedNote", {
                due: s.money(treasury.creatorsDue.converted ?? 0),
                aside: s.money(treasury.setAside.remaining ?? 0),
              })}
            />
            <Op>=</Op>
            <CashBox final label={t("available")} value={s.signed(treasury.available)} note={t("availableNote")} />
          </div>
        </div>
      )}

      {points.some((p) => p.trim() !== "") && (
        <div style={{ ...card, padding: "40px 44px", marginTop: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 650, marginBottom: 22 }}>{t("pointsHeading")}</div>
          <div style={{ display: "grid", gap: 16 }}>
            {points
              .filter((p) => p.trim() !== "")
              .map((p, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: 12, fontSize: 17.5, lineHeight: 1.45 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: "#efeee9",
                      color: C.ink2,
                      fontWeight: 650,
                      fontSize: 15,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>
                    <Rich text={p.trim()} />
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 22, fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{t("footer")}</div>
    </div>
  );
}

function Kpi({ label, value, note, hero }: { label: string; value: string; note: string; hero?: boolean }) {
  return (
    <div
      style={{
        background: C.card,
        border: hero ? `2px solid ${C.result}` : `1px solid ${C.border}`,
        borderRadius: 18,
        padding: "28px 30px",
      }}
    >
      <div style={{ fontSize: 16, color: C.ink2, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-.02em", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {note && <div style={{ fontSize: 15, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>{note}</div>}
    </div>
  );
}

function CashBox({ label, value, note, final }: { label: string; value: string; note: string; final?: boolean }) {
  return (
    <div style={{ border: final ? `2px solid ${C.ink}` : `1px solid ${C.border}`, borderRadius: 16, padding: "22px 24px" }}>
      <div style={{ fontSize: 15, color: C.ink2, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.02em", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {note && <div style={{ fontSize: 14, color: C.muted, marginTop: 6, lineHeight: 1.4 }}>{note}</div>}
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return <div style={{ alignSelf: "center", fontSize: 30, color: C.muted, fontWeight: 300 }}>{children}</div>;
}
