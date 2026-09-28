"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currencySymbol } from "@/lib/currency";
import {
  evaluateVideoBonus,
  type VideoBonusGrid,
} from "@/lib/pricing-engine";
import {
  formatSeuil,
  validVideoBonusTiers,
  videoBonusExamplePoints,
} from "@/lib/pricing-shape";

/**
 * BONUS PAR VIDÉO — saisie d'une grille « seuil de vues → montant » et de la
 * règle de cumul, avec l'EXEMPLE qui dit ce qu'une vidéo touchera avant qu'on
 * enregistre quoi que ce soit.
 *
 * Partagé par l'éditeur de MODÈLE et l'éditeur de BARÈME : la grille est la même
 * donnée dans les deux (le modèle se recopie dans `pricings.videoBonus`).
 *
 * L'exemple passe par `evaluateVideoBonus`, le moteur de paie lui-même (répliqué
 * côté serveur) : ce que l'admin lit ici est ce que la paie versera.
 */

export type VideoBonusForm = {
  tiers: { seuilVues: string; montant: string }[];
  cumulative: boolean;
};

export function emptyVideoBonusForm(): VideoBonusForm {
  return { tiers: [{ seuilVues: "", montant: "" }], cumulative: false };
}

export function videoBonusToForm(
  grid: VideoBonusGrid | null | undefined,
): VideoBonusForm {
  if (!grid || grid.tiers.length === 0) {
    return { tiers: [], cumulative: false };
  }
  return {
    tiers: [...grid.tiers]
      .sort((a, b) => a.seuilVues - b.seuilVues)
      .map((t) => ({ seuilVues: String(t.seuilVues), montant: String(t.montant) })),
    cumulative: grid.cumulative,
  };
}

/** Saisie → grille du domaine. Les lignes entièrement vides sont ignorées. */
export function formToVideoBonus(form: VideoBonusForm): VideoBonusGrid {
  return {
    tiers: form.tiers
      .filter((t) => t.seuilVues.trim() !== "" || t.montant.trim() !== "")
      .map((t) => ({ seuilVues: Number(t.seuilVues), montant: Number(t.montant) })),
    cumulative: form.cumulative,
  };
}

export function VideoBonusEditor({
  form,
  setForm,
  payCurrency,
  money,
}: {
  form: VideoBonusForm;
  setForm: (f: VideoBonusForm) => void;
  payCurrency: string | null | undefined;
  money: (n: number) => string;
}) {
  const t = useTranslations("admin.money.VideoBonusEditor");
  const sym = currencySymbol(payCurrency);
  function updateTier(i: number, patch: Partial<VideoBonusForm["tiers"][number]>) {
    setForm({
      ...form,
      tiers: form.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    });
  }
  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 space-y-2">
        {form.tiers.map((tier, i) => (
          <div
            key={i}
            className="flex min-w-0 flex-wrap items-end gap-2 rounded-md border border-slate-200 p-2"
          >
            <div className="min-w-[8rem] flex-1 space-y-1">
              <Label htmlFor={`vb-seuil-${i}`} className="text-xs">
                {t("views")}
              </Label>
              <Input
                id={`vb-seuil-${i}`}
                type="number"
                // Pas de `step` : avec min=1, un pas de 1000 rendrait 50 000
                // INVALIDE (valeurs permises 1, 1 001…) et le navigateur
                // bloquerait l'envoi du formulaire sans rien dire.
                min={1}
                placeholder="50000"
                value={tier.seuilVues}
                onChange={(e) => updateTier(i, { seuilVues: e.target.value })}
                className="tabular-nums"
                required
              />
            </div>
            <div className="min-w-[7rem] flex-1 space-y-1">
              <Label htmlFor={`vb-montant-${i}`} className="text-xs">
                {/* Sans devise de paie posée, pas de « () » vide. */}
                {sym ? t("bonusWithCurrency", { symbol: sym }) : t("bonus")}
              </Label>
              <Input
                id={`vb-montant-${i}`}
                type="number"
                min={0.01}
                step="0.01"
                placeholder="10"
                value={tier.montant}
                onChange={(e) => updateTier(i, { montant: e.target.value })}
                className="tabular-nums"
                required
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setForm({ ...form, tiers: form.tiers.filter((_, j) => j !== i) })
              }
            >
              {t("remove")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setForm({ ...form, tiers: [...form.tiers, { seuilVues: "", montant: "" }] })
          }
        >
          {t("addThreshold")}
        </Button>
      </div>

      <label className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2">
        <Checkbox
          checked={form.cumulative}
          onCheckedChange={(c) => setForm({ ...form, cumulative: c === true })}
          className="mt-0.5"
          aria-label={t("cumulative")}
        />
        <span className="min-w-0 text-sm">
          <span className="block font-medium text-slate-900">
            {t("cumulative")}
          </span>
          <span className="block text-xs leading-relaxed text-slate-500">
            {form.cumulative ? t("cumulativeOn") : t("cumulativeOff")}
          </span>
        </span>
      </label>

      <VideoBonusExample grid={formToVideoBonus(form)} money={money} />
    </div>
  );
}

/** Détail lisible d'un montant : « 10 $ + 20 $ » cumulé, « seuil 100 k » sinon. */
function detailOf(
  views: number,
  grid: VideoBonusGrid,
  money: (n: number) => string,
  t: ReturnType<typeof useTranslations<"admin.money.VideoBonusEditor">>,
): string {
  const ev = evaluateVideoBonus(views, grid);
  if (ev.crossed.length === 0) return t("noneReached");
  if (grid.cumulative) {
    return ev.crossed.length === 1
      ? t("thresholdOne", { threshold: formatSeuil(ev.crossed[0].seuilVues) })
      : ev.crossed.map((x) => money(x.montant)).join(" + ");
  }
  const top = ev.crossed[ev.crossed.length - 1];
  return ev.crossed.length === 1
    ? t("thresholdOne", { threshold: formatSeuil(top.seuilVues) })
    : t("thresholdOnly", { threshold: formatSeuil(top.seuilVues) });
}

/**
 * L'EXEMPLE — la phrase qui rend la case « cumulables » concrète, puis un
 * tableau tiré de la grille elle-même, puis un champ pour tester n'importe quel
 * nombre de vues. Sans grille valide, rien : un exemple sur une saisie à moitié
 * faite ne ferait que montrer des zéros.
 */
export function VideoBonusExample({
  grid,
  money,
}: {
  grid: VideoBonusGrid;
  money: (n: number) => string;
}) {
  const t = useTranslations("admin.money.VideoBonusEditor");
  const [custom, setCustom] = useState("");
  const valid: VideoBonusGrid = {
    tiers: validVideoBonusTiers(grid.tiers),
    cumulative: grid.cumulative,
  };
  if (valid.tiers.length === 0) return null;
  const points = videoBonusExamplePoints(valid.tiers);
  // La phrase se place là où le cumul CHANGE le résultat : entre le 2e et le 3e
  // seuil (ou au-delà du 2e). Avec un seul seuil, cumulable ou non revient au
  // même, et la phrase le dit.
  const [a, b, c] = valid.tiers;
  const pivot = b ? (c ? Math.round((b.seuilVues + c.seuilVues) / 2) : b.seuilVues) : a.seuilVues;
  const pivotAmount = evaluateVideoBonus(pivot, valid).amount;
  const customViews = Number(custom);
  const hasCustom = custom.trim() !== "" && Number.isFinite(customViews) && customViews >= 0;

  return (
    <div
      className="min-w-0 space-y-2 rounded-xl border border-orange-100 bg-orange-50/40 px-3 py-2.5"
      data-testid="video-bonus-example"
    >
      <p className="text-[10.5px] font-semibold tracking-wider text-orange-800 uppercase">
        {t("example")}
      </p>
      <p className="text-sm leading-relaxed text-slate-700">
        {/* Texte simple : les catalogues n'admettent pas de balises riches. */}
        {t(b ? "pivotMulti" : "pivotSingle", {
          views: formatSeuil(pivot),
          amount: money(pivotAmount),
          detail: detailOf(pivot, valid, money, t),
          rule: valid.cumulative ? t("ruleCumulative") : t("ruleNotCumulative"),
        })}
      </p>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-[10.5px] font-medium tracking-wider text-slate-400 uppercase">
            <th className="py-1 font-medium">{t("colViews")}</th>
            <th className="py-1 text-right font-medium">{t("colBonus")}</th>
            <th className="hidden py-1 pl-3 font-medium sm:table-cell">{t("colDetail")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-orange-100">
          {points.map((v) => (
            <tr key={v}>
              <td className="py-1 text-slate-600">{formatSeuil(v)}</td>
              <td className="py-1 text-right font-semibold text-slate-900">
                {money(evaluateVideoBonus(v, valid).amount)}
              </td>
              <td className="hidden py-1 pl-3 text-slate-500 sm:table-cell">
                {detailOf(v, valid, money, t)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
        <Label htmlFor="vb-test" className="text-xs text-slate-600">
          {t("test")}
        </Label>
        <Input
          id="vb-test"
          type="number"
          min={0}
          placeholder={t("testPlaceholder")}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-8 w-32 tabular-nums"
        />
        {hasCustom && (
          <span className="text-sm text-slate-700" data-testid="video-bonus-test-result">
            → <b className="tabular-nums">{money(evaluateVideoBonus(customViews, valid).amount)}</b>{" "}
            <span className="text-xs text-slate-500">
              ({detailOf(customViews, valid, money, t)})
            </span>
          </span>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        {t("footnote")}
      </p>
    </div>
  );
}
