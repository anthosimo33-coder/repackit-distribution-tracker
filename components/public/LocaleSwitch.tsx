"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import { writeLocaleCookie } from "@/i18n/locale-cookie";
import { cn } from "@/lib/utils";

/**
 * Choix de la langue AVANT session : seul le cookie NEXT_LOCALE existe ici
 * (pas de compte à mettre à jour), puis `router.refresh()` redemande le rendu
 * serveur dans la nouvelle langue. Toutes les langues : les créatrices
 * ES/PT passent aussi par ces écrans (connexion, accueil).
 */
export function LocaleSwitch() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === current) return;
    writeLocaleCookie(next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-white/10 p-[3px]",
        pending && "opacity-60",
      )}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-label={LOCALE_LABELS[locale]}
          aria-pressed={locale === current}
          onClick={() => choose(locale)}
          className={cn(
            "h-[30px] min-w-10 rounded-md px-2 text-xs font-semibold tracking-[.08em] uppercase",
            locale === current
              ? "bg-white/10 text-[#f4f4f5]"
              : "text-[#f4f4f5]/60 hover:text-[#f4f4f5]",
          )}
        >
          {locale}
        </button>
      ))}
    </div>
  );
}
