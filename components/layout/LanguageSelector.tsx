"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LanguagesIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import { writeLocaleCookie } from "@/i18n/locale-cookie";
import { cn } from "@/lib/utils";

/**
 * Choix de la langue d'interface.
 *
 * La préférence est écrite AUX DEUX endroits, et c'est délibéré :
 *   - sur `users.locale` (Convex), qui fait foi et suit la personne d'un
 *     appareil à l'autre ;
 *   - dans le cookie NEXT_LOCALE, qui survit AVANT toute session — c'est lui
 *     qui donne la bonne langue à l'écran de login, où il n'y a pas encore de
 *     compte à interroger.
 *
 * Le cookie est posé côté CLIENT (document.cookie) plutôt que par une action
 * serveur : il ne porte aucun secret, et l'écrire ici évite un aller-retour
 * supplémentaire avant le `router.refresh()` qui redemande le rendu serveur
 * dans la nouvelle langue.
 *
 * L'écriture Convex est TOLÉRANTE À L'ÉCHEC : la langue change quand même
 * (cookie + refresh), on signale seulement que la préférence n'a pas pu être
 * mémorisée. Un backend indisponible ne doit pas empêcher quelqu'un de lire
 * l'interface dans sa langue.
 */
export function LanguageSelector({ collapsed }: { collapsed?: boolean }) {
  const t = useTranslations("settings.language");
  const current = useLocale() as Locale;
  const setMyLocale = useMutation(api.i18n.setMyLocale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function choose(next: Locale) {
    if (next === current) return;
    writeLocaleCookie(next);
    startTransition(() => router.refresh());
    try {
      await setMyLocale({ locale: next });
    } catch {
      toast.error(t("error"));
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        collapsed ? "justify-center" : "px-2",
      )}
    >
      {!collapsed && (
        <LanguagesIcon
          aria-hidden
          className="size-3.5 shrink-0 text-slate-400"
        />
      )}
      <div
        role="group"
        aria-label={t("ariaLabel")}
        className="flex items-center gap-0.5"
      >
        {LOCALES.map((loc) => (
          <button
            key={loc}
            type="button"
            disabled={pending}
            aria-pressed={loc === current}
            onClick={() => void choose(loc)}
            // Le nom accessible est l'ENDONYME (« Français », « English ») :
            // il ne se traduit pas, c'est le nom de la langue dans elle-même.
            title={LOCALE_LABELS[loc]}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-medium uppercase transition-colors disabled:opacity-50",
              loc === current
                ? "bg-primary/10 text-primary"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
            )}
          >
            {loc}
          </button>
        ))}
      </div>
    </div>
  );
}
