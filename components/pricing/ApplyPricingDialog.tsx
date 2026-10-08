"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangleIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
import { formatMoney } from "@/lib/format-rate";
import { formatCycleRange } from "@/lib/pay-cycle";
import { useIntlLocale } from "@/lib/use-intl-locale";

type Preview = FunctionReturnType<typeof api.pricingReassign.previewReassign>;
type Terms = Preview["terms"];
type Refusal = NonNullable<Preview["videos"][number]["refusal"]>;

/** Aujourd'hui à Paris, AAAA-MM-JJ — le défaut de « à partir du ». */
const todayParis = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

/**
 * APPLIQUER UN BARÈME À DES VIDÉOS DÉJÀ ATTRIBUÉES — « elle est passée à son
 * nouveau contrat le 7 ».
 *
 * Le barème d'une vidéo est figé à son attribution : créer le nouveau barème ne
 * change la paie d'aucune vidéo existante. Cette modale passe les vidéos d'UNE
 * créatrice sur ce barème à partir d'un jour (publication, sinon jour prévu),
 * publiées comprises — après un APERÇU qui liste chaque vidéo et ce qui en
 * laisse certaines (cycle payé, défi, pas de barème).
 *
 * Le nombre montré par l'aperçu part avec le clic : si la liste a bougé entre
 * les deux (une vidéo payée entre-temps), le serveur refuse au lieu d'écrire
 * un périmètre que personne n'a vu.
 */
export function ApplyPricingDialog({
  pricingId,
  pricingName,
  open,
  onOpenChange,
}: {
  pricingId: Id<"pricings">;
  pricingName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("admin.money.ApplyPricingDialog");
  const tStatus = useTranslations("admin.assignments.statusFilter");
  const locale = useIntlLocale();
  const creators = useProjectQuery(
    api.pricingReassign.listReassignCreators,
    open ? {} : "skip",
  );
  const apply = useProjectMutation(api.pricingReassign.reassignPricing);

  const [creatorId, setCreatorId] = useState<string>("");
  const [from, setFrom] = useState(todayParis);
  const [to, setTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset à l'ouverture (pattern du dépôt : au rendu, pas dans un effet).
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setCreatorId("");
    setFrom(todayParis());
    setTo("");
  }

  // Une plage à l'envers ne part pas au serveur : sa query lèverait, et une
  // query qui lève emporte l'écran entier.
  const rangeOk = from !== "" && (to === "" || to >= from);
  const preview = useProjectQuery(
    api.pricingReassign.previewReassign,
    open && creatorId !== "" && rangeOk
      ? {
          creatorId: creatorId as Id<"creators">,
          pricingId,
          du: from,
          ...(to !== "" ? { au: to } : {}),
        }
      : "skip",
  );

  const money = (n: number, currency: string | null) => formatMoney(n, currency, locale);
  const termsText = (x: Terms) =>
    [
      t("termsFixed", { amount: money(x.montantFixe, x.currency), videos: x.nbVideosCible }),
      t("termsCpm", { amount: money(x.tauxCPM, x.currency) }),
      ...(x.seuilVuesFixe > 0
        ? [t("termsThreshold", { views: new Intl.NumberFormat(locale).format(x.seuilVuesFixe) })]
        : []),
    ].join(" · ");
  const dayText = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const refusalText = (r: Refusal) => t(`refusal.${r}`);

  const canApply =
    preview !== undefined &&
    preview.toChange > 0 &&
    preview.currency.compatible &&
    !submitting;

  async function handleApply() {
    if (!preview) return;
    setSubmitting(true);
    try {
      const res = await apply({
        creatorId: creatorId as Id<"creators">,
        pricingId,
        du: from,
        ...(to !== "" ? { au: to } : {}),
        expected: preview.toChange,
      });
      toast.success(t("done", { count: res.changed, pricing: pricingName }));
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title", { pricing: pricingName })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Colonne bornée aussi sur mobile : une piste `auto` prend la largeur
              du plus long nom de créatrice et pousse les champs hors de la modale. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem]">
            <div className="space-y-1.5">
              <Label htmlFor="apply-pricing-creator">{t("creator")}</Label>
              <Select
                value={creatorId}
                onValueChange={(v) => setCreatorId(v ?? "")}
                items={(creators ?? []).map((c) => ({ value: c._id, label: c.name }))}
              >
                <SelectTrigger id="apply-pricing-creator" className="w-full min-w-0">
                  <SelectValue placeholder={t("creatorPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {(creators ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apply-pricing-from">{t("from")}</Label>
              <Input
                id="apply-pricing-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apply-pricing-to">{t("to")}</Label>
              <Input
                id="apply-pricing-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {!rangeOk ? (
            <p className="text-sm text-amber-700">{t("rangeInvalid")}</p>
          ) : creatorId === "" ? (
            <p className="text-sm text-slate-500">{t("pickCreator")}</p>
          ) : preview === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                {t("summary", { count: preview.toChange, pricing: pricingName })}{" "}
                <span className="text-slate-500">{termsText(preview.terms)}</span>
              </p>
              {!preview.currency.compatible && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  {t("currencyMismatch", {
                    name: preview.creatorName,
                    creatorCurrency: (preview.currency.createatrice ?? "—").toUpperCase(),
                    pricingCurrency: (preview.currency.bareme ?? "—").toUpperCase(),
                  })}
                </p>
              )}
              {preview.videos.length === 0 ? (
                <p className="text-sm text-slate-500">{t("noVideos")}</p>
              ) : (
                <ul
                  className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200"
                  data-testid="apply-pricing-videos"
                >
                  {preview.videos.map((v) => (
                    <li
                      key={v.assignmentId}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm"
                    >
                      <span className="w-16 shrink-0 font-medium text-slate-800 tabular-nums">
                        {dayText(v.day)}
                      </span>
                      <span className="w-24 shrink-0 text-xs text-slate-500">
                        {tStatus(v.status as "todo")}
                      </span>
                      {/* Mobile : le barème actuel passe sous la ligne, pleine
                          largeur, au lieu de s'écraser entre deux colonnes fixes. */}
                      <span className="order-last min-w-0 basis-full text-xs text-slate-500 sm:order-none sm:basis-0 sm:flex-1">
                        {v.currentPricingName ?? t("noPricing")}
                        {v.currentTerms && ` — ${termsText(v.currentTerms)}`}
                        {v.cycleStart !== null && v.cycleEnd !== null && (
                          <span className="block text-slate-400">
                            {t("cycle", { range: formatCycleRange(v.cycleStart, v.cycleEnd, locale) })}
                          </span>
                        )}
                      </span>
                      <span
                        className={
                          v.refusal === null
                            ? "ml-auto shrink-0 text-xs font-medium text-primary"
                            : "ml-auto shrink-0 text-xs text-slate-400"
                        }
                      >
                        {v.refusal === null ? t("willChange") : refusalText(v.refusal)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-500">{t("footnote")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button onClick={handleApply} disabled={!canApply}>
            {t("apply", { count: preview?.toChange ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
