"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  useProjectMutation,
  useProjectQuerySafe,
} from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format-rate";
import { formatCycleRange } from "@/lib/pay-cycle";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { ORPHAN_KEY_PREFIX } from "@/convex/paymentsView";

/**
 * EFFACER LE DÛ d'une créatrice — l'écran Paiements (maquette validée le
 * 25/11/2026).
 *
 * Le geste vit dans l'en-tête du bloc de la créatrice ; la fenêtre liste ses
 * cycles ouverts, tous cochés, et exige un motif. Un dû effacé quitte « À
 * payer » pour « Réglé », où il se lit « Dû effacé » et d'où il se rétablit.
 * Arbitrages du fondateur : cycle par cycle, rentabilité inchangée, rétablir à
 * tout moment (journalisé), aucun e-mail — l'espace de la créatrice affiche
 * « Annulé », sans le motif.
 *
 * Le mot « Annuler » appartient déjà au paiement posé par erreur : d'où
 * « Effacer » et « Rétablir » ici, pour que les deux gestes ne se confondent pas.
 */

type Payment = FunctionReturnType<typeof api.payments.listPayments>[number];

const NS = "admin.money.CancelDue";
const round2 = (n: number) => Math.round(n * 100) / 100;

const jour = (ts: number, loc: string) =>
  new Date(ts).toLocaleDateString(loc, { day: "numeric", month: "short" });
const instant = (ts: number, loc: string) =>
  new Date(ts).toLocaleString(loc, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function RecapLine({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-4">
      <span className="text-slate-600">{label}</span>
      <span className="text-right tabular-nums text-slate-800">{children}</span>
    </li>
  );
}

/**
 * « Effacer le dû… » — dans l'en-tête du bloc d'une créatrice. `cycles` = ses
 * cycles OUVERTS rattachés à une fiche vivante (ceux qu'on pourrait payer).
 * `resteEcran` = le « Reste à payer » de l'écran dans SA devise, pour dire ce
 * qu'il deviendra.
 */
export function CancelDueButton({
  creatorName,
  cycles,
  currency,
  resteEcran,
  disabled,
}: {
  creatorName: string;
  cycles: Payment[];
  currency?: string | null;
  resteEcran: number | null;
  disabled: boolean;
}) {
  const tr = useTranslations(NS);
  const loc = useIntlLocale();
  const showError = useConvexError();
  const cancel = useProjectMutation(api.payments.cancelCycleDue);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  if (cycles.length === 0) return null;

  function ouvrir() {
    setChecked(new Set(cycles.map((c) => c.key)));
    setReason("");
    setNow(Date.now());
    setOpen(true);
  }

  function basculer(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** « Fixe 93,33 € · CPM 26,33 € » — ce qui compose la valeur d'un cycle ouvert. */
  function composition(p: Payment): string {
    const b = p.pricingBreakdown;
    const legacy = round2(p.lineItems.reduce((s, li) => s + li.amount, 0));
    const parts: [string, number][] = [
      [tr("compoFixe"), b.fixedTotal],
      [tr("compoCpm"), b.cpmTotal],
      [tr("compoPaliers"), b.bonusTierCashTotal],
      [tr("compoDefis"), b.challengeTotal],
      [tr("compoBonusVideo"), b.videoBonusTotal],
      [tr("compoLignes"), legacy],
    ];
    return parts
      .filter(([, n]) => n > 0)
      .map(([l, n]) => `${l} ${formatMoney(n, currency, loc)}`)
      .join(" · ");
  }

  const choisis = cycles.filter((c) => checked.has(c.key));
  const efface = round2(choisis.reduce((s, c) => s + c.remainingDue, 0));
  const enCours = choisis.filter((c) => c.cycleEnd > now);
  const motif = reason.trim();
  const pret = motif.length > 0 && choisis.length > 0 && !busy;

  async function submit() {
    // Snapshot : la query est réactive, un cycle effacé sort de la liste.
    const cibles = choisis.map((c) => ({
      creatorId: c.creatorId,
      cycleIndex: c.cycleIndex,
      totalDue: c.totalDue,
      range: formatCycleRange(c.cycleStart, c.cycleEnd, loc),
    }));
    setBusy(true);
    let ok = 0;
    const changes: string[] = [];
    try {
      for (const c of cibles) {
        const r = await cancel({
          creatorId: c.creatorId,
          cycleIndex: c.cycleIndex,
          reason: motif,
          // Le montant MONTRÉ : la mutation refuse d'effacer un autre chiffre.
          expectedTotalDue: c.totalDue,
        });
        if (r.ok) ok++;
        else changes.push(c.range);
      }
    } catch (e) {
      toast.error(showError(e, tr("erreur")));
    } finally {
      setBusy(false);
    }
    if (ok > 0) toast.success(tr("effaceOk", { count: ok, creatorName }));
    if (changes.length > 0) {
      toast.error(tr("montantChange", { cycles: changes.join(", ") }));
    }
    if (ok === cibles.length) setOpen(false);
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800"
        onClick={ouvrir}
        disabled={disabled}
        data-testid="cancel-due-open"
      >
        {tr("bouton")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("titre", { creatorName })}</DialogTitle>
            <DialogDescription>{tr("description")}</DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs text-slate-500">{tr("cyclesAEffacer")}</legend>
            {cycles.map((c) => {
              const avances = round2(c.advances.reduce((s, a) => s + a.amount, 0));
              const id = `cancel-due-${c.key}`;
              const compo = composition(c);
              return (
                <label
                  key={c.key}
                  htmlFor={id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <Checkbox
                    id={id}
                    checked={checked.has(c.key)}
                    onCheckedChange={() => basculer(c.key)}
                    disabled={busy}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm text-slate-800">
                      {formatCycleRange(c.cycleStart, c.cycleEnd, loc)}
                      {c.cycleEnd > now && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                          {tr("enCours")}
                        </span>
                      )}
                    </span>
                    {compo && <span className="block text-xs text-slate-500">{compo}</span>}
                    {avances > 0 && (
                      <span className="block text-xs text-slate-500">
                        {tr("acompteGarde", { amount: formatMoney(avances, currency, loc) })}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatMoney(c.remainingDue, currency, loc)}
                  </span>
                </label>
              );
            })}
            {enCours.length > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                {tr("avertissementEnCours", {
                  count: enCours.length,
                  date: jour(Math.max(...enCours.map((c) => c.cycleEnd)), loc),
                })}
              </p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor="cancel-due-reason" className="text-xs font-medium text-slate-700">
              {tr("motif")} <span className="text-rose-700">{tr("obligatoire")}</span>
            </label>
            <Textarea
              id="cancel-due-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={tr("motifExemple")}
              disabled={busy}
            />
            <p className="text-[11px] text-slate-500">{tr("motifAide")}</p>
          </div>

          <ul className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <RecapLine label={tr("recapEfface")}>
              <span className="font-medium text-slate-900">
                {formatMoney(efface, currency, loc)}
              </span>
            </RecapLine>
            {resteEcran !== null && (
              <RecapLine label={tr("recapResteEcran")}>
                {formatMoney(resteEcran, currency, loc)} →{" "}
                {formatMoney(Math.max(0, round2(resteEcran - efface)), currency, loc)}
              </RecapLine>
            )}
            <RecapLine label={tr("recapCompta")}>
              − {formatMoney(efface, currency, loc)}
            </RecapLine>
            <RecapLine label={tr("recapRentabilite")}>{tr("inchange")}</RecapLine>
            <RecapLine label={tr("recapEmail", { creatorName })}>{tr("aucunEmail")}</RecapLine>
          </ul>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {tr("retour")}
            </Button>
            <Button
              variant="destructive"
              onClick={submit}
              disabled={!pret}
              data-testid="cancel-due-confirm"
            >
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("effacerMontant", { amount: formatMoney(efface, currency, loc) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Le JOURNAL d'un cycle : chaque effacement et chaque rétablissement, avec qui
 * et quand. Rien si le cycle n'a jamais été effacé.
 */
export function CancellationJournal({
  entries,
  currency,
}: {
  entries: Payment["cancellationLog"] | undefined;
  currency?: string | null;
}) {
  const tr = useTranslations(NS);
  const loc = useIntlLocale();
  if (!entries || entries.length === 0) return null;
  return (
    <ul
      className="space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-500"
      aria-label={tr("journal")}
    >
      {entries.map((e, i) => {
        const morceaux = [
          tr(e.kind === "cancel" ? "journalEfface" : "journalRetabli", {
            quand: instant(e.at, loc),
          }),
          e.byName ? tr("par", { qui: e.byName }) : null,
          e.kind === "cancel" && e.amount !== null
            ? `— ${tr("journalValait", { amount: formatMoney(e.amount, currency, loc) })}`
            : null,
          e.kind === "cancel" && e.reason ? `— « ${e.reason} »` : null,
        ];
        return <li key={i}>{morceaux.filter(Boolean).join(" ")}</li>;
      })}
    </ul>
  );
}

/** UN DÛ EFFACÉ dans « Réglé » : ce qui a été versé (acomptes), ce qui a été effacé, le motif, « Rétablir ». */
export function CancelledRow({
  p,
  currency,
}: {
  p: Payment;
  currency?: string | null;
}) {
  const tr = useTranslations(NS);
  const loc = useIntlLocale();
  const [open, setOpen] = useState(false);
  const c = p.cancellation;
  if (!c) return null;
  const avances = round2(p.advances.reduce((s, a) => s + a.amount, 0));
  return (
    <div data-testid={`cycle-${p.key}`}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-slate-300 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-slate-800">
                {p.creatorName}
              </span>
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800">
                {tr("duEfface")}
              </span>
            </span>
            <span className="block truncate text-xs text-slate-500">
              {[
                formatCycleRange(p.cycleStart, p.cycleEnd, loc),
                [tr("effaceLe", { date: jour(c.at, loc) }), c.byName ? tr("par", { qui: c.byName }) : null]
                  .filter(Boolean)
                  .join(" "),
              ].join(" · ")}
            </span>
          </span>
        </button>
        <p className="text-right tabular-nums">
          <span className="block font-medium text-slate-900">
            {formatMoney(avances, currency, loc)}
          </span>
          <span className="block text-[11px] text-slate-500">
            <span className="line-through">{formatMoney(c.remaining, currency, loc)}</span>{" "}
            {tr("effaces")}
          </span>
        </p>
        <RestoreButton p={p} currency={currency} />
      </div>
      {open && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 pl-12">
          <p className="text-sm leading-relaxed text-slate-700">
            <span className="text-slate-500">{tr("motifLabel")}</span> {c.reason}
          </p>
          {c.lineItems.length > 0 && (
            <ul className="space-y-1 text-sm">
              {c.lineItems.map((li, i) => (
                <li key={i} className="flex items-center justify-between gap-4 text-slate-500">
                  <span>{tr("ligneEffacee", { label: li.label })}</span>
                  <span className="tabular-nums">{formatMoney(li.amount, currency, loc)}</span>
                </li>
              ))}
            </ul>
          )}
          {p.advances.map((a, i) => (
            <p key={i} className="flex items-center justify-between gap-4 text-sm text-primary">
              <span>{tr("acompteVerseLe", { date: new Date(a.at).toLocaleDateString(loc) })}</span>
              <span className="tabular-nums">{formatMoney(a.amount, currency, loc)}</span>
            </p>
          ))}
          {/* Le dernier « effacé » du journal EST l'effacement affiché au-dessus :
              on ne montre que ce qui l'a précédé (effacé, rétabli…). */}
          <CancellationJournal entries={p.cancellationLog.slice(0, -1)} currency={currency} />
        </div>
      )}
    </div>
  );
}

/**
 * RÉTABLIR un dû effacé — à tout moment. Le cycle redevient dû et se
 * recalcule : la fenêtre dit ce qu'il vaut AUJOURD'HUI, pas seulement ce qu'il
 * valait quand on l'a effacé.
 */
function RestoreButton({ p, currency }: { p: Payment; currency?: string | null }) {
  const tr = useTranslations(NS);
  const loc = useIntlLocale();
  const showError = useConvexError();
  const restore = useProjectMutation(api.payments.restoreCycleDue);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Une row orpheline (fiche supprimée) n'a plus de cycle à recalculer.
  const orpheline = p.key.startsWith(ORPHAN_KEY_PREFIX);
  const apercu = useProjectQuerySafe(
    api.payments.restoreCycleDuePreview,
    open && !orpheline ? { creatorId: p.creatorId, cycleIndex: p.cycleIndex } : "skip",
  );
  const c = p.cancellation;
  if (!c || p.paymentId === null) return null;
  const paymentId = p.paymentId;

  async function submit() {
    setBusy(true);
    try {
      await restore({ id: paymentId });
      toast.success(tr("retabliOk", { creatorName: p.creatorName }));
      setOpen(false);
    } catch (e) {
      toast.error(showError(e, tr("erreur")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-xs text-slate-700 hover:text-slate-900"
        onClick={() => setOpen(true)}
        data-testid={`restore-due-${p.key}`}
      >
        {tr("retablirBouton")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("retablirTitre", { creatorName: p.creatorName })}</DialogTitle>
            <DialogDescription>
              {tr("retablirDescription", {
                range: formatCycleRange(p.cycleStart, p.cycleEnd, loc),
                date: jour(c.at, loc),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-xs text-slate-500">{tr("motifEffacement")}</p>
            <p className="text-sm leading-relaxed text-slate-700">{c.reason}</p>
          </div>
          <ul className="space-y-1.5 rounded-lg border border-slate-200 p-3 text-sm">
            <RecapLine label={tr("valaitALEffacement")}>
              {formatMoney(c.amount, currency, loc)}
            </RecapLine>
            {!orpheline && (
              <RecapLine label={tr("vautAujourdhui")}>
                <span className="font-medium text-slate-900" data-testid="restore-due-now">
                  {apercu.status === "ok"
                    ? formatMoney(apercu.data.totalDue, apercu.data.currency ?? currency, loc)
                    : apercu.status === "error"
                      ? tr("indisponible")
                      : tr("calcul")}
                </span>
              </RecapLine>
            )}
          </ul>
          <p className="text-xs leading-relaxed text-slate-500">{tr("retablirAide")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {tr("retour")}
            </Button>
            <Button onClick={submit} disabled={busy} data-testid="restore-due-confirm">
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("retablirConfirmer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
