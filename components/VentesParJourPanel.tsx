"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangleIcon, ExternalLinkIcon, InfoIcon } from "lucide-react";

import { useProjectAction } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type {
  JourVentesPosts,
  VentesEtPostsParJour,
} from "@/convex/ventesParJourMath";
import { formatNumber } from "@/lib/format";
import { formatMoney, formatMoneyWhole } from "@/lib/format-rate";

/**
 * Détail « Par jour » de la carte Rentabilité : chaque jour, les NOUVELLES
 * ventes Whop, et dessous les vues gagnées ; un clic sur un jour liste les posts
 * qui faisaient les vues ce jour-là.
 *
 * Deux graphes ALIGNÉS plutôt qu'un graphe à deux échelles : des euros et des
 * vues sur deux axes verticaux se lisent l'un dans l'autre, et l'œil compare
 * des hauteurs qui ne veulent rien dire ensemble. Mêmes jours, mêmes marges :
 * le pic de l'un tombe à l'aplomb du pic de l'autre.
 *
 * Calcul à la DEMANDE (une action, cf convex/ventesParJour) : il lit toute la
 * fenêtre de relevés du projet, donc il ne part pas à l'ouverture de la page
 * Paiements, seulement à l'ouverture de cet onglet. Chaque période calculée est
 * gardée le temps de la visite.
 */

const PERIODES = [14, 30, 60, 90] as const;
type Periode = (typeof PERIODES)[number];

/** Une teinte, deux pas : le jour choisi plein, les autres en clair. */
const VENTES = { on: "#4f46e5", off: "#a5b4fc" };
const VUES = { on: "#475569", off: "#cbd5e1" };
const TICK = { fontSize: 11, fill: "#475569" };
const MARGE = { top: 4, right: 8, left: 0, bottom: 0 };

type Pret = Extract<VentesEtPostsParJour, { configured: true }>;

/** « 2026-11-10 » → « 10/11 » (axe). Le jour vient du serveur, déjà en Paris. */
function jourCourt(jour: string): string {
  const [, m, d] = jour.split("-");
  return `${d}/${m}`;
}

/** « 2026-11-10 » → « Lundi 10 novembre ». L'UTC neutralise le fuseau du navigateur. */
function jourLong(jour: string, loc: string): string {
  const s = new Date(`${jour}T12:00:00Z`).toLocaleDateString(loc, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Date de publication (ms) → « 08/11 », jour de Paris. */
function publieLe(ms: number, loc: string): string {
  return new Date(ms).toLocaleDateString(loc, {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
  });
}

/** Le jour qu'on ouvre d'abord : celui qui a fait le plus de nouvelles ventes (le plus récent à égalité). */
function jourDuPic(jours: readonly JourVentesPosts[]): string | null {
  let pic: JourVentesPosts | null = null;
  for (const j of jours) {
    if (pic === null || j.nouvelles >= pic.nouvelles) pic = j;
  }
  return pic?.jour ?? null;
}

function InfoBulle({
  active,
  label,
  data,
}: {
  active?: boolean;
  label?: string | number;
  data: Pret;
}) {
  const t = useTranslations("admin.money.VentesParJour");
  const loc = useLocale();
  if (!active || typeof label !== "string") return null;
  const j = data.jours.find((x) => x.jour === label);
  if (!j) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-slate-900">{jourLong(j.jour, loc)}</div>
      <div className="mt-1 text-slate-700">
        {t("ventesDuJour", { count: j.nouvelles })}
        {j.netNouvelles !== null ? ` · ${formatMoney(j.netNouvelles, data.currency, loc)}` : ""}
      </div>
      <div className="text-slate-500">
        {t("bulleAutres", {
          montant: j.netAutres !== null ? formatMoney(j.netAutres, data.currency, loc) : "—",
        })}
      </div>
      <div className="text-slate-500">{t("vuesDuJour", { vues: formatNumber(j.vues, loc) })}</div>
    </div>
  );
}

export function VentesParJourPanel() {
  const t = useTranslations("admin.money.VentesParJour");
  const loc = useLocale();
  const charger = useProjectAction(api.ventesParJour.getVentesEtPostsParJour);
  const [periode, setPeriode] = useState<Periode>(30);
  const memoire = useRef(new Map<Periode, VentesEtPostsParJour>());
  const [resultat, setResultat] = useState<{
    periode: Periode;
    data: VentesEtPostsParJour;
  } | null>(null);
  const [erreur, setErreur] = useState<{ periode: Periode; message: string } | null>(null);
  const [jourChoisi, setJourChoisi] = useState<string | null>(null);

  useEffect(() => {
    const deja = memoire.current.get(periode);
    if (deja !== undefined) {
      setResultat({ periode, data: deja });
      return;
    }
    let annule = false;
    charger({ jours: periode })
      .then((data) => {
        memoire.current.set(periode, data);
        if (!annule) setResultat({ periode, data });
      })
      .catch((e: unknown) => {
        if (!annule) {
          setErreur({ periode, message: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      annule = true;
    };
    // `charger` change à chaque rendu (hook projet) : seule la période relance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periode]);

  const lu = resultat !== null && resultat.periode === periode ? resultat.data : null;
  const data = lu !== null && lu.configured ? lu : null;
  const echec = erreur !== null && erreur.periode === periode ? erreur.message : null;

  const jour = useMemo(() => {
    if (data === null) return null;
    const choisi = jourChoisi === null ? undefined : data.jours.find((j) => j.jour === jourChoisi);
    const pic = jourDuPic(data.jours);
    return choisi ?? data.jours.find((j) => j.jour === pic) ?? null;
  }, [data, jourChoisi]);

  const fiches = useMemo(
    () => new Map((data?.posts ?? []).map((p) => [p.publicationId, p])),
    [data],
  );

  const totaux = useMemo(() => {
    if (data === null) return null;
    let nouvelles = 0;
    let netNouvelles = 0;
    let netAutres = 0;
    let vues = 0;
    for (const j of data.jours) {
      nouvelles += j.nouvelles;
      netNouvelles += j.netNouvelles ?? 0;
      netAutres += j.netAutres ?? 0;
      vues += j.vues;
    }
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return { nouvelles, netNouvelles: r2(netNouvelles), netAutres: r2(netAutres), vues };
  }, [data]);

  // Montants inexploitables (deux devises sans taux) : les barres comptent les
  // ventes au lieu de les chiffrer — le compte, lui, reste juste.
  const enMontant = data !== null && !data.mixedCurrency;
  const choisir = (e: { activeLabel?: string | number }) => {
    if (typeof e?.activeLabel === "string") setJourChoisi(e.activeLabel);
  };
  const argent = (n: number | null) =>
    n === null || data === null ? "—" : formatMoney(n, data.currency, loc);

  return (
    <div className="space-y-5" data-testid="ventes-par-jour">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {data !== null
            ? t("periode", {
                du: jourLong(data.du, loc).toLowerCase(),
                au: jourLong(data.au, loc).toLowerCase(),
              })
            : t("periodeAttente")}
        </p>
        <div
          role="group"
          aria-label={t("periodeGroupe")}
          className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5"
        >
          {PERIODES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={periode === p}
              onClick={() => {
                setPeriode(p);
                setJourChoisi(null);
              }}
              className={
                periode === p
                  ? "rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-900 shadow-sm"
                  : "rounded-full px-3 py-1 text-xs text-slate-500 hover:text-slate-700"
              }
            >
              {t("jours", { n: p })}
            </button>
          ))}
        </div>
      </div>

      {echec !== null ? (
        <div className="flex items-start gap-2 text-sm text-amber-900">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t("echec")}</div>
            <div className="text-xs text-amber-800">{echec}</div>
          </div>
        </div>
      ) : lu !== null && !lu.configured ? (
        <p className="text-xs text-slate-500">{t("nonConfigure")}</p>
      ) : data === null || totaux === null ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <div>
              <div className="text-xs font-medium text-slate-500">{t("nouvellesVentes")}</div>
              <div className="text-2xl font-semibold tracking-tight text-slate-900">
                {formatNumber(totaux.nouvelles, loc)}
                {enMontant && (
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {argent(totaux.netNouvelles)}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">{t("autresPaiements")}</div>
              <div className="mt-1 text-base font-medium text-slate-600">
                {enMontant ? argent(totaux.netAutres) : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">{t("vuesGagnees")}</div>
              <div className="mt-1 text-base font-medium text-slate-600">
                {formatNumber(totaux.vues, loc)}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-600">
              {enMontant ? t("grapheVentesNet") : t("grapheVentesNombre")}
            </div>
            <div className="h-44 cursor-pointer" data-testid="graphe-ventes">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.jours} margin={MARGE} onClick={choisir}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="jour"
                    tick={TICK}
                    axisLine={{ stroke: "#cbd5e1" }}
                    tickLine={false}
                    tickFormatter={jourCourt}
                    minTickGap={16}
                  />
                  <YAxis
                    tick={TICK}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    allowDecimals={enMontant}
                    tickFormatter={(x: number) =>
                      enMontant ? formatMoneyWhole(x, data.currency, loc) : formatNumber(x, loc)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "#f1f5f9" }}
                    content={(p) => <InfoBulle active={p.active} label={p.label} data={data} />}
                  />
                  <Bar
                    dataKey={enMontant ? "netNouvelles" : "nouvelles"}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  >
                    {data.jours.map((j) => (
                      <Cell key={j.jour} fill={j.jour === jour?.jour ? VENTES.on : VENTES.off} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-600">{t("grapheVues")}</div>
            <div className="h-28 cursor-pointer" data-testid="graphe-vues">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.jours} margin={MARGE} onClick={choisir}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="jour"
                    tick={TICK}
                    axisLine={{ stroke: "#cbd5e1" }}
                    tickLine={false}
                    tickFormatter={jourCourt}
                    minTickGap={16}
                  />
                  <YAxis
                    tick={TICK}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tickFormatter={(x: number) =>
                      x >= 1000
                        ? t("milliers", { n: formatNumber(Math.round(x / 1000), loc) })
                        : formatNumber(x, loc)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "#f1f5f9" }}
                    content={(p) => <InfoBulle active={p.active} label={p.label} data={data} />}
                  />
                  <Bar dataKey="vues" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                    {data.jours.map((j) => (
                      <Cell key={j.jour} fill={j.jour === jour?.jour ? VUES.on : VUES.off} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-slate-400">{t("cliquer")}</p>
          </div>

          {jour !== null && (
            <div className="space-y-3 border-t border-slate-200 pt-4" data-testid="ventes-jour-detail">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">{jourLong(jour.jour, loc)}</div>
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-slate-900">
                    {t("ventesDuJour", { count: jour.nouvelles })}
                    {jour.netNouvelles !== null ? ` · ${argent(jour.netNouvelles)}` : ""}
                  </span>
                  {" · "}
                  {t("autresDuJour", { montant: argent(jour.netAutres) })}
                  {" · "}
                  {t("vuesDuJour", { vues: formatNumber(jour.vues, loc) })}
                </div>
              </div>

              {jour.posts.length === 0 ? (
                <p className="text-xs text-slate-500">{t("aucuneVue")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="py-1.5 pr-3 font-medium">{t("colPost")}</th>
                        <th className="px-3 py-1.5 font-medium">{t("colFormat")}</th>
                        <th className="px-3 py-1.5 text-right font-medium">{t("colPublie")}</th>
                        <th className="px-3 py-1.5 text-right font-medium">{t("colVues")}</th>
                        <th className="py-1.5 pl-3 text-right font-medium">{t("colPart")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jour.posts.map((p) => {
                        const f = fiches.get(p.publicationId);
                        const part = jour.vues > 0 ? Math.round((p.vues / jour.vues) * 100) : 0;
                        return (
                          <tr key={p.publicationId} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 pr-3 align-top">
                              <div className="font-medium text-slate-900">{f?.createatrice ?? "—"}</div>
                              {f?.url ? (
                                <a
                                  href={f.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
                                  title={f.titre}
                                >
                                  {f.compte} · {f.plateforme}
                                  <ExternalLinkIcon className="size-3" />
                                </a>
                              ) : (
                                <span className="text-slate-500">
                                  {f ? `${f.compte} · ${f.plateforme}` : t("postSupprime")}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-slate-600">{f?.format ?? "—"}</td>
                            <td className="px-3 py-2 text-right align-top tabular-nums text-slate-500">
                              {f ? publieLe(f.publieLe, loc) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right align-top tabular-nums text-slate-900">
                              {formatNumber(p.vues, loc)}
                            </td>
                            <td className="py-2 pl-3 align-top">
                              <div className="flex items-center justify-end gap-2">
                                <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${part}%`, background: VENTES.on }}
                                  />
                                </div>
                                <span className="w-9 text-right tabular-nums text-slate-700">
                                  {t("part", { pct: part })}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {jour.estime && <p className="text-[11px] text-slate-500">{t("estime")}</p>}
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
            <InfoIcon className="mt-px size-3.5 shrink-0" />
            {t("avertissement")}
          </p>
        </>
      )}
    </div>
  );
}
