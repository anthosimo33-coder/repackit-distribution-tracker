"use client";

import { useEffect, useState } from "react";
import { ChevronRightIcon, SmartphoneIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * « INSTALLER L'APP » — l'espace sur l'écran d'accueil, comme une vraie app.
 *
 * Deux mondes, deux gestes :
 *   - Android (Chrome) : le navigateur émet `beforeinstallprompt` ; on le garde
 *     sous le coude et le tap ouvre la vraie boîte d'installation.
 *   - iPhone : Safari n'a AUCUNE API d'installation. On explique le geste
 *     (Partager → Sur l'écran d'accueil) au lieu de faire semblant d'installer.
 *
 * Rien n'est rendu quand l'app est déjà installée (ouverte en mode standalone),
 * ni sur un ordinateur sans invite : une ligne qui ne mène nulle part serait pire
 * que pas de ligne.
 */
type InstallPromptEvent = Event & { prompt: () => Promise<void> };

export function InstallAppRow() {
  const t = useTranslations("portal.install");
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // L'environnement se lit après le montage (il n'existe pas au rendu serveur).
    const raf = requestAnimationFrame(() => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setInstalled(standalone);
      setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!promptEvent && !ios)) return null;

  return (
    <li>
      <button
        type="button"
        data-testid="install-app"
        onClick={() => {
          if (promptEvent) void promptEvent.prompt().catch(() => {});
          else setShowIosHint((v) => !v);
        }}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SmartphoneIcon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">{t("title")}</span>
          <span className="block text-xs text-slate-500">
            {ios && showIosHint ? t("iosHint") : t("hint")}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
      </button>
    </li>
  );
}
