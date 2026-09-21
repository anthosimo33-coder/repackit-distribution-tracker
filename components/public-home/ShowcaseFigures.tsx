"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { CountUp } from "./CountUp";
import styles from "./home.module.css";

export type ShowcaseStats = {
  videos: number;
  views: number;
  accounts: number;
  creators: number;
  firstPublishedAt: number | null;
};

/**
 * Les chiffres de la vitrine — rendus DEUX FOIS, et c'est voulu.
 *
 * 1. Au PRÉRENDU (build, puis toutes les `revalidate` secondes) : les valeurs
 *    partent dans le HTML. Un robot d'indexation, un lecteur sans JavaScript et
 *    le premier affichage les ont tout de suite.
 * 2. À l'HYDRATATION : une requête HTTP à Convex les rafraîchit.
 *
 * POURQUOI LES DEUX. La page est statique — c'est tout l'intérêt : servie par
 * le CDN, elle n'invoque aucune fonction. Mais statique veut dire figée
 * jusqu'à la prochaine régénération, et ces compteurs sont la seule chose
 * vivante de la page. Sans (2), ils auraient jusqu'à une heure de retard ;
 * sans (1), ils seraient absents du HTML et invisibles aux robots.
 *
 * `useState(initial)` garantit que le PREMIER rendu client est identique au
 * rendu serveur : le rafraîchissement n'arrive qu'après, dans l'effet.
 *
 * ConvexHttpClient et pas le client React : un aller-retour HTTP ponctuel,
 * pas une websocket ouverte pour chaque visiteur d'une page de présentation.
 * Une panne est SILENCIEUSE — on garde les valeurs du prérendu.
 */
export function ShowcaseFigures({ initial }: { initial: ShowcaseStats | null }) {
  const [stats, setStats] = useState(initial);
  const t = useTranslations("home");
  const locale = useLocale();

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return;
    let cancelled = false;
    new ConvexHttpClient(url)
      .query(api.showcase.getShowcaseStats, {})
      .then((fresh) => {
        if (!cancelled) setStats(fresh);
      })
      .catch(() => {
        // Les chiffres du prérendu restent affichés : une vitrine ne doit pas
        // se vider parce que le backend a toussé.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Jamais de zéros : sans vidéo, le bloc n'existe pas.
  if (stats === null || stats.videos === 0) return null;

  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const whole = new Intl.NumberFormat(locale);
  const since =
    stats.firstPublishedAt != null
      ? new Intl.DateTimeFormat(locale, {
          month: "long",
          year: "numeric",
          timeZone: "Europe/Paris",
        }).format(stats.firstPublishedAt)
      : null;

  return (
    <>
      <dl className="m-0 grid grid-cols-2 gap-x-4 border-t border-white/10 lg:grid-cols-4 lg:gap-x-0">
        {(
          [
            ["videos", stats.videos, false],
            ["views", stats.views, true],
            ["accounts", stats.accounts, false],
            ["creators", stats.creators, false],
          ] as const
        ).map(([key, value, isCompact], i) => (
          <div
            key={key}
            className={cn(
              "flex flex-col-reverse gap-1.5 py-4 lg:px-6 lg:py-5",
              i > 0 && "lg:border-l lg:border-white/10",
              i === 0 && "lg:pl-0",
            )}
          >
            <dt className="text-[13px] text-[#f4f4f5]/65 md:text-sm">{t(`apps.stats.${key}`)}</dt>
            <dd className={cn(styles.display, styles.chrome, "m-0 text-4xl leading-none md:text-[56px]")}>
              <CountUp value={value} locale={locale} compact={isCompact}>
                {(isCompact ? compact : whole).format(value)}
              </CountUp>
            </dd>
          </div>
        ))}
      </dl>
      {since && (
        <span className={cn(styles.mono, "text-[10px] text-[#f4f4f5]/50")}>
          {t("apps.stats.since", { date: since })}
        </span>
      )}
    </>
  );
}
