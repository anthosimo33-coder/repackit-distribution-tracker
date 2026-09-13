"use client";

import { useState } from "react";
import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * « COPIER ET OUVRIR TIKTOK » — un geste au lieu de trois.
 *
 * Copie la description, puis ouvre la plateforme dans un nouvel onglet — sur
 * téléphone, les liens https de TikTok, Instagram et YouTube ouvrent l'app
 * installée. La créatrice n'a plus qu'à coller en légende.
 *
 * ⚠️ L'ORDRE COMPTE. L'écriture dans le presse-papiers est LANCÉE avant
 * l'ouverture, dans le même tick que le tap : un navigateur n'autorise ni la
 * copie ni l'ouverture d'onglet hors d'un geste de l'utilisateur, et attendre la
 * copie (`await`) ferait perdre ce geste à l'ouverture sur Safari.
 */
export type OpenPlatform = "TikTok" | "Instagram" | "YouTube";

const OPEN_URL: Record<OpenPlatform, string> = {
  TikTok: "https://www.tiktok.com/upload",
  Instagram: "https://www.instagram.com/",
  YouTube: "https://www.youtube.com/upload",
};

export function CopyAndOpenButton({
  text,
  platform,
  className,
}: {
  text: string;
  platform: OpenPlatform;
  className?: string;
}) {
  const t = useTranslations("portal.publishFlow");
  const [done, setDone] = useState(false);

  function go() {
    const copy = navigator.clipboard?.writeText(text);
    window.open(OPEN_URL[platform], "_blank", "noopener,noreferrer");
    copy
      ?.then(() => {
        haptic("tap");
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      })
      .catch(() => {
        /* presse-papiers refusé : l'onglet est ouvert, la copie manuelle reste possible */
      });
  }

  return (
    <Button
      type="button"
      onClick={go}
      data-testid={`copy-open-${platform}`}
      className={cn("gap-1.5", className)}
    >
      {done ? <CheckIcon className="size-4" /> : <ExternalLinkIcon className="size-4" />}
      {t("copyOpen", { platform })}
    </Button>
  );
}
