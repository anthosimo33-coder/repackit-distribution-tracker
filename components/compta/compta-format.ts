"use client";

import { useMemo } from "react";
import { formatMoney, formatMoneyWhole } from "@/lib/format-rate";
import { useIntlLocale } from "@/lib/use-intl-locale";

/**
 * Formateurs de l'onglet Compta, liés à la langue active. La devise vient
 * TOUJOURS de la donnée (cf lib/currency-hardcode.test.ts) : chaque formateur la
 * reçoit en argument.
 */
export function useComptaFormat() {
  const locale = useIntlLocale();
  return useMemo(() => {
    /** « −19,96 € » : le signe moins typographique, pas un tiret. */
    const signed = (n: number, currency: string | null) =>
      n < 0 ? `−${formatMoney(-n, currency, locale)}` : formatMoney(n, currency, locale);
    /** « +94,18 € » / « −161,82 € » : un ÉCART, signé dans les deux sens. */
    const delta = (n: number, currency: string | null) =>
      n > 0 ? `+${formatMoney(n, currency, locale)}` : signed(n, currency);
    /** Montant sans décimales (« 37 500 € ») — pour les seuils et les arrondis. */
    const whole = (n: number, currency: string | null) => formatMoneyWhole(n, currency, locale);
    const int = (n: number) => new Intl.NumberFormat(locale).format(n);
    const rate = (n: number) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(n);
    const pct = (n: number) =>
      new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(n);
    /** "2026-09" → « septembre 2026 ». */
    const month = (key: string) =>
      new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 15)).toLocaleDateString(
        locale,
        { month: "long", year: "numeric", timeZone: "UTC" },
      );
    /** "2026-09" → « Septembre » (colonne du tableau). */
    const monthName = (key: string) => {
      const s = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 15)).toLocaleDateString(
        locale,
        { month: "long", timeZone: "UTC" },
      );
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    /** "2026-09" → « sept. » */
    const monthShort = (key: string) =>
      new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 15)).toLocaleDateString(
        locale,
        { month: "short", timeZone: "UTC" },
      );
    /** "2026-09-16" → « 16/09 » */
    const dayShort = (day: string) =>
      new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      });
    /** "2026-09-16" → « 16/09/2026 » */
    const day = (d: string) =>
      new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      });
    /** "2026-12-16" → « 16 déc. » */
    const dayMonth = (d: string) =>
      new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
    /** Instant → « il y a 12 min ». */
    const ago = (at: number, now: number) => {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const s = Math.round((at - now) / 1000);
      if (Math.abs(s) < 60) return rtf.format(s, "second");
      const m = Math.round(s / 60);
      if (Math.abs(m) < 60) return rtf.format(m, "minute");
      const h = Math.round(m / 60);
      if (Math.abs(h) < 48) return rtf.format(h, "hour");
      return rtf.format(Math.round(h / 24), "day");
    };
    return { locale, money: (n: number, c: string | null) => formatMoney(n, c, locale), signed, delta, whole, int, rate, pct, month, monthName, monthShort, dayShort, day, dayMonth, ago };
  }, [locale]);
}

export type ComptaFormat = ReturnType<typeof useComptaFormat>;
